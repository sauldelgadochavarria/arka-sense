'use strict';

const getTipoPeriodoNominaModel = require('../../models/tipoPeriodoNomina');
const getPayrollPeriodModel = require('../../models/payrollPeriod');
const getPeriodoNominaModel = require('../../models/periodoNomina');
const getSubsidiariaModel = require('../../models/subsidiaria');
const {
  crearTipoPeriodo,
  nextCodigoLegado,
  ensureTiposPeriodoForTenant
} = require('../tipoPeriodoNominaService');
const {
  mapPeriodicidadSat,
  normalizePeriodicidadSat,
  ymd,
  startOfUtcDay,
  endOfUtcDay,
  classifyTipoNominaFromCfdi,
  periodBucketKey
} = require('../../libs/periodicidadSatMap');

/**
 * Resuelve (o crea) TipoPeriodoNomina por código SAT de periodicidad.
 * Cache: Map<codeSat, tipoDoc>
 */
async function resolveTipoPeriodoPorSat(tenantId, empresaId, satCode, cache) {
  const code = normalizePeriodicidadSat(satCode);
  const mapped = mapPeriodicidadSat(code);
  if (!mapped || !mapped.soportado) return null;

  const key = String(mapped.code);
  if (cache.has(key)) return cache.get(key);

  await ensureTiposPeriodoForTenant(tenantId, empresaId);
  const Tipo = await getTipoPeriodoNominaModel();

  // Siempre preferir match exacto por clave SAT (evita que 99 “Otra” caiga en mensual).
  let tipo = await Tipo.findOne({
    tenantId,
    empresaId,
    periodicidadPagoSat: mapped.code,
    activo: true
  })
    .sort({ codigoLegado: 1 })
    .lean();

  if (!tipo && !mapped.evitarFallbackMotor) {
    tipo = await Tipo.findOne({
      tenantId,
      empresaId,
      tipoMotor: mapped.tipoMotor,
      activo: true,
      $or: [
        { periodicidadPagoSat: null },
        { periodicidadPagoSat: { $exists: false } },
        { periodicidadPagoSat: mapped.code }
      ]
    })
      .sort({ codigoLegado: 1 })
      .lean();
  }

  if (!tipo) {
    const codigoLegado = await nextCodigoLegado(tenantId, empresaId);
    const created = await crearTipoPeriodo(tenantId, empresaId, {
      codigoLegado,
      codigoExterno: `CFDI-SAT-${mapped.code}`,
      nombre:
        mapped.code === 99
          ? 'Otra periodicidad (SAT 99 · extraordinarias)'
          : `Import CFDI · ${mapped.label}`,
      tipoMotor: mapped.tipoMotor,
      diasPeriodo: mapped.diasPeriodo || 0,
      esSeptimo: mapped.tipoMotor === 'semanal',
      diasLaborables:
        mapped.tipoMotor === 'semanal'
          ? 6
          : mapped.diasPeriodo > 0
            ? Math.min(mapped.diasPeriodo, 15)
            : 0,
      leyenda: mapped.code === 99 ? 'sat_99_otra' : 'cfdi_import',
      periodicidadPagoSat: mapped.code,
      diaInicioSemana: 1,
      modoCalendario: mapped.diasPeriodo > 0 ? 'por_dias' : 'calendario_fijo',
      aplicaAsistenciaPrenomina: false,
      compartirConNomina: true
    });
    tipo = created.toObject ? created.toObject() : created;
  }

  cache.set(key, tipo);
  return tipo;
}

async function resolveSubsidiariaId(empresaId, preferredId = null) {
  const Subsidiaria = await getSubsidiariaModel();
  if (preferredId) {
    const sub = await Subsidiaria.findOne({ _id: preferredId, empresaId, activo: true }).lean();
    if (sub) return sub._id;
  }
  const main =
    (await Subsidiaria.findOne({ empresaId, activo: true, codigo: 'MAIN' }).lean()) ||
    (await Subsidiaria.findOne({ empresaId, activo: true }).sort({ codigo: 1 }).lean());
  return main?._id || null;
}

/**
 * Agrega buckets de período desde staging y crea PayrollPeriod + PeriodoNomina cerrados.
 * Devuelve Map bucketKey → { payrollPeriodId, periodoNominaId, tipoPeriodo, numeroPeriodo, ... }
 */
