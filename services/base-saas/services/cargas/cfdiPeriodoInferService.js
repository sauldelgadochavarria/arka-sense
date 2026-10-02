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

function anioDeVentana(fechaInicio, fechaFin) {
  // Año del fin de la ventana (semana que cruza año → cuenta en el año nuevo).
  const ref = fechaFin || fechaInicio;
  const s = ymd(ref);
  const y = Number(String(s).slice(0, 4));
  if (Number.isFinite(y) && y >= 1990) return y;
  const d = ref instanceof Date ? ref : new Date(ref);
  return Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear();
}

/**
 * Normaliza `anio` por fechaFin y reasigna numeroPeriodo 1..N por fechaInicio
 * (por empresa + tipoMotor + tipoNomina + año). Evita # “sueltos” tras imports parciales.
 */
async function normalizarYRenumerarPeriodosNomina({
  tenantId,
  empresaId,
  tipoMotor,
  tipoNomina,
  tipoPeriodoId = null,
  subsidiariaId = undefined
}) {
  const PeriodoNomina = await getPeriodoNominaModel();
  const PayrollPeriod = await getPayrollPeriodModel();
  const getHistorico = require('../../models/nominaHistoricoRecibo');
  const Historico = await getHistorico();

  const tipo = String(tipoMotor || '').toLowerCase();
  const nomina = String(tipoNomina || 'ordinaria').toLowerCase();
  const q = {
    tenantId,
    empresaId,
    tipoPeriodo: tipo,
    tipoNomina: nomina
  };
  if (subsidiariaId !== undefined) {
    if (subsidiariaId) q.subsidiariaId = subsidiariaId;
    else q.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
  }

  const periodos = await PeriodoNomina.find(q).sort({ fechaInicio: 1 }).lean();

  if (!periodos.length) return { anios: 0, actualizados: 0 };

  // Orden estable por fechas
  periodos.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

  // Fase 0: números temporales + año correcto (evita E11000 al mover de año)
  for (let i = 0; i < periodos.length; i += 1) {
    const anioOk = anioDeVentana(periodos[i].fechaInicio, periodos[i].fechaFin);
    periodos[i].anio = anioOk;
    await PeriodoNomina.updateOne(
      { _id: periodos[i]._id },
      { $set: { anio: anioOk, numeroPeriodo: 3000000 + i } }
    );
    if (periodos[i].payrollPeriodId) {
      try {
        await PayrollPeriod.updateOne(
          { _id: periodos[i].payrollPeriodId },
          { $set: { anio: anioOk, numeroPeriodo: 3100000 + i } }
        );
      } catch (_) {
        /* ignore temp clash */
      }
    }
  }

  const byAnio = new Map();
  for (const p of periodos) {
    const a = Number(p.anio);
    if (!byAnio.has(a)) byAnio.set(a, []);
    byAnio.get(a).push(p);
  }

  let actualizados = 0;
  for (const [anio, list] of byAnio) {
    list.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

    // 1..N cronológico (ya estánarios en 900000+)
    for (let i = 0; i < list.length; i += 1) {
      const n = i + 1;
      const p = list[i];
      await PeriodoNomina.updateOne({ _id: p._id }, { $set: { anio, numeroPeriodo: n } });
      actualizados += 1;

      // Solo payroll vinculado. No updateMany por fechas: cada sub tiene su índice unique.
      if (p.payrollPeriodId) {
        try {
          await PayrollPeriod.updateOne(
            { _id: p.payrollPeriodId },
            { $set: { anio, numeroPeriodo: n } }
          );
        } catch (err) {
          if (String(err?.code) !== '11000') throw err;
        }
      }

      await Historico.updateMany(
        { tenantId, empresaId, periodoId: p._id },
        {
          $set: {
            anio,
            'periodo.numeroPeriodo': n,
            'periodo.tipoPeriodo': tipo,
            'periodo.tipoNomina': nomina
          }
        }
      );
    }
  }

  return { anios: byAnio.size, actualizados };
}

function overlapDaysUtc(aStart, aEnd, bStart, bEnd) {
  const a0 = startOfUtcDay(aStart).getTime();
  const a1 = startOfUtcDay(aEnd).getTime();
  const b0 = startOfUtcDay(bStart).getTime();
  const b1 = startOfUtcDay(bEnd).getTime();
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi < lo) return 0;
  return Math.round((hi - lo) / 86400000) + 1;
}

/**
 * Fusiona buckets con solape fuerte (≥4 días) del mismo tipo/nómina.
 * Evita crear dos períodos por la misma semana CFDI (dom–sáb vs lun–dom).
 */
