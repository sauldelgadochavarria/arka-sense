'use strict';

const { resolveEsquemaJornada } = require('./esquemaJornada');

/** Defaults LFT art. 66–68 (sobrescribibles por esquema de jornada). */
const MAX_DOBLES_POR_DIA_MIN = 3 * 60;
const MAX_DOBLES_POR_SEMANA_MIN = 9 * 60;
const MAX_TOTALES_DIA_MIN = 12 * 60;

function toFiniteMin(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function limitsFromEsquema(esquemaOrTurno = null) {
  const e = resolveEsquemaJornada(esquemaOrTurno);
  return {
    maxDoblesDiaMin: Math.round((e.maxHorasExtraDoblesDia || 3) * 60),
    maxDoblesSemanaMin: Math.round((e.maxHorasExtraDoblesSemana || 9) * 60),
    maxTotalesDiaMin: Math.round((e.maxHorasTotalesDia || 12) * 60)
  };
}

/**
 * Clave de semana laboral.
 * @param {Date|string|number} fecha
 * @param {{ weekStartsOn?: number }} [opts] weekStartsOn 0=dom … 6=sáb (default 1=lunes → ISO-like)
 */
function weekKey(fecha, opts = {}) {
  const weekStartsOn = Number.isFinite(Number(opts.weekStartsOn))
    ? ((Math.trunc(Number(opts.weekStartsOn)) % 7) + 7) % 7
    : 1;

  let y;
  let m;
  let day;
  if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fecha)) {
    y = Number(fecha.slice(0, 4));
    m = Number(fecha.slice(5, 7)) - 1;
    day = Number(fecha.slice(8, 10));
  } else {
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) return 'invalid';
    y = d.getFullYear();
    m = d.getMonth();
    day = d.getDate();
  }

  // Lunes (1): conservar ISO week
  if (weekStartsOn === 1) {
    const utc = new Date(Date.UTC(y, m, day));
    const dow = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  // Semana anclada a weekStartsOn: clave = fecha del inicio de esa semana
  const local = new Date(y, m, day);
  const dow = local.getDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  local.setDate(local.getDate() - diff);
  const ys = local.getFullYear();
  const ms = String(local.getMonth() + 1).padStart(2, '0');
  const ds = String(local.getDate()).padStart(2, '0');
  return `${ys}-S${ms}${ds}`;
}

/**
 * Primeras N h del día → dobles; excedente → triples.
 * @param {number} minutosExtra
 * @param {object|null} esquemaOrTurno
 */
function clasificarMinutosDia(minutosExtra, esquemaOrTurno = null) {
  const { maxDoblesDiaMin } = limitsFromEsquema(esquemaOrTurno);
  const m = toFiniteMin(minutosExtra);
  return {
    minutosDobles: Math.min(m, maxDoblesDiaMin),
    minutosTriples: Math.max(0, m - maxDoblesDiaMin)
  };
}

/**
 * Clasifica HE del período con tope diario y semanal del esquema.
 * @param {Array<{ fecha: Date|string, minutosExtra: number, minutosOrdinarios?: number }>} dias
 * @param {object|null} esquemaOrTurno
 * @param {{ weekStartsOn?: number }} [opts]
 */
function clasificarHorasExtraPeriodo(dias = [], esquemaOrTurno = null, opts = {}) {
  const { maxDoblesSemanaMin, maxTotalesDiaMin } = limitsFromEsquema(esquemaOrTurno);
  const weekDoblesUsados = new Map();
  let minutosDobles = 0;
  let minutosTriples = 0;
  let diasExcedeLimiteDiario = 0;
  const weekOpts = { weekStartsOn: opts.weekStartsOn };

  const sorted = [...dias].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  for (const day of sorted) {
    const { minutosDobles: dDia, minutosTriples: tDia } = clasificarMinutosDia(
      day.minutosExtra,
      esquemaOrTurno
    );
    minutosTriples += tDia;

    const wk = weekKey(day.fecha, weekOpts);
    const usados = weekDoblesUsados.get(wk) || 0;
    const cupo = Math.max(0, maxDoblesSemanaMin - usados);
    const doblesOk = Math.min(dDia, cupo);
    minutosDobles += doblesOk;
    minutosTriples += dDia - doblesOk;
    weekDoblesUsados.set(wk, usados + doblesOk);

    const ordinariosMin = toFiniteMin(day.minutosOrdinarios);
    const totalDiaMin = ordinariosMin + toFiniteMin(day.minutosExtra);
    if (ordinariosMin > 0 && totalDiaMin > maxTotalesDiaMin) {
      diasExcedeLimiteDiario += 1;
    }
  }

  return {
    minutosDobles,
    minutosTriples,
    horasExtraDobles: minutosDobles / 60,
    horasExtraTriples: minutosTriples / 60,
    diasExcedeLimiteDiario,
    excedeLimiteDiario: diasExcedeLimiteDiario > 0
  };
}

/**
 * Extrae minutos HE crudos desde un daily_attendance (una sola fuente).
 * Prefiere minutosHorasExtra; si falta, suma cubetas (legado).
 */
function minutosExtraDesdeDaily(day = {}) {
  const raw = Number(day.minutosHorasExtra);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return (
    (Number(day.minutosHEOrdinaria) || 0) +
    (Number(day.minutosHEDoble) || 0) +
    (Number(day.minutosHETriple) || 0)
  );
}

/**
 * Fallback sin desglose diario: solo tope semanal de dobles (compat).
 * @param {number} totalHoras
 * @param {object|null} esquemaOrTurno
 */
function repartirHorasExtraTotal(totalHoras, esquemaOrTurno = null) {
  const { maxDoblesSemanaMin } = limitsFromEsquema(esquemaOrTurno);
  const maxDoblesH = maxDoblesSemanaMin / 60;
  const h = toFiniteMin(totalHoras);
  if (h <= maxDoblesH) return { horasExtraDobles: h, horasExtraTriples: 0 };
  return { horasExtraDobles: maxDoblesH, horasExtraTriples: h - maxDoblesH };
}

module.exports = {
  MAX_DOBLES_POR_DIA_MIN,
  MAX_DOBLES_POR_SEMANA_MIN,
  MAX_TOTALES_DIA_MIN,
  limitsFromEsquema,
  weekKey,
  clasificarMinutosDia,
  clasificarHorasExtraPeriodo,
  minutosExtraDesdeDaily,
  repartirHorasExtraTotal
};