async function buildPeriodosFromStaging({
  tenantId,
  empresaId,
  jobId,
  Staging,
  excluirExtraordinarias = false,
  subsidiariaId = null,
  onProgress = null
}) {
  const match = { jobId, estatus: 'ok' };
  const tipoCache = new Map();
  const buckets = new Map();

  const cursor = Staging.find(match).select('payload').lean().cursor({ batchSize: 120 });
  let scanned = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const d = doc.payload || {};
    if (excluirExtraordinarias && String(d.tipoNomina).toUpperCase() === 'E') continue;

    let tipo = await resolveTipoPeriodoPorSat(
      tenantId,
      empresaId,
      d.empleado?.periodicidadPago,
      tipoCache
    );
    const tipoNomina = classifyTipoNominaFromCfdi(d);
    // Extraordinarias / finiquitos suelen traer PeriodicidadPago=99 u otros códigos;
    // si no hay tipo, caemos a "otra periodicidad" (99) para no perder la ventana.
    if (!tipo && tipoNomina !== 'ordinaria') {
      tipo = await resolveTipoPeriodoPorSat(tenantId, empresaId, '99', tipoCache);
    }
    if (!tipo) continue;

    const fi = d.fechaInicio || d.fechaPago;
    const ff = d.fechaFin || d.fechaPago || fi;
    if (!fi || !ff) continue;

    const diasRango = (() => {
      try {
        const a = startOfUtcDay(fi).getTime();
        const b = startOfUtcDay(ff).getTime();
        return Math.max(1, Math.round((b - a) / 86400000) + 1);
      } catch (_) {
        return 1;
      }
    })();

    const key = periodBucketKey({
      tipoPeriodoId: tipo._id,
      tipoNomina,
      fechaInicio: fi,
      fechaFin: ff
    });

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        tipo,
        tipoNomina,
        tipoNominaCfdi: String(d.tipoNomina || 'O').toUpperCase() === 'E' ? 'E' : 'O',
        periodicidadPagoSat: normalizePeriodicidadSat(d.empleado?.periodicidadPago) ||
          (tipo.periodicidadPagoSat != null ? Number(tipo.periodicidadPagoSat) : null),
        fechaInicio: startOfUtcDay(fi),
        fechaFin: endOfUtcDay(ff),
        fechaPago: d.fechaPago ? new Date(d.fechaPago) : null,
        anio: (d.fechaInicio ? new Date(d.fechaInicio) : new Date(fi)).getUTCFullYear(),
        count: 0,
        percepciones: 0,
        deducciones: 0,
        neto: 0,
        diasPeriodo: Number(d.diasPagados) || Number(tipo.diasPeriodo) || diasRango
      });
    }
    const b = buckets.get(key);
    b.count += 1;
    b.percepciones += Number(d.totales?.percepciones) || 0;
    b.deducciones += Number(d.totales?.deducciones) || 0;
    b.neto += Number(d.totales?.totalXml) || 0;
    if (d.fechaPago) {
      const fp = new Date(d.fechaPago);
      if (!b.fechaPago || fp > b.fechaPago) b.fechaPago = fp;
    }
    if (d.diasPagados && Number(d.diasPagados) > b.diasPeriodo) {
      b.diasPeriodo = Number(d.diasPagados);
    }

    if (onProgress && scanned % 500 === 0) {
      await onProgress({
        fase: 'periodos_scan',
        procesados: scanned,
        mensaje: `Inferiendo períodos… ${scanned} recibos · ${buckets.size} ventanas`
      });
    }
  }

  const subId = await resolveSubsidiariaId(empresaId, subsidiariaId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const PeriodoNomina = await getPeriodoNominaModel();

  // Orden estable por fechas (el número se asigna sin pisar ventanas ajenas)
  const ordered = [...buckets.values()].sort((a, b) => a.fechaInicio - b.fechaInicio);

  async function nextNumeroLibre(tipoId, anio, tipoNomina, excludeId = null) {
    const scope = {
      tenantId,
      empresaId,
      tipoPeriodoId: tipoId,
      anio,
      tipoNomina,
      ...(subId ? { subsidiariaId: subId } : {})
    };
    const last = await PayrollPeriod.findOne(scope)
      .sort({ numeroPeriodo: -1 })
      .select('numeroPeriodo')
      .lean();
    let n = (Number(last?.numeroPeriodo) || 0) + 1;
    // Evita colisión si el max está "roto" o hay huecos con unique parcial
    for (let guard = 0; guard < 500; guard += 1) {
      const clash = await PayrollPeriod.findOne({
        ...scope,
        numeroPeriodo: n,
        ...(excludeId ? { _id: { $ne: excludeId } } : {})
      })
        .select('_id')
        .lean();
      if (!clash) return n;
      n += 1;
    }
    return n;
  }

  const resultMap = new Map();
  let created = 0;
  let updated = 0;
  let i = 0;

  for (const b of ordered) {
    i += 1;
    const round2 = (n) => Math.round(n * 100) / 100;
    const totales = {
      empleados: b.count,
      percepciones: round2(b.percepciones),
      deducciones: round2(b.deducciones),
      neto: round2(b.neto)
    };
    const cerradoAt = b.fechaPago || b.fechaFin;

    // Match SOLO por ventana de fechas (nunca por numeroPeriodo suelto:
    // eso reutilizaba períodos del calendario anual con otras fechas).
    const dateMatch = {
      tenantId,
      empresaId,
      tipoPeriodoId: b.tipo._id,
      tipoNomina: b.tipoNomina,
      fechaInicio: b.fechaInicio,
      fechaFin: b.fechaFin,
      ...(subId ? { subsidiariaId: subId } : {})
    };
    let payroll = await PayrollPeriod.findOne(dateMatch);
    if (!payroll && subId) {
      payroll = await PayrollPeriod.findOne({
        tenantId,
        empresaId,
        tipoPeriodoId: b.tipo._id,
        tipoNomina: b.tipoNomina,
        fechaInicio: b.fechaInicio,
        fechaFin: b.fechaFin,
        $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
      });
    }

    let numeroPeriodo =
      payroll?.numeroPeriodo != null && Number.isFinite(Number(payroll.numeroPeriodo))
        ? Number(payroll.numeroPeriodo)
        : null;
    if (numeroPeriodo == null) {
      numeroPeriodo = await nextNumeroLibre(b.tipo._id, b.anio, b.tipoNomina, payroll?._id || null);
    }
    b.numeroPeriodo = numeroPeriodo;

    if (payroll) {
      payroll.estatus = 'cerrado';
      payroll.fechaInicio = b.fechaInicio;
      payroll.fechaFin = b.fechaFin;
      payroll.fechaPago = b.fechaPago || payroll.fechaPago;
      payroll.totales = totales;
      payroll.cerradoAt = cerradoAt;
      payroll.calculadoAt = cerradoAt;
      payroll.abiertoAt = payroll.abiertoAt || b.fechaInicio;
      payroll.anio = b.anio;
      payroll.numeroPeriodo = numeroPeriodo;
      payroll.tipo = b.tipo.tipoMotor;
      payroll.tipoPeriodoId = b.tipo._id;
      payroll.codigoLegadoTipoPeriodo = b.tipo.codigoLegado;
      payroll.tipoNomina = b.tipoNomina;
      payroll.tipoNominaCfdi = b.tipoNominaCfdi || (b.tipoNomina === 'ordinaria' ? 'O' : 'E');
      payroll.periodicidadPagoSat =
        b.periodicidadPagoSat != null ? b.periodicidadPagoSat : b.tipo.periodicidadPagoSat || null;
      payroll.compartirConNomina = true;
      payroll.aplicaAsistenciaPrenomina = false;
      payroll.notas = `Import CFDI · ${b.count} recibos timbrados`;
      if (subId) payroll.subsidiariaId = subId;
      await payroll.save();
      updated += 1;
    } else {
      const payrollPayload = {
        tenantId,
        empresaId,
        subsidiariaId: subId || null,
        tipo: b.tipo.tipoMotor,
        tipoNomina: b.tipoNomina,
        tipoNominaCfdi: b.tipoNominaCfdi || (b.tipoNomina === 'ordinaria' ? 'O' : 'E'),
        periodicidadPagoSat:
          b.periodicidadPagoSat != null ? b.periodicidadPagoSat : b.tipo.periodicidadPagoSat || null,
        anio: b.anio,
        numeroPeriodo,
        fechaInicio: b.fechaInicio,
        fechaFin: b.fechaFin,
        fechaPago: b.fechaPago,
        estatus: 'cerrado',
        abiertoAt: b.fechaInicio,
        calculadoAt: cerradoAt,
        cerradoAt,
        tipoPeriodoId: b.tipo._id,
        codigoLegadoTipoPeriodo: b.tipo.codigoLegado,
        aplicaAsistenciaPrenomina: false,
        compartirConNomina: true,
        totales,
        notas: `Import CFDI · ${b.count} recibos timbrados`
      };
      try {
        payroll = await PayrollPeriod.create(payrollPayload);
      } catch (err) {
        if (String(err?.code) !== '11000') throw err;
        // Índice legacy (sin tipoNomina) o carrera: reasigna # libre y reintenta
        numeroPeriodo = await nextNumeroLibre(b.tipo._id, b.anio, b.tipoNomina, null);
        // Si el unique viejo aún ignora tipoNomina, fuerza siguiente global del tipoPeriodo+año
        const globalClash = await PayrollPeriod.findOne({
          tenantId,
          empresaId,
          tipoPeriodoId: b.tipo._id,
          anio: b.anio,
          numeroPeriodo,
          ...(subId ? { subsidiariaId: subId } : {})
        })
          .select('_id')
          .lean();
        if (globalClash) {
          const lastGlobal = await PayrollPeriod.findOne({
            tenantId,
            empresaId,
            tipoPeriodoId: b.tipo._id,
            anio: b.anio,
            ...(subId ? { subsidiariaId: subId } : {})
          })
            .sort({ numeroPeriodo: -1 })
            .select('numeroPeriodo')
            .lean();
          numeroPeriodo = (Number(lastGlobal?.numeroPeriodo) || 0) + 1;
        }
        b.numeroPeriodo = numeroPeriodo;
        payrollPayload.numeroPeriodo = numeroPeriodo;
        payroll = await PayrollPeriod.create(payrollPayload);
      }
      created += 1;
    }

    // PeriodoNomina: por vínculo payroll o por mismas fechas (no por # suelto)
    let periodo = await PeriodoNomina.findOne({
      tenantId,
      empresaId,
      payrollPeriodId: payroll._id
    });
    if (!periodo) {
      periodo = await PeriodoNomina.findOne({
        tenantId,
        empresaId,
        tipoPeriodo: b.tipo.tipoMotor,
        fechaInicio: b.fechaInicio,
        fechaFin: b.fechaFin,
        tipoNomina: b.tipoNomina
      });
    }

    const nominaPayload = {
      tenantId,
      empresaId,
      tipoPeriodo: b.tipo.tipoMotor,
      tipoNomina: b.tipoNomina,
      tipoNominaCfdi: b.tipoNominaCfdi || (b.tipoNomina === 'ordinaria' ? 'O' : 'E'),
      periodicidadPagoSat:
        b.periodicidadPagoSat != null ? b.periodicidadPagoSat : b.tipo.periodicidadPagoSat || null,
      fechaInicio: b.fechaInicio,
      fechaFin: b.fechaFin,
      fechaPago: b.fechaPago,
      anio: b.anio,
      numeroPeriodo,
      diasPeriodo: b.diasPeriodo,
      estatus: 'cerrado',
      payrollPeriodId: payroll._id,
      calculadoAt: cerradoAt,
      fechaCalculo: cerradoAt,
      cerradoAt,
      fechaCierre: cerradoAt,
      cerradoPorLabel: 'import_cfdi',
      calculadoPorLabel: 'import_cfdi',
      omitirDispersionBancaria: false,
      /** Histórico ya pagado/timbrado: dispersión se considera hecha. */
      layoutBancario: {
        estatus: 'generado',
        layoutId: null,
        layoutCodigo: 'IMPORT_CFDI',
        layoutNombre: 'Dispersión histórica (CFDI)',
        fechaPago: b.fechaPago || b.fechaFin,
        fechaGeneracion: cerradoAt,
        archivoNombre: 'import_cfdi_historico.txt',
        cantidadRecibos: b.count,
        totalPagar: totales.neto,
        generadoPorUserId: '',
        generadoPorLabel: 'import_cfdi'
      },
      totales: {
        empleados: totales.empleados,
        percepciones: totales.percepciones,
        deducciones: totales.deducciones,
        neto: totales.neto
      },
      cierreResumen: {
        recibosArchivados: b.count,
        conceptosAcumulados: 0,
        operativosEliminados: 0
      },
      notas: `Importado desde CFDI (${b.count} UUID timbrados)`,
      flujoProceso: {
        revisionCompletada: true,
        revisionAt: cerradoAt,
        revisionPorLabel: 'import_cfdi'
      }
    };

    if (periodo) {
      await PeriodoNomina.updateOne({ _id: periodo._id }, { $set: nominaPayload });
      periodo = await PeriodoNomina.findById(periodo._id).lean();
    } else {
      try {
        periodo = await PeriodoNomina.create(nominaPayload);
        periodo = periodo.toObject ? periodo.toObject() : periodo;
      } catch (err) {
        // Unique por numeroPeriodo: reusa el doc existente solo si es la misma ventana
        if (String(err?.code) === '11000') {
          const existing = await PeriodoNomina.findOne({
            tenantId,
            empresaId,
            tipoPeriodo: b.tipo.tipoMotor,
            tipoNomina: b.tipoNomina,
            anio: b.anio,
            numeroPeriodo
          });
          if (
            existing &&
            ymd(existing.fechaInicio) === ymd(b.fechaInicio) &&
            ymd(existing.fechaFin) === ymd(b.fechaFin)
          ) {
            await PeriodoNomina.updateOne({ _id: existing._id }, { $set: nominaPayload });
            periodo = await PeriodoNomina.findById(existing._id).lean();
          } else {
            // Colisión con otra ventana: toma siguiente número libre en nómina
            const lastN = await PeriodoNomina.findOne({
              tenantId,
              empresaId,
              tipoPeriodo: b.tipo.tipoMotor,
              tipoNomina: b.tipoNomina,
              anio: b.anio
            })
              .sort({ numeroPeriodo: -1 })
              .select('numeroPeriodo')
              .lean();
            nominaPayload.numeroPeriodo = (Number(lastN?.numeroPeriodo) || 0) + 1;
            b.numeroPeriodo = nominaPayload.numeroPeriodo;
            payroll.numeroPeriodo = nominaPayload.numeroPeriodo;
            await payroll.save();
            periodo = await PeriodoNomina.create(nominaPayload);
            periodo = periodo.toObject ? periodo.toObject() : periodo;
          }
        } else {
          throw err;
        }
      }
    }

    resultMap.set(b.key, {
      key: b.key,
      tipoPeriodoId: b.tipo._id,
      tipoMotor: b.tipo.tipoMotor,
      periodicidadSat: b.tipo.periodicidadPagoSat,
      numeroPeriodo: b.numeroPeriodo,
      anio: b.anio,
      tipoNomina: b.tipoNomina,
      payrollPeriodId: payroll._id,
      periodoNominaId: periodo._id,
      count: b.count,
      fechaInicio: b.fechaInicio,
      fechaFin: b.fechaFin
    });

    if (onProgress && i % 10 === 0) {
      await onProgress({
        fase: 'periodos_write',
        procesados: i,
        total: buckets.size,
        mensaje: `Creando períodos… ${i}/${buckets.size}`
      });
    }
  }

  return {
    periodMap: resultMap,
    tipoCache,
    stats: {
      tipos: tipoCache.size,
      ventanas: buckets.size,
      periodosCreados: created,
      periodosActualizados: updated,
      recibosEscaneados: scanned
    }
  };
}

function lookupPeriodoForPayload(periodMap, tipoCache, payload) {
  if (!periodMap || !periodMap.size) return null;
  let mapped = mapPeriodicidadSat(payload?.empleado?.periodicidadPago);
  const tipoNomina = classifyTipoNominaFromCfdi(payload);
  if (!mapped?.soportado && tipoNomina !== 'ordinaria') {
    mapped = mapPeriodicidadSat('99');
  }
  if (!mapped?.soportado) return null;
  const tipo = tipoCache.get(String(mapped.code));
  if (!tipo) return null;
  const key = periodBucketKey({
    tipoPeriodoId: tipo._id,
    tipoNomina,
    fechaInicio: payload.fechaInicio || payload.fechaPago,
    fechaFin: payload.fechaFin || payload.fechaPago || payload.fechaInicio
  });
  return periodMap.get(key) || null;
}

module.exports = {
  resolveTipoPeriodoPorSat,
  buildPeriodosFromStaging,
  lookupPeriodoForPayload,
  mapPeriodicidadSat,
  ymd
};
