'use strict';

/** Días de vacaciones según antigüedad (LFT México, tabla simplificada). */
function diasVacacionesPorAntiguedad(aniosServicio) {
  const y = Math.max(0, Math.floor(aniosServicio));
  if (y < 1) return 0;
  if (y === 1) return 12;
  if (y === 2) return 14;
  if (y === 3) return 16;
  if (y === 4) return 18;
  if (y === 5) return 20;
  if (y <= 10) return 20 + (y - 5) * 2;
  if (y <= 15) return 30 + Math.floor((y - 11) / 5) * 2;
  return 32;
}

function calcularAniosServicio(fechaIngreso, referencia = new Date()) {
  if (!fechaIngreso) return 0;
  const ingreso = new Date(fechaIngreso);
  const ref = new Date(referencia);
  let years = ref.getFullYear() - ingreso.getFullYear();
  const aniversario = new Date(ref.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (ref < aniversario) years -= 1;
  return Math.max(0, years);
}

/**
 * ¿El aniversario laboral (mes/día de ingreso) cae dentro del período?
 * Compara YYYY-MM-DD en zona México.
 */
function aniversarioCaeEnPeriodo(fechaIngreso, fechaInicio, fechaFin, timeZone) {
  if (!fechaIngreso || !fechaInicio || !fechaFin) return false;
  const { ymdInTimeZone, DEFAULT_TZ } = require('../libs/timeHelpers');
  const tz = timeZone || DEFAULT_TZ;
  const ingresoYmd = ymdInTimeZone(fechaIngreso, tz);
  const startYmd = ymdInTimeZone(fechaInicio, tz);
  const endYmd = ymdInTimeZone(fechaFin, tz);
  if (!ingresoYmd || !startYmd || !endYmd) return false;

  const mmdd = ingresoYmd.slice(5); // MM-DD
  const yearStart = Number(startYmd.slice(0, 4));
  const yearEnd = Number(endYmd.slice(0, 4));
  for (let y = yearStart; y <= yearEnd; y += 1) {
    const anniYmd = `${y}-${mmdd}`;
    if (anniYmd >= startYmd && anniYmd <= endYmd) return true;
  }
  return false;
}

/**
 * Fecha del aniversario que cae en el período (mediodía UTC del YMD), o null.
 */
function fechaAniversarioEnPeriodo(fechaIngreso, fechaInicio, fechaFin, timeZone) {
  if (!aniversarioCaeEnPeriodo(fechaIngreso, fechaInicio, fechaFin, timeZone)) return null;
  const { ymdInTimeZone, DEFAULT_TZ } = require('../libs/timeHelpers');
  const tz = timeZone || DEFAULT_TZ;
  const mmdd = ymdInTimeZone(fechaIngreso, tz).slice(5);
  const yearStart = Number(ymdInTimeZone(fechaInicio, tz).slice(0, 4));
  const yearEnd = Number(ymdInTimeZone(fechaFin, tz).slice(0, 4));
  const startYmd = ymdInTimeZone(fechaInicio, tz);
  const endYmd = ymdInTimeZone(fechaFin, tz);
  for (let y = yearStart; y <= yearEnd; y += 1) {
    const anniYmd = `${y}-${mmdd}`;
    if (anniYmd >= startYmd && anniYmd <= endYmd) {
      return new Date(`${anniYmd}T12:00:00.000Z`);
    }
  }
  return null;
}

module.exports = {
  diasVacacionesPorAntiguedad,
  calcularAniosServicio,
  aniversarioCaeEnPeriodo,
  fechaAniversarioEnPeriodo
};
