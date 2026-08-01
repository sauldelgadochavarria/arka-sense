'use strict';

const { startOfDay, endOfDay } = require('../libs/timeHelpers');

function startOfWeekMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function endOfWeekSunday(monday) {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return endOfDay(d);
}

function resolvePeriodRange(tipo, referencia = new Date()) {
  const ref = startOfDay(referencia);
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = ref.getDate();

  if (tipo === 'semanal') {
    const inicio = startOfWeekMonday(ref);
    return { fechaInicio: inicio, fechaFin: endOfWeekSunday(inicio) };
  }

  if (tipo === 'quincenal') {
    if (d <= 15) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 15)) };
    }
    return { fechaInicio: new Date(y, m, 16), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  if (tipo === 'decena') {
    if (d <= 10) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 10)) };
    }
    if (d <= 20) {
      return { fechaInicio: new Date(y, m, 11), fechaFin: endOfDay(new Date(y, m, 20)) };
    }
    return { fechaInicio: new Date(y, m, 21), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  if (tipo === 'catorcenal') {
    if (d <= 14) {
      return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m, 14)) };
    }
    return { fechaInicio: new Date(y, m, 15), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
  }

  // mensual
  return { fechaInicio: new Date(y, m, 1), fechaFin: endOfDay(new Date(y, m + 1, 0)) };
}

module.exports = { resolvePeriodRange };
