'use strict';

const getEmpleadoModel = require('../models/empleado');
const getVacacionSaldoModel = require('../models/vacacionSaldo');
const getIncidenciaModel = require('../models/incidencia');
const { diasVacacionesPorAntiguedad, calcularAniosServicio } = require('../config/vacacionesLFT');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

async function recalcularSaldoEmpleado(tenantId, empleadoId, anio = new Date().getFullYear()) {
  const Empleado = await getEmpleadoModel();
  const VacacionSaldo = await getVacacionSaldoModel();
  const Incidencia = await getIncidenciaModel();

  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) return null;

  const anios = calcularAniosServicio(empleado.fechaIngreso);
  const diasCorresponden = diasVacacionesPorAntiguedad(anios);

  const inicioAnio = new Date(anio, 0, 1);
  const finAnio = new Date(anio, 11, 31, 23, 59, 59, 999);

  const vacacionesAprobadas = await Incidencia.find({
    tenantId,
    empleadoId,
    codigo: 'VAC',
    estatus: 'aprobada',
    fechaInicio: { $gte: inicioAnio, $lte: finAnio }
  }).lean();

  const diasTomados = vacacionesAprobadas.reduce((sum, i) => sum + (i.diasAfectados || 1), 0);
  const diasPendientes = Math.max(0, diasCorresponden - diasTomados);

  return VacacionSaldo.findOneAndUpdate(
    { tenantId, empleadoId, anio },
    {
      $set: {
        tenantId,
        empleadoId,
        anio,
        diasCorresponden,
        diasTomados,
        diasPendientes,
        primaVacacionalPct: 25
      }
    },
    { upsert: true, new: true }
  ).lean();
}

async function recalcularSaldosTenant(tenantId, anio = new Date().getFullYear()) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean();
  const results = [];
  for (const e of empleados) {
    results.push(await recalcularSaldoEmpleado(tenantId, e._id, anio));
  }
  return results;
}

function calcularDiasSolicitud(fechaInicio, fechaFin) {
  const start = startOfDay(fechaInicio);
  const end = startOfDay(fechaFin);
  if (end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

module.exports = {
  recalcularSaldoEmpleado,
  recalcularSaldosTenant,
  calcularDiasSolicitud,
  calcularAniosServicio,
  diasVacacionesPorAntiguedad
};
