'use strict';

const { ymdInTimeZone, DEFAULT_TZ } = require('./timeHelpers');

/**
 * Flags de calendario para prestaciones de pago mensual
 * (despensa en 2ª quincena / 3ª semana).
 */
function diaDelMesEnTz(date, timeZone = DEFAULT_TZ) {
  const ymd = ymdInTimeZone(date, timeZone);
  return Number(String(ymd).slice(8, 10)) || 0;
}

function esSegundaQuincena(fechaInicio, timeZone = DEFAULT_TZ) {
  return diaDelMesEnTz(fechaInicio, timeZone) >= 16 ? 1 : 0;
}

/** Semana del mes 1–5 según día de inicio (1–7 → 1, 8–14 → 2, …). */
function semanaDelMes(fechaInicio, timeZone = DEFAULT_TZ) {
  const d = diaDelMesEnTz(fechaInicio, timeZone);
  if (d <= 0) return 0;
  return Math.min(5, Math.ceil(d / 7));
}

/**
 * ¿Este período es el de pago habitual de despensa?
 * - quincenal/catorcenal: 2ª quincena (día ≥ 16)
 * - semanal: 3ª semana del mes
 * - mensual: siempre
 */
function sugerirPagaDespensa(tipoPeriodo, fechaInicio, timeZone = DEFAULT_TZ) {
  const tipo = String(tipoPeriodo || '').toLowerCase();
  if (tipo === 'mensual') return true;
  if (tipo === 'quincenal' || tipo === 'catorcenal') {
    return esSegundaQuincena(fechaInicio, timeZone) === 1;
  }
  if (tipo === 'semanal') {
    return semanaDelMes(fechaInicio, timeZone) === 3;
  }
  return false;
}

module.exports = {
  diaDelMesEnTz,
  esSegundaQuincena,
  semanaDelMes,
  sugerirPagaDespensa
};
