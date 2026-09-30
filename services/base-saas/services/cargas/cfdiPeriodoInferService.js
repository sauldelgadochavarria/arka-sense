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
  tipoNominaFromCfdi,
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

  let tipo =
    (await Tipo.findOne({
      tenantId,
      empresaId,
      periodicidadPagoSat: mapped.code,
      activo: true
    })
      .sort({ codigoLegado: 1 })
      .lean()) ||
    (await Tipo.findOne({
      tenantId,
      empresaId,
      tipoMotor: mapped.tipoMotor,
      activo: true
    })
      .sort({ codigoLegado: 1 })
      .lean());

  if (!tipo) {
    const codigoLegado = await nextCodigoLegado(tenantId, empresaId);
    const created = await crearTipoPeriodo(tenantId, empresaId, {
      codigoLegado,
      codigoExterno: `CFDI-SAT-${mapped.code}`,
      nombre: `Import CFDI · ${mapped.label}`,
      tipoMotor: mapped.tipoMotor,
      diasPeriodo: mapped.diasPeriodo,
      esSeptimo: mapped.tipoMotor === 'semanal',
      diasLaborables: mapped.tipoMotor === 'semanal' ? 6 : Math.min(mapped.diasPeriodo, 15),
      leyenda: 'cfdi_import',
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

    const tipo = await resolveTipoPeriodoPorSat(
      tenantId,
      empresaId,
      d.empleado?.periodicidadPago,
      tipoCache
    );
    if (!tipo) continue;

    const fi = d.fechaInicio || d.fechaPago;
    const ff = d.fechaFin || d.fechaPago || fi;
    if (!fi || !ff) continue;

    const tipoNomina = tipoNominaFromCfdi(d.tipoNomina);
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
        fechaInicio: startOfUtcDay(fi),
        fechaFin: endOfUtcDay(ff),
        fechaPago: d.fechaPago ? new Date(d.fechaPago) : null,
        anio: (d.fechaInicio ? new Date(d.fechaInicio) : new Date(fi)).getUTCFullYear(),
        count: 0,
        percepciones: 0,
        deducciones: 0,
        neto: 0,
        diasPeriodo: Number(d.diasPagados) || Number(tipo.diasPeriodo) || 0
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

  // Numerar por tipo+año+tipoNomina ordenado por fechaInicio
  const groups = new Map();
  for (const b of buckets.values()) {
    const gk = `${String(b.tipo._id)}|${b.anio}|${b.tipoNomina}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(b);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.fechaInicio - b.fechaInicio);
    list.forEach((b, i) => {
      b.numeroPeriodo = i + 1;
    });
  }

  const resultMap = new Map();
  let created = 0;
  let updated = 0;
  let i = 0;

  for (const b of buckets.values()) {
    i += 1;
    const round2 = (n) => Math.round(n * 100) / 100;
    const totales = {
      empleados: b.count,
      percepciones: round2(b.percepciones),
      deducciones: round2(b.deducciones),
      neto: round2(b.neto)
    };
    const cerradoAt = b.fechaPago || b.fechaFin;

    let payroll = await PayrollPeriod.findOne({
      tenantId,
      empresaId,
      tipoPeriodoId: b.tipo._id,
      anio: b.anio,
      numeroPeriodo: b.numeroPeriodo,
      tipoNomina: b.tipoNomina,
      ...(subId ? { subsidiariaId: subId } : {})
    });

    if (!payroll) {
      // Fallback por fechas
      payroll = await PayrollPeriod.findOne({
        tenantId,
        empresaId,
        tipoPeriodoId: b.tipo._id,
        fechaInicio: b.fechaInicio,
        fechaFin: b.fechaFin,
        tipoNomina: b.tipoNomina
      });
    }

    if (payroll) {
      payroll.estatus = 'cerrado';
      payroll.fechaPago = b.fechaPago || payroll.fechaPago;
      payroll.totales = totales;
      payroll.cerradoAt = cerradoAt;
      payroll.calculadoAt = cerradoAt;
      payroll.abiertoAt = payroll.abiertoAt || b.fechaInicio;
      payroll.anio = b.anio;
      payroll.numeroPeriodo = b.numeroPeriodo;
      payroll.compartirConNomina = true;
      payroll.aplicaAsistenciaPrenomina = false;
      payroll.notas = `Import CFDI · ${b.count} recibos timbrados`;
      if (subId && !payroll.subsidiariaId) payroll.subsidiariaId = subId;
      await payroll.save();
      updated += 1;
    } else {
      payroll = await PayrollPeriod.create({
        tenantId,
        empresaId,
        subsidiariaId: subId || null,
        tipo: b.tipo.tipoMotor,
        tipoNomina: b.tipoNomina,
        anio: b.anio,
        numeroPeriodo: b.numeroPeriodo,
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
      });
      created += 1;
    }

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
        tipoNomina: b.tipoNomina,
        anio: b.anio,
        numeroPeriodo: b.numeroPeriodo
      });
    }
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
      fechaInicio: b.fechaInicio,
      fechaFin: b.fechaFin,
      fechaPago: b.fechaPago,
      anio: b.anio,
      numeroPeriodo: b.numeroPeriodo,
      diasPeriodo: b.diasPeriodo,
      estatus: 'cerrado',
      payrollPeriodId: payroll._id,
      calculadoAt: cerradoAt,
      fechaCalculo: cerradoAt,
      cerradoAt,
      fechaCierre: cerradoAt,
      cerradoPorLabel: 'import_cfdi',
      calculadoPorLabel: 'import_cfdi',
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
      periodo = await PeriodoNomina.create(nominaPayload);
      periodo = periodo.toObject ? periodo.toObject() : periodo;
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
  const mapped = mapPeriodicidadSat(payload?.empleado?.periodicidadPago);
  if (!mapped?.soportado) return null;
  const tipo = tipoCache.get(String(mapped.code));
  if (!tipo) return null;
  const key = periodBucketKey({
    tipoPeriodoId: tipo._id,
    tipoNomina: tipoNominaFromCfdi(payload.tipoNomina),
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
