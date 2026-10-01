'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getPayrollPeriodModel = require('../models/payrollPeriod');

/**
 * Lista PeriodoNomina de la empresa, acotado a la subsidiaria activa vía payrollPeriodId.
 * PeriodoNomina no tiene subsidiariaId propio; el vínculo es el PayrollPeriod.
 */
async function listPeriodosNominaScoped({
  tenantId,
  empresaId,
  subsidiariaId = null,
  filter = {},
  sort = { anio: -1, tipoPeriodo: 1, numeroPeriodo: -1, fechaInicio: -1 },
  limit = 80
} = {}) {
  if (!tenantId || !empresaId) return [];
  const Periodo = await getPeriodoNominaModel();
  const q = { tenantId, empresaId, ...filter };

  if (subsidiariaId) {
    const Payroll = await getPayrollPeriodModel();
    const payrollIds = await Payroll.find({
      tenantId,
      empresaId,
      subsidiariaId
    }).distinct('_id');
    if (!payrollIds.length) return [];
    q.payrollPeriodId = { $in: payrollIds };
  }

  let cursor = Periodo.find(q).sort(sort);
  if (limit) cursor = cursor.limit(limit);
  return cursor.lean();
}

async function assertPeriodoEnSubsidiaria(periodo, { tenantId, empresaId, subsidiariaId }) {
  if (!periodo || !subsidiariaId) return true;
  if (!periodo.payrollPeriodId) return false;
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
      limit: 500
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
  listLotesTimbradoScoped
};
