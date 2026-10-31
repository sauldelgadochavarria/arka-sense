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
 * Día calendario de una fecha ya guardada.
 * Medianoche UTC es el ancla vieja de startOfDay en el contenedor: el YMD UTC es el día laboral.
 * Cualquier otro instante (checada, mediodía UTC) se lee en la zona de la subsidiaria.
 */
function ymdAncla(date, timeZone = DEFAULT_TZ) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return ymdInTimeZone(d, timeZone);
}

/** Suma días a un YYYY-MM-DD de calendario, sin pasar por la zona del proceso. */
function addDaysYmd(ymd, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!match) return '';
  const t = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Días de calendario inclusivos (1–15 jul = 15).
 * Lee anclas guardadas (medianoche UTC o mediodía) sin correr el día por la zona.
 */
function diasCalendarioInclusive(inicio, fin, timeZone = DEFAULT_TZ) {
  const a = ymdAncla(inicio, timeZone);
  const b = ymdAncla(fin, timeZone);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / dayMs
  );
  return Math.max(1, diff + 1);
}

/** Desfase (hora local de la zona − UTC) en ms. México = −6 h. */
function timeZoneOffsetMs(date, timeZone = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || DEFAULT_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - date.getTime();
}

/** Reloj de pared en la zona laboral → instante UTC. El contenedor corre en UTC. */
function zonedWallTimeToUtc(year, month, day, hour, minute, second = 0, timeZone = DEFAULT_TZ) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = timeZoneOffsetMs(new Date(utcGuess), timeZone);
  let instant = utcGuess - offset;
  const offset2 = timeZoneOffsetMs(new Date(instant), timeZone);
  if (offset2 !== offset) instant = utcGuess - offset2;
  return new Date(instant);
}

function applyTimeToDate(baseDate, timeStr, timeZone = DEFAULT_TZ) {
  const time = parseTimeHHMM(timeStr);
  if (!time || !baseDate) return null;
  const [year, month, day] = ymdAncla(baseDate, timeZone).split('-').map(Number);
  return zonedWallTimeToUtc(year, month, day, time.hours, time.minutes, 0, timeZone);
}

function minutesDiff(later, earlier) {
  return Math.round((new Date(later) - new Date(earlier)) / 60000);
}

/**
 * `datetime-local` no trae zona (2026-10-31T08:30).
 * Se lee como hora de la zona laboral, no como UTC del contenedor.
 * Si ya trae Z u offset, se respeta el instante.
 */
function parseDateTimeLocal(value, timeZone = DEFAULT_TZ) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const abs = new Date(raw);
    return Number.isNaN(abs.getTime()) ? null : abs;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!match) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return zonedWallTimeToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] != null ? Number(match[4]) : 0,
    match[5] != null ? Number(match[5]) : 0,
    match[6] != null ? Number(match[6]) : 0,
    timeZone || DEFAULT_TZ
  );
}

/**
 * HH:mm en zona laboral (default America/Mexico_City).
 * Evita el bug de Docker/UTC donde getHours() mostraba 21–23 en vez de 15 local.
 */
function formatTimeHHMM(date, timeZone = DEFAULT_TZ) {
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timeZone || DEFAULT_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(date));
  } catch {
    const d = new Date(date);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}

function formatDateTimeMX(date, timeZone = DEFAULT_TZ) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timeZone || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).format(new Date(date));
  } catch {
    return new Date(date).toISOString();
  }
}

function formatDateMX(date, timeZone = DEFAULT_TZ) {
  if (!date) return '—';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timeZone || DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(date));
  } catch {
    return new Date(date).toLocaleDateString('es-MX');
  }
}

/** Medianoche conceptual del día laboral (UTC noon del YMD en esa zona). */
function calendarDateInTimeZone(date, timeZone = DEFAULT_TZ) {
  const ymd = ymdInTimeZone(date, timeZone);
  return new Date(`${ymd}T12:00:00.000Z`);
}

/**
 * Fecha de calendario (YYYY-MM-DD o datetime) leída en la zona laboral.
 * Un día suelto es mediodía de esa zona, no medianoche UTC.
 */
function parseFechaCalendario(value, timeZone = DEFAULT_TZ) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return parseDateTimeLocal(`${raw}T12:00`, timeZone);
  }
  return parseDateTimeLocal(raw, timeZone);
}

/** Reloj de pared para la app y las pantallas: instante UTC + hora de la zona. */
function relojEnZona(date, timeZone = DEFAULT_TZ) {
  const d = date ? new Date(date) : new Date();
  const zona = timeZone || DEFAULT_TZ;
  if (Number.isNaN(d.getTime())) {
    return { zonaHoraria: zona, instante: null, fecha: '', hora: '', fechaHora: '—' };
  }
  return {
    zonaHoraria: zona,
    instante: d.toISOString(),
    fecha: ymdInTimeZone(d, zona),
    hora: formatTimeHHMM(d, zona),
    fechaHora: formatDateTimeMX(d, zona)
  };
}

module.exports = {
  parseTimeHHMM,
  startOfDay,
  endOfDay,
  ymdInTimeZone,
  ymdAncla,
  addDaysYmd,
  diasCalendarioInclusive,
  applyTimeToDate,
  minutesDiff,
  parseDateTimeLocal,
  parseFechaCalendario,
  formatTimeHHMM,
  formatDateTimeMX,
  formatDateMX,
  calendarDateInTimeZone,
  relojEnZona,
  DEFAULT_TZ
};
