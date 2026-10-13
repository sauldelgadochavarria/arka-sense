'use strict';

const getDailyAttendanceModel = require('../models/dailyAttendance');
const { startOfUtcDay, endOfUtcDay, addUtcDays } = require('./periodoNumero');

/** Estatus de asistencia que cuentan como domingo laborado (prima dominical). */
const ESTATUS_TRABAJADO = ['presente', 'retardo', 'incompleto', 'registro_parcial'];

/**
 * Domingos calendario inclusivos en [inicio, fin] (UTC / día de negocio).
 */
function contarDomingosEnRango(fechaInicio, fechaFin) {
  if (!fechaInicio || !fechaFin) return 0;
  let n = 0;
  let d = startOfUtcDay(fechaInicio);
  const end = startOfUtcDay(fechaFin);
  if (end.getTime() < d.getTime()) return 0;
  while (d.getTime() <= end.getTime()) {
    if (d.getUTCDay() === 0) n += 1;
    d = addUtcDays(d, 1);
  }
  return n;
}

function esDomingoFecha(fecha) {
  if (!fecha) return false;
  const d = new Date(fecha);
  // Preferir UTC (periodos T00:00Z); si viene con offset local México, getDay también suele ser domingo.
  return d.getUTCDay() === 0 || d.getDay() === 0;
}

/**
 * Cuenta días domingo con asistencia efectiva en el rango del período.
 */
async function contarDomingosTrabajados(tenantId, empleadoId, fechaInicio, fechaFin) {
  if (!tenantId || !empleadoId || !fechaInicio || !fechaFin) return 0;
  const DailyAttendance = await getDailyAttendanceModel();
  const rows = await DailyAttendance.find({
    tenantId,
    empleadoId,
    fecha: { $gte: startOfUtcDay(fechaInicio), $lte: endOfUtcDay(fechaFin) },
    estatus: { $in: ESTATUS_TRABAJADO }
  })
    .select('fecha estatus')
    .lean();

  let n = 0;
  for (const r of rows) {
    if (esDomingoFecha(r.fecha)) n += 1;
  }
  return n;
}

module.exports = {
  ESTATUS_TRABAJADO,
  contarDomingosEnRango,
  contarDomingosTrabajados,
  esDomingoFecha
};