function mergeOverlappingPeriodBuckets(buckets, minOverlapDays = 4) {
  if (!buckets || buckets.size < 2) return buckets;
  const list = [...buckets.values()].sort((a, b) => a.fechaInicio - b.fechaInicio);
  const keep = [];

  for (const b of list) {
    const prev = keep[keep.length - 1];
    const sameGroup =
      prev &&
      String(prev.tipo?._id) === String(b.tipo?._id) &&
      String(prev.tipoNomina) === String(b.tipoNomina);
    const ov = sameGroup
      ? overlapDaysUtc(prev.fechaInicio, prev.fechaFin, b.fechaInicio, b.fechaFin)
      : 0;

    if (sameGroup && ov >= minOverlapDays) {
      // Conserva la ventana con más recibos; acumula totales
      if (b.count > prev.count) {
        prev.fechaInicio = b.fechaInicio;
        prev.fechaFin = b.fechaFin;
        prev.key = b.key;
        prev.anio = b.anio;
        prev.diasPeriodo = b.diasPeriodo;
      } else {
        if (b.fechaInicio < prev.fechaInicio) prev.fechaInicio = b.fechaInicio;
        if (b.fechaFin > prev.fechaFin) prev.fechaFin = b.fechaFin;
      }
      prev.count += b.count;
      prev.percepciones += b.percepciones;
      prev.deducciones += b.deducciones;
      prev.neto += b.neto;
      if (b.fechaPago && (!prev.fechaPago || b.fechaPago > prev.fechaPago)) {
        prev.fechaPago = b.fechaPago;
      }
      continue;
    }
    keep.push(b);
  }

  buckets.clear();
  for (const b of keep) {
    b.key = periodBucketKey({
      tipoPeriodoId: b.tipo._id,
      tipoNomina: b.tipoNomina,
      fechaInicio: b.fechaInicio,
      fechaFin: b.fechaFin
    });
    b.anio = anioDeVentana(b.fechaInicio, b.fechaFin);
    buckets.set(b.key, b);
  }
  return buckets;
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
        anio: anioDeVentana(fi, ff),
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

  // Fusiona ventanas casi iguales (p.ej. dom–sáb vs lun–dom del mismo CFDI)
  mergeOverlappingPeriodBuckets(buckets);

  const subId = await resolveSubsidiariaId(empresaId, subsidiariaId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const PeriodoNomina = await getPeriodoNominaModel();

  // Orden estable por fechas (el número se asigna sin pisar ventanas ajenas)
  const ordered = [...buckets.values()].sort((a, b) => a.fechaInicio - b.fechaInicio);

  async function nextNumeroLibrePayroll(tipoId, anio, tipoNomina, excludeId = null) {
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

  /** PeriodoNomina es unique por empresa (sin subsidiaria): hay que alinear con esa clave. */
  async function nextNumeroLibreNomina(anio, tipoMotor, tipoNomina) {
    const scope = {
      tenantId,
      empresaId,
      anio,
      tipoPeriodo: tipoMotor,
      tipoNomina,
      ...(subId ? { subsidiariaId: subId } : { $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }] })
    };
    // $or in scope breaks findOne with other fields - simplify:
    const base = {
      tenantId,
      empresaId,
      anio,
      tipoPeriodo: tipoMotor,
      tipoNomina
    };
    if (subId) base.subsidiariaId = subId;
    else base.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];

    const last = await PeriodoNomina.findOne(base)
      .sort({ numeroPeriodo: -1 })
      .select('numeroPeriodo')
      .lean();
    let n = (Number(last?.numeroPeriodo) || 0) + 1;
    for (let guard = 0; guard < 500; guard += 1) {
      const clashQ = {
        tenantId,
        empresaId,
        anio,
        tipoPeriodo: tipoMotor,
        tipoNomina,
        numeroPeriodo: n
      };
      if (subId) clashQ.subsidiariaId = subId;
      else clashQ.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
      const clash = await PeriodoNomina.findOne(clashQ).select('_id').lean();
      if (!clash) return n;
      n += 1;
    }
    return n;
  }

  async function nextNumeroLibre(tipoId, anio, tipoNomina, tipoMotor, excludeId = null) {
    const nPay = await nextNumeroLibrePayroll(tipoId, anio, tipoNomina, excludeId);
    const nNom = await nextNumeroLibreNomina(anio, tipoMotor, tipoNomina);
    let n = Math.max(nPay, nNom);
    // Garantiza libre en ambas colecciones
    for (let guard = 0; guard < 500; guard += 1) {
      const [clashPay, clashNom] = await Promise.all([
        PayrollPeriod.findOne({
          tenantId,
          empresaId,
          tipoPeriodoId: tipoId,
          anio,
          tipoNomina,
          numeroPeriodo: n,
          ...(subId ? { subsidiariaId: subId } : {}),
          ...(excludeId ? { _id: { $ne: excludeId } } : {})
        })
          .select('_id')
          .lean(),
        PeriodoNomina.findOne({
          tenantId,
          empresaId,
          anio,
          tipoPeriodo: tipoMotor,
          tipoNomina,
          numeroPeriodo: n
        })
          .select('_id fechaInicio fechaFin')
          .lean()
      ]);
      if (!clashPay && !clashNom) return n;
      n += 1;
    }
    return n;
  }

  /** Si el # del payroll ya está tomado en PeriodoNomina por otra ventana, toma el siguiente libre. */
  async function resolveNumeroParaNomina(numeroPeriodo, anio, tipoMotor, tipoNomina, fechaInicio, fechaFin) {
    const existing = await PeriodoNomina.findOne({
      tenantId,
      empresaId,
      anio,
      tipoPeriodo: tipoMotor,
      tipoNomina,
      numeroPeriodo
    })
      .select('_id fechaInicio fechaFin')
      .lean();
    if (!existing) return numeroPeriodo;
    if (
      ymd(existing.fechaInicio) === ymd(fechaInicio) &&
      ymd(existing.fechaFin) === ymd(fechaFin)
    ) {
      return numeroPeriodo;
    }
    return nextNumeroLibreNomina(anio, tipoMotor, tipoNomina);
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
      numeroPeriodo = await nextNumeroLibre(
        b.tipo._id,
        b.anio,
        b.tipoNomina,
        b.tipo.tipoMotor,
        payroll?._id || null
      );
    } else {
      // El # del payroll (por sub) puede chocar con PeriodoNomina (por empresa)
      numeroPeriodo = await resolveNumeroParaNomina(
        numeroPeriodo,
        b.anio,
        b.tipo.tipoMotor,
        b.tipoNomina,
        b.fechaInicio,
        b.fechaFin
      );
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
        numeroPeriodo = await nextNumeroLibre(b.tipo._id, b.anio, b.tipoNomina, b.tipo.tipoMotor, null);
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
      subsidiariaId: subId || null,
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
      // Asegura # libre a nivel empresa antes de insertar
      const nSafe = await resolveNumeroParaNomina(
        numeroPeriodo,
        b.anio,
        b.tipo.tipoMotor,
        b.tipoNomina,
        b.fechaInicio,
        b.fechaFin
      );
      if (nSafe !== numeroPeriodo) {
        numeroPeriodo = nSafe;
        b.numeroPeriodo = nSafe;
        nominaPayload.numeroPeriodo = nSafe;
        payroll.numeroPeriodo = nSafe;
        await payroll.save();
      }

      let createdOk = false;
      for (let attempt = 0; attempt < 8 && !createdOk; attempt += 1) {
        try {
          periodo = await PeriodoNomina.create(nominaPayload);
          periodo = periodo.toObject ? periodo.toObject() : periodo;
          createdOk = true;
        } catch (err) {
          if (String(err?.code) !== '11000') throw err;
          const existing = await PeriodoNomina.findOne({
            tenantId,
            empresaId,
            tipoPeriodo: b.tipo.tipoMotor,
            tipoNomina: b.tipoNomina,
            anio: b.anio,
            numeroPeriodo: nominaPayload.numeroPeriodo
          });
          if (
            existing &&
            ymd(existing.fechaInicio) === ymd(b.fechaInicio) &&
            ymd(existing.fechaFin) === ymd(b.fechaFin)
          ) {
            await PeriodoNomina.updateOne({ _id: existing._id }, { $set: nominaPayload });
            periodo = await PeriodoNomina.findById(existing._id).lean();
            createdOk = true;
          } else {
            const nextN = await nextNumeroLibreNomina(b.anio, b.tipo.tipoMotor, b.tipoNomina);
            nominaPayload.numeroPeriodo = nextN;
            b.numeroPeriodo = nextN;
            payroll.numeroPeriodo = nextN;
            await payroll.save();
          }
        }
      }
      if (!createdOk) {
        throw new Error(
          `No se pudo crear PeriodoNomina ${b.tipo.tipoMotor}/${b.tipoNomina} ${b.anio} tras reintentos de numeración`
        );
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

  // Tras crear/actualizar: numeración cronológica estable (1..N por año)
  const scopes = new Map();
  for (const b of ordered) {
    const sk = `${b.tipo.tipoMotor}|${b.tipoNomina}|${b.tipo._id}`;
    if (!scopes.has(sk)) {
      scopes.set(sk, {
        tipoMotor: b.tipo.tipoMotor,
        tipoNomina: b.tipoNomina,
        tipoPeriodoId: b.tipo._id
      });
    }
  }
  for (const s of scopes.values()) {
    await fusionarPeriodosSolapadosYRenumerar({
      tenantId,
      empresaId,
      tipoMotor: s.tipoMotor,
      tipoNomina: s.tipoNomina
    });
  }
  for (const info of resultMap.values()) {
    const p = await PeriodoNomina.findById(info.periodoNominaId)
      .select('numeroPeriodo anio')
      .lean();
    if (p) {
      info.numeroPeriodo = p.numeroPeriodo;
      info.anio = p.anio;
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

/**
 * Fusiona períodos con solape ≥ minOverlapDays y renumeración cronológica en BD.
 */
async function fusionarPeriodosSolapadosYRenumerar({
  tenantId,
  empresaId,
  tipoMotor = 'semanal',
  tipoNomina = 'ordinaria',
  minOverlapDays = 4,
  dryRun = false,
  subsidiariaId = undefined
} = {}) {
  const PeriodoNomina = await getPeriodoNominaModel();
  const getHistorico = require('../../models/nominaHistoricoRecibo');
  const getRecibo = require('../../models/reciboNomina');
  const Historico = await getHistorico();
  const Recibo = await getRecibo();

  const tipo = String(tipoMotor || '').toLowerCase();
  const nomina = String(tipoNomina || 'ordinaria').toLowerCase();
  const q = {
    tenantId,
    empresaId,
    tipoPeriodo: tipo,
    tipoNomina: nomina
  };
  if (subsidiariaId !== undefined) {
    if (subsidiariaId) q.subsidiariaId = subsidiariaId;
    else q.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
  }

  const periodos = await PeriodoNomina.find(q).sort({ fechaInicio: 1 }).lean();

  const histCounts = new Map();
  await Promise.all(
    periodos.map(async (p) => {
      histCounts.set(String(p._id), await Historico.countDocuments({ periodoId: p._id }));
    })
  );

  const keep = [];
  const merges = [];
  for (const p of periodos) {
    const prev = keep[keep.length - 1];
    const ov =
      prev && prev.fechaInicio && p.fechaInicio
        ? overlapDaysUtc(prev.fechaInicio, prev.fechaFin, p.fechaInicio, p.fechaFin)
        : 0;
    if (prev && ov >= minOverlapDays) {
      const prevScore =
        (histCounts.get(String(prev._id)) || 0) * 1000 + (Number(prev.totales?.empleados) || 0);
      const pScore =
        (histCounts.get(String(p._id)) || 0) * 1000 + (Number(p.totales?.empleados) || 0);
      if (pScore > prevScore) {
        merges.push({ keepId: p._id, dropId: prev._id, overlap: ov });
        keep[keep.length - 1] = p;
      } else {
        merges.push({ keepId: prev._id, dropId: p._id, overlap: ov });
      }
      continue;
    }
    keep.push(p);
  }

  if (!dryRun) {
    for (const m of merges) {
      const keeper = await PeriodoNomina.findById(m.keepId);
      const dropped = await PeriodoNomina.findById(m.dropId).lean();
      if (!keeper || !dropped) continue;

      await Historico.updateMany(
        { tenantId, empresaId, periodoId: dropped._id },
        {
          $set: {
            periodoId: keeper._id,
            'periodo.fechaInicio': keeper.fechaInicio,
            'periodo.fechaFin': keeper.fechaFin,
            'periodo.tipoPeriodo': tipo,
            'periodo.tipoNomina': nomina
          }
        }
      );
      await Recibo.updateMany(
        { tenantId, periodoId: dropped._id },
        { $set: { periodoId: keeper._id } }
      );

      if (dropped.payrollPeriodId && !keeper.payrollPeriodId) {
        keeper.payrollPeriodId = dropped.payrollPeriodId;
      }
      const empKeep = Number(keeper.totales?.empleados) || 0;
      const empDrop = Number(dropped.totales?.empleados) || 0;
      if (empDrop > empKeep && dropped.totales) {
        keeper.totales = dropped.totales;
      }
      await keeper.save();
      await PeriodoNomina.deleteOne({ _id: dropped._id });
    }
  }

  const renum = dryRun
    ? { anios: 0, actualizados: 0 }
    : await normalizarYRenumerarPeriodosNomina({
        tenantId,
        empresaId,
        tipoMotor: tipo,
        tipoNomina: nomina,
        subsidiariaId
      });

  return { merges: merges.length, mergeDetail: merges.slice(0, 25), dryRun, renum };
}

module.exports = {
  resolveTipoPeriodoPorSat,
  buildPeriodosFromStaging,
  lookupPeriodoForPayload,
  normalizarYRenumerarPeriodosNomina,
  fusionarPeriodosSolapadosYRenumerar,
  anioDeVentana,
  mergeOverlappingPeriodBuckets,
  mapPeriodicidadSat,
  ymd
};
