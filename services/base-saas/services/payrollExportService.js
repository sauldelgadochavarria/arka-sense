'use strict';

const getPayrollPeriodModel = require('../models/payrollPeriod');
const getPayrollDetailModel = require('../models/payrollDetail');
const getEmpleadoModel = require('../models/empleado');
const getSyncLogModel = require('../models/syncLog');
const { getAdapter } = require('./integration/adapterRegistry');
const { getProfile } = require('./integration/profileService');
const { applyExportFlagsToDetalle } = require('./payrollPreflightService');

async function exportPayrollPeriod(periodId, tenantId, profileId, userId = '') {
  const PayrollPeriod = await getPayrollPeriodModel();
  const period = await PayrollPeriod.findOne({ _id: periodId, tenantId }).lean();
  if (!period) throw new Error('PERIOD_NOT_FOUND');
  if (period.estatus !== 'cerrado' && period.estatus !== 'borrador') {
    throw new Error('PERIOD_NOT_READY');
  }

  const profile = await getProfile(tenantId, profileId);
  if (!profile || !profile.activo) throw new Error('PROFILE_NOT_FOUND');

  const adapter = getAdapter(profile.adaptador);
  if (!adapter) throw new Error('ADAPTER_NOT_FOUND');

  const PayrollDetail = await getPayrollDetailModel();
  const Empleado = await getEmpleadoModel();

  const [detalles, empleados] = await Promise.all([
    PayrollDetail.find({ tenantId, periodId: period._id }).lean(),
    Empleado.find({ tenantId, estatus: 'activo' }).lean()
  ]);

  if (!detalles.length) throw new Error('NO_PAYROLL_DATA');

  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const detallesExport = detalles.map((det) => {
    const emp = empMap.get(String(det.empleadoId));
    return emp ? applyExportFlagsToDetalle(emp, det) : det;
  });

  const result = adapter.exportPayroll({
    empleados,
    detalles: detallesExport,
    periodo: period,
    fieldMapping: profile.fieldMapping
  });

  const SyncLog = await getSyncLogModel();
  await SyncLog.create({
    tenantId,
    empresaId: period.empresaId,
    tipo: 'prenomina_export',
    adaptador: profile.adaptador,
    referenciaId: String(period._id),
    estatus: 'ok',
    registrosOk: result.registros,
    registrosError: 0,
    detalle: `Exportación ${profile.nombre} — ${result.registros} registros`,
    archivoNombre: result.filename,
    archivoContenido: result.content,
    userId
  });

  return result;
}

module.exports = { exportPayrollPeriod };
