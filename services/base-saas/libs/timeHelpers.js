'use strict';

const DEFAULT_TZ = process.env.BASE_TIMEZONE || 'America/Mexico_City';

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

/** YYYY-MM-DD en zona laboral (evita off-by-one cuando el contenedor corre en UTC). */
function ymdInTimeZone(date, timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Días de calendario inclusivos (1–15 jul = 15).
 * Usa zona México: fechaFin guardada como fin-de-día local en UTC no debe contar el día UTC siguiente.
 */
function diasCalendarioInclusive(inicio, fin, timeZone = DEFAULT_TZ) {
  const a = ymdInTimeZone(inicio, timeZone);
  const b = ymdInTimeZone(fin, timeZone);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / dayMs
  );
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
  ymdInTimeZone,
  diasCalendarioInclusive,
  applyTimeToDate,
  minutesDiff,
  parseDateTimeLocal,
  formatTimeHHMM,
  formatDateMX,
  DEFAULT_TZ
};
