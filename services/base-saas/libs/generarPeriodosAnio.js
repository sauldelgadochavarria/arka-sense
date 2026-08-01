'use strict';

const { startOfDay, endOfDay } = require('./timeHelpers');
const { resolvePeriodRange } = require('./payrollPeriodDates');

function defaultDiasPorTipo(tipoMotor) {
  const map = {
    semanal: 7,
    quincenal: 15,
    catorcenal: 14,
    mensual: 30,
    decena: 10
  };
  return map[tipoMotor] || 7;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function endOfYear(anio) {
  return endOfDay(new Date(anio, 11, 31));
}

function inYear(date, anio) {
  return startOfDay(date).getFullYear() === anio;
}

/**
 * Genera bloques de período para un año a partir de la fecha inicial del primer período.
 * El primer bloque inicia exactamente en fechaInicial; los siguientes encadenan día a día.
 */
function generarBloquesPeriodoAnio({ tipoMotor, diasPeriodo, fechaInicial, anio, maxPeriodos = 60 }) {
  const anioNum = Number(anio);
  if (!Number.isFinite(anioNum)) throw new Error('Año inválido');

  const inicio = startOfDay(fechaInicial);
  if (inicio.getFullYear() > anioNum) {
    throw new Error('La fecha inicial no puede ser posterior al año seleccionado');
  }

  const finAnio = endOfYear(anioNum);
  const dias = diasPeriodo > 0 ? diasPeriodo : defaultDiasPorTipo(tipoMotor);
  const bloques = [];
  let cursor = inicio;
  let numero = 1;

  while (bloques.length < maxPeriodos && cursor <= finAnio) {
    let fechaInicio;
    let fechaFin;

    if (bloques.length === 0) {
      fechaInicio = startOfDay(cursor);
      if (diasPeriodo > 0) {
        fechaFin = endOfDay(addDays(fechaInicio, dias - 1));
      } else {
        const r = resolvePeriodRange(tipoMotor, fechaInicio);
        fechaInicio = startOfDay(r.fechaInicio);
        fechaFin = endOfDay(r.fechaFin);
      }
    } else if (diasPeriodo > 0) {
      fechaInicio = startOfDay(cursor);
      fechaFin = endOfDay(addDays(fechaInicio, dias - 1));
    } else {
      const r = resolvePeriodRange(tipoMotor, cursor);
      fechaInicio = startOfDay(r.fechaInicio);
      fechaFin = endOfDay(r.fechaFin);
    }

    if (!inYear(fechaInicio, anioNum) && !inYear(fechaFin, anioNum)) break;
    if (fechaInicio > finAnio) break;

    if (fechaFin > finAnio) fechaFin = finAnio;

    bloques.push({
      numeroPeriodo: numero,
      anio: anioNum,
      fechaInicio,
      fechaFin
    });

    numero += 1;
    cursor = startOfDay(addDays(fechaFin, 1));
  }

  if (!bloques.length) {
    throw new Error('No se generaron períodos para el año con esa fecha inicial');
  }

  return bloques;
}

module.exports = { generarBloquesPeriodoAnio, defaultDiasPorTipo };
