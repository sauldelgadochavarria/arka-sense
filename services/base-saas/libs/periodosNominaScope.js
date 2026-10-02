'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');

function overlapDays(aStart, aEnd, bStart, bEnd) {
  const a0 = new Date(aStart).setHours(0, 0, 0, 0);
  const a1 = new Date(aEnd).setHours(0, 0, 0, 0);
  const b0 = new Date(bStart).setHours(0, 0, 0, 0);
  const b1 = new Date(bEnd).setHours(0, 0, 0, 0);
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi < lo) return 0;
  return Math.round((hi - lo) / 86400000) + 1;
}

/**
 * Quita casi-duplicados (misma semana CFDI con ventana corrida 1 día).
 * Conserva el de más empleados / más reciente.
 */
function collapseNearDuplicatePeriodos(periodos, minOverlapDays = 4) {
  if (!Array.isArray(periodos) || periodos.length < 2) return periodos || [];
  const sorted = [...periodos].sort(
    (a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio)
  );
  const keep = [];
  for (const p of sorted) {
    const prev = keep[keep.length - 1];
    const same =
      prev &&
      String(prev.tipoPeriodo) === String(p.tipoPeriodo) &&
      String(prev.tipoNomina || 'ordinaria') === String(p.tipoNomina || 'ordinaria');
    const ov =
      same && prev.fechaInicio && p.fechaInicio
        ? overlapDays(prev.fechaInicio, prev.fechaFin, p.fechaInicio, p.fechaFin)
        : 0;
    if (same && ov >= minOverlapDays) {
      const prevEmp = Number(prev.totales?.empleados) || 0;
      const pEmp = Number(p.totales?.empleados) || 0;
      if (pEmp > prevEmp || (pEmp === prevEmp && p.fechaInicio >= prev.fechaInicio)) {
        keep[keep.length - 1] = p;
      }
      continue;
    }
    keep.push(p);
  }
  return keep;
}

/**
 * Numeración visible 1..N por año+tipo+nómina según fechaInicio (ámbito de la lista).
 */
function annotateNumeroPeriodoDisplay(periodos) {
  const groups = new Map();
  for (const p of periodos || []) {
    const anio =
      p.anio ||
      (p.fechaFin
        ? new Date(p.fechaFin).getUTCFullYear()
        : p.fechaInicio
          ? new Date(p.fechaInicio).getUTCFullYear()
          : 0);
    const key = `${anio}|${p.tipoPeriodo}|${p.tipoNomina || 'ordinaria'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
    list.forEach((p, i) => {
      p.numeroPeriodoDisplay = i + 1;
    });
  }
  return periodos;
}

/**
 * Lista PeriodoNomina de la empresa, acotado a la subsidiaria activa vía payrollPeriodId
 * e históricos de esa subsidiaria. PeriodoNomina no tiene subsidiariaId propio.
 */
async function listPeriodosNominaScoped({
  tenantId,
  empresaId,
  subsidiariaId = null,
  filter = {},
  sort = { fechaInicio: -1 },
  limit = 80,
  annotateDisplay = true,
  collapseDuplicates = true
} = {}) {
  if (!tenantId || !empresaId) return [];
  const Periodo = await getPeriodoNominaModel();
  const q = { tenantId, empresaId, ...filter };

  if (subsidiariaId) {
    // Preferir campo nativo; fallback a payroll/histórico por compatibilidad
    const Payroll = await getPayrollPeriodModel();
    const Historico = await getNominaHistoricoReciboModel();
    const [payrollIds, histPeriodoIds] = await Promise.all([
      Payroll.find({ tenantId, empresaId, subsidiariaId }).distinct('_id'),
      Historico.find({
        tenantId,
        empresaId,
        subsidiariaId,
        periodoId: { $ne: null }
      }).distinct('periodoId')
    ]);
    const or = [{ subsidiariaId }];
    if (payrollIds.length) or.push({ payrollPeriodId: { $in: payrollIds } });
    if (histPeriodoIds.length) or.push({ _id: { $in: histPeriodoIds } });
    q.$or = or;
  }

  // Traer de más si vamos a colapsar duplicados
  const fetchLimit = collapseDuplicates && limit ? Math.min(limit * 2, 500) : limit;
  let cursor = Periodo.find(q).sort(sort);
  if (fetchLimit) cursor = cursor.limit(fetchLimit);
  let rows = await cursor.lean();

  if (collapseDuplicates) {
    rows = collapseNearDuplicatePeriodos(rows);
  }
  if (annotateDisplay) {
    annotateNumeroPeriodoDisplay(rows);
  }

  // Re-ordenar para UI (más reciente primero) y aplicar limit final
  rows.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
  if (limit && rows.length > limit) rows = rows.slice(0, limit);
  return rows;
}

async function assertPeriodoEnSubsidiaria(periodo, { tenantId, empresaId, subsidiariaId }) {
  if (!periodo || !subsidiariaId) return true;
  if (!periodo.payrollPeriodId) {
    const Historico = await getNominaHistoricoReciboModel();
    const hit = await Historico.findOne({
      tenantId,
      empresaId,
      subsidiariaId,
      periodoId: periodo._id
    })
      .select('_id')
      .lean();
    return !!hit;
  }
  const Payroll = await getPayrollPeriodModel();
  const pre = await Payroll.findOne({
    _id: periodo.payrollPeriodId,
    tenantId,
    empresaId,
    subsidiariaId
  })
    .select('_id')
    .lean();
  return !!pre;
}

/**
 * Resuelve subsidiariaId del PayrollPeriod ligado a un PeriodoNomina.
 */
async function resolveSubsidiariaIdFromPeriodo(periodo, { tenantId, empresaId } = {}) {
  if (!periodo?.payrollPeriodId) return null;
  const Payroll = await getPayrollPeriodModel();
  const q = { _id: periodo.payrollPeriodId };
  if (tenantId) q.tenantId = tenantId;
  if (empresaId) q.empresaId = empresaId;
  const pre = await Payroll.findOne(q).select('subsidiariaId').lean();
  return pre?.subsidiariaId || null;
}

/**
 * Lista lotes de timbrado acotados a la subsidiaria activa (vía período / subsidiariaId).
 */
async function listLotesTimbradoScoped({
  tenantId,
  empresaId,
  subsidiariaId = null,
  limit = 15
} = {}) {
  if (!tenantId || !empresaId) return [];
  const getTimbradoLoteModel = require('../models/timbradoLote');
  const Lote = await getTimbradoLoteModel();
  const q = { tenantId, empresaId };

  if (subsidiariaId) {
    const periodos = await listPeriodosNominaScoped({
      tenantId,
      empresaId,
      subsidiariaId,
      filter: {},
      limit: 500,
      annotateDisplay: false,
      collapseDuplicates: false
    });
    const periodoIds = periodos.map((p) => p._id);
    q.$or = [{ subsidiariaId }, ...(periodoIds.length ? [{ periodoId: { $in: periodoIds } }] : [])];
    if (!q.$or.length) return [];
  }

  let cursor = Lote.find(q).sort({ createdAt: -1 });
  if (limit) cursor = cursor.limit(limit);
  return cursor.lean();
}

module.exports = {
  listPeriodosNominaScoped,
  assertPeriodoEnSubsidiaria,
  resolveSubsidiariaIdFromPeriodo,
  listLotesTimbradoScoped,
  annotateNumeroPeriodoDisplay,
  collapseNearDuplicatePeriodos
};
