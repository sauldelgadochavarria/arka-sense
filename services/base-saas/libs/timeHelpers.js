'use strict';

function parseTimeHHMM(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Días de calendario inclusivos (lun–dom = 7). Normaliza a inicio de día para ignorar endOfDay. */
function diasCalendarioInclusive(inicio, fin) {
  const a = startOfDay(inicio);
  const b = startOfDay(fin);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((b.getTime() - a.getTime()) / dayMs);
  return Math.max(1, diff + 1);
}

function applyTimeToDate(baseDate, timeStr) {
  const time = parseTimeHHMM(timeStr);
  if (!time) return null;
  const d = new Date(baseDate);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d;
}

function minutesDiff(later, earlier) {
  return Math.round((new Date(later) - new Date(earlier)) / 60000);
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTimeHHMM(date) {
  if (!date) return '';
  const d = new Date(date);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateMX(date) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-MX');
}

module.exports = {
  parseTimeHHMM,
  startOfDay,
  endOfDay,
  diasCalendarioInclusive,
  applyTimeToDate,
  minutesDiff,
  parseDateTimeLocal,
  formatTimeHHMM,
  formatDateMX
};
