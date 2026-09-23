'use strict';

const { startOfDay, endOfDay } = require('./timeHelpers');
const { resolvePeriodRange } = require('./payrollPeriodDates');
const { normalizeWeekday, startOfWeekOn, addDays } = require('./calendarioPeriodo');

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

function endOfYear(anio) {
  return endOfDay(new Date(anio, 11, 31));
}

function inYear(date, anio) {
  return startOfDay(date).getFullYear() === anio;
}

/**
 * Genera bloques de período para un año a partir de la fecha inicial del primer período.
 * Respeta tipoPeriodoRef.diaInicioSemana / modoCalendario / diasPeriodo cuando se pasa.
 *
 * @param {object} opts
 * @param {string} opts.tipoMotor
 * @param {number} opts.diasPeriodo
 * @param {Date|string} opts.fechaInicial
 * @param {number} opts.anio
 * @param {object|null} [opts.tipoPeriodoRef]
 * @param {number} [opts.maxPeriodos]
 */
function generarBloquesPeriodoAnio({
  tipoMotor,
  diasPeriodo,
  fechaInicial,
  anio,
  tipoPeriodoRef = null,
  maxPeriodos = 60
}) {
  const anioNum = Number(anio);
  if (!Number.isFinite(anioNum)) throw new Error('Año inválido');

  const refTipo = tipoPeriodoRef || {
    tipoMotor,
    diasPeriodo,
    diaInicioSemana: 1,
    modoCalendario: Number(diasPeriodo) > 0 ? 'por_dias' : 'calendario_fijo'
  };

  let inicio = startOfDay(fechaInicial);
  if (inicio.getFullYear() > anioNum) {
    throw new Error('La fecha inicial no puede ser posterior al año seleccionado');
  }

  const tipoNorm = String(refTipo.tipoMotor || tipoMotor || '').toLowerCase();
  const weekStartsOn = normalizeWeekday(refTipo.diaInicioSemana, 1);
  if (tipoNorm === 'semanal') {
    inicio = startOfWeekOn(inicio, weekStartsOn);
  }

  const finAnio = endOfYear(anioNum);
  const dias = Number(diasPeriodo) > 0 ? Number(diasPeriodo) : defaultDiasPorTipo(tipoNorm);
  const bloques = [];
  let cursor = inicio;
  let numero = 1;

  while (bloques.length < maxPeriodos && cursor <= finAnio) {
    let fechaInicio;
    let fechaFin;

    if (bloques.length === 0) {
      fechaInicio = startOfDay(cursor);
      if (Number(diasPeriodo) > 0 || refTipo.modoCalendario === 'por_dias') {
        fechaFin = endOfDay(addDays(fechaInicio, dias - 1));
      } else {
        const r = resolvePeriodRange(tipoNorm, fechaInicio, refTipo);
        fechaInicio = startOfDay(r.fechaInicio);
        fechaFin = endOfDay(r.fechaFin);
      }
    } else if (Number(diasPeriodo) > 0 || refTipo.modoCalendario === 'por_dias') {
      fechaInicio = startOfDay(cursor);
      fechaFin = endOfDay(addDays(fechaInicio, dias - 1));
    } else {
      const r = resolvePeriodRange(tipoNorm, cursor, refTipo);
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
