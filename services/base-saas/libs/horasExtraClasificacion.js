'use strict';

/** LFT art. 66–68: máx. 3 h extra/día y 9 h/semana al doble; excedente al triple. */
const MAX_DOBLES_POR_DIA_MIN = 3 * 60;
const MAX_DOBLES_POR_SEMANA_MIN = 9 * 60;

function toFiniteMin(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Semana ISO (lunes–domingo) como clave estable para el tope de 9 h.
 * Evita desfase UTC al parsear strings `YYYY-MM-DD`.
 * @param {Date|string|number} fecha
 */
function weekKey(fecha) {
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
  const utc = new Date(Date.UTC(y, m, day));
  const dow = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Primeras 3 h del día → dobles; excedente → triples. */
function clasificarMinutosDia(minutosExtra) {
  const m = toFiniteMin(minutosExtra);
  return {
    minutosDobles: Math.min(m, MAX_DOBLES_POR_DIA_MIN),
    minutosTriples: Math.max(0, m - MAX_DOBLES_POR_DIA_MIN)
  };
}

/**
 * Clasifica HE del período con tope diario (3 h) y semanal (9 h).
 * @param {Array<{ fecha: Date|string, minutosExtra: number }>} dias
 */
function clasificarHorasExtraPeriodo(dias = []) {
  const weekDoblesUsados = new Map();
  let minutosDobles = 0;
  let minutosTriples = 0;

  const sorted = [...dias].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  for (const day of sorted) {
    const { minutosDobles: dDia, minutosTriples: tDia } = clasificarMinutosDia(day.minutosExtra);
    minutosTriples += tDia;

    const wk = weekKey(day.fecha);
    const usados = weekDoblesUsados.get(wk) || 0;
    const cupo = Math.max(0, MAX_DOBLES_POR_SEMANA_MIN - usados);
    const doblesOk = Math.min(dDia, cupo);
    minutosDobles += doblesOk;
    minutosTriples += dDia - doblesOk;
    weekDoblesUsados.set(wk, usados + doblesOk);
  }

  return {
    minutosDobles,
    minutosTriples,
    horasExtraDobles: minutosDobles / 60,
    horasExtraTriples: minutosTriples / 60
  };
}

/**
 * Fallback sin desglose diario: solo tope semanal de 9 h (compat).
 * @param {number} totalHoras
 */
function repartirHorasExtraTotal(totalHoras) {
  const h = toFiniteMin(totalHoras);
  if (h <= 9) return { horasExtraDobles: h, horasExtraTriples: 0 };
  return { horasExtraDobles: 9, horasExtraTriples: h - 9 };
}

module.exports = {
  MAX_DOBLES_POR_DIA_MIN,
  MAX_DOBLES_POR_SEMANA_MIN,
  weekKey,
  clasificarMinutosDia,
  clasificarHorasExtraPeriodo,
  repartirHorasExtraTotal
};
