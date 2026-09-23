'use strict';

/**
 * Helpers de calendario flexible (tipo de período).
 * Día de semana: 0=domingo … 6=sábado (igual que Date#getDay).
 */

const { startOfDay, endOfDay } = require('./timeHelpers');

const DIAS_SEMANA_OPTS = [
  { value: 0, label: 'Domingo', short: 'Dom' },
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' }
];

const MODOS_CALENDARIO = [
  { value: 'calendario_fijo', label: 'Calendario fijo (1–15, lun–dom…)' },
  { value: 'por_dias', label: 'Por días consecutivos (ancla + N días)' }
];

function normalizeWeekday(n, fallback = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  return i >= 0 && i <= 6 ? i : fallback;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Inicio de la semana laboral que contiene `date`, con weekStartsOn (0–6).
 */
function startOfWeekOn(date, weekStartsOn = 1) {
  const d = startOfDay(date);
  const start = normalizeWeekday(weekStartsOn, 1);
  const dow = d.getDay();
  const diff = (dow - start + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function endOfWeekOn(date, weekStartsOn = 1) {
  const inicio = startOfWeekOn(date, weekStartsOn);
  return endOfDay(addDays(inicio, 6));
}

/**
 * Próximo día de semana >= desde (incluye el mismo día si coincide).
 */
function nextWeekdayOnOrAfter(desde, weekday) {
  const d = startOfDay(desde);
  const target = normalizeWeekday(weekday, d.getDay());
  const diff = (target - d.getDay() + 7) % 7;
  return addDays(d, diff);
}

/**
 * Sugiere fecha de pago según política del tipo de período.
 * Prioridad: diaPago (próximo weekday on/after fechaFin+offset) → fechaFin + offsetPagoDias.
 */
function sugerirFechaPago(fechaFin, tipoPeriodoRef = null) {
  if (!fechaFin) return null;
  const fin = startOfDay(fechaFin);
  const offset = Number(tipoPeriodoRef?.offsetPagoDias);
  const base = addDays(fin, Number.isFinite(offset) ? offset : 0);

  if (tipoPeriodoRef?.diaPago != null && tipoPeriodoRef.diaPago !== '') {
    return nextWeekdayOnOrAfter(base, tipoPeriodoRef.diaPago);
  }
  return base;
}

function resolveModoCalendario(tipoPeriodoRef = null, tipoMotor = null) {
  const modo = tipoPeriodoRef?.modoCalendario;
  if (modo === 'por_dias' || modo === 'calendario_fijo') return modo;
  const dias = Number(tipoPeriodoRef?.diasPeriodo) || 0;
  if (dias > 0) return 'por_dias';
  return 'calendario_fijo';
}

function parseOptionalWeekday(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 6) return null;
  return Math.trunc(n);
}

function parseCalendarioFromBody(body = {}) {
  const diasPeriodo = Number(body.diasPeriodo) || 0;
  let modoCalendario = String(body.modoCalendario || '').trim();
  if (modoCalendario !== 'por_dias' && modoCalendario !== 'calendario_fijo') {
    modoCalendario = diasPeriodo > 0 ? 'por_dias' : 'calendario_fijo';
  }
  const offsetRaw = body.offsetPagoDias;
  const offsetPagoDias =
    offsetRaw === '' || offsetRaw === undefined || offsetRaw === null
      ? 0
      : Number(offsetRaw);
  return {
    diaInicioSemana: normalizeWeekday(body.diaInicioSemana, 1),
    modoCalendario,
    diaPago: parseOptionalWeekday(body.diaPago),
    offsetPagoDias: Number.isFinite(offsetPagoDias) ? Math.trunc(offsetPagoDias) : 0
  };
}

module.exports = {
  DIAS_SEMANA_OPTS,
  MODOS_CALENDARIO,
  normalizeWeekday,
  addDays,
  startOfWeekOn,
  endOfWeekOn,
  nextWeekdayOnOrAfter,
  sugerirFechaPago,
  resolveModoCalendario,
  parseOptionalWeekday,
  parseCalendarioFromBody
};
