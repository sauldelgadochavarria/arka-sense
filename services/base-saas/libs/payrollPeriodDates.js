'use strict';

const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const {
  startOfWeekOn,
  endOfWeekOn,
  resolveModoCalendario,
  normalizeWeekday,
  addDays
} = require('./calendarioPeriodo');

function startOfWeekMonday(date) {
  return startOfWeekOn(date, 1);
}

function endOfWeekSunday(monday) {
  return endOfWeekOn(monday, 1);
}

/**
 * Resuelve ventana de período.
 * @param {string} tipo - tipoMotor (semanal, quincenal…)
 * @param {Date} [referencia]
 * @param {object|null} [tipoPeriodoRef] - catálogo con diaInicioSemana / modoCalendario / diasPeriodo
 */
function resolvePeriodRange(tipo, referencia = new Date(), tipoPeriodoRef = null) {
  const ref = startOfDay(referencia);
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = ref.getDate();
  const tipoNorm = String(tipo || tipoPeriodoRef?.tipoMotor || 'quincenal').toLowerCase();
  const modo = resolveModoCalendario(tipoPeriodoRef, tipoNorm);
  const weekStartsOn = normalizeWeekday(tipoPeriodoRef?.diaInicioSemana, 1);
  const diasPeriodo = Number(tipoPeriodoRef?.diasPeriodo) || 0;

  if (modo === 'por_dias' && diasPeriodo > 0) {
    let inicio = ref;
    if (tipoNorm === 'semanal') {
      inicio = startOfWeekOn(ref, weekStartsOn);
    }
    return {
      fechaInicio: startOfDay(inicio),
      fechaFin: endOfDay(addDays(inicio, diasPeriodo - 1))
    };
  }

  if (tipoNorm === 'semanal') {
    const inicio = startOfWeekOn(ref, weekStartsOn);
    return { fechaInicio: inicio, fechaFin: endOfWeekOn(ref, weekStartsOn) };
  }

  if (tipoNorm === 'quincenal') {
    if (d <= 15) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 15)) };
    }
    return { fechaInicio: new Date(y, m, 16), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  if (tipoNorm === 'decena') {
    if (d <= 10) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 10)) };
    }
    if (d <= 20) {
      return { fechaInicio: new Date(y, m, 11), fechaFin: endOfDay(new Date(y, m, 20)) };
    }
    return { fechaInicio: new Date(y, m, 21), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  if (tipoNorm === 'catorcenal') {
    if (d <= 14) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 14)) };
    }
    return { fechaInicio: new Date(y, m, 15), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  // mensual
  return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
}

module.exports = {
  resolvePeriodRange,
  startOfWeekMonday,
  endOfWeekSunday
};
