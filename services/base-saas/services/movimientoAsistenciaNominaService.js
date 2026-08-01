'use strict';

const getMovimientoAsistenciaNominaModel = require('../models/movimientoAsistenciaNomina');

async function listMovimientos(tenantId, limit = 200) {
  const Movimiento = await getMovimientoAsistenciaNominaModel();
  return Movimiento.find({ tenantId }).sort({ fechaMovimiento: -1, createdAt: -1 }).limit(limit).lean();
}

async function registrarMovimiento(tenantId, empresaId, payload) {
  const Movimiento = await getMovimientoAsistenciaNominaModel();
  return Movimiento.create({
    tenantId,
    empresaId,
    empleadoId: payload.empleadoId || null,
    payrollPeriodId: payload.payrollPeriodId || null,
    periodoNominaId: payload.periodoNominaId || null,
    conceptoClave: payload.conceptoClave || '',
    tipoMovimiento: payload.tipoMovimiento || '',
    monto: payload.monto ?? 0,
    fechaMovimiento: payload.fechaMovimiento || new Date(),
    fechaNomina: payload.fechaNomina || null,
    referencia: payload.referencia || '',
    origenMovimiento: payload.origenMovimiento || 'manual',
    claTrab: payload.claTrab || '',
    claPerded: payload.claPerded || '',
    folioAuto: payload.folioAuto ?? null,
    metadata: payload.metadata || {}
  });
}

async function listPorEmpleadoPeriodo(tenantId, empleadoId, payrollPeriodId) {
  const Movimiento = await getMovimientoAsistenciaNominaModel();
  return Movimiento.find({ tenantId, empleadoId, payrollPeriodId }).sort({ fechaMovimiento: -1 }).lean();
}

async function listPendientesPorRango(tenantId, inicio, fin, payrollPeriodId) {
  const Movimiento = await getMovimientoAsistenciaNominaModel();
  return Movimiento.find({
    tenantId,
    empleadoId: { $ne: null },
    fechaMovimiento: { $gte: inicio, $lte: fin },
    $or: [{ payrollPeriodId: null }, { payrollPeriodId }]
  })
    .sort({ fechaMovimiento: 1 })
    .lean();
}

async function vincularAlPeriodo(tenantId, movimientoIds, payrollPeriodId) {
  if (!movimientoIds?.length) return;
  const Movimiento = await getMovimientoAsistenciaNominaModel();
  await Movimiento.updateMany(
    { tenantId, _id: { $in: movimientoIds } },
    { $set: { payrollPeriodId } }
  );
}

module.exports = {
  listMovimientos,
  registrarMovimiento,
  listPorEmpleadoPeriodo,
  listPendientesPorRango,
  vincularAlPeriodo
};
