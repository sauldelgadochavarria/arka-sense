'use strict';

/**
 * Esquema de jornada (Reformas laborales 2027 / LFT).
 * Valores por defecto configurables por turno; no hardcodear ÷8 en el motor.
 */

const ESQUEMA_JORNADA_DEFAULTS = Object.freeze({
  esquemaId: 'JORNADA_DIURNA_2027',
  /** Tope semanal de horas ordinarias (meta reforma: 46). */
  maxHorasOrdinariasSemana: 46,
  /** Tope semanal HE al doble (LFT art. 66). */
  maxHorasExtraDoblesSemana: 9,
  /** Tope absoluto diario ordinarias + extras (Art. 68). */
  maxHorasTotalesDia: 12,
  /** Tope diario HE al doble (LFT). */
  maxHorasExtraDoblesDia: 3,
  /**
   * Base del salario semanal para valor hora:
   * - siete: SD × 7 (semana IMSS)
   * - dias_laborables: SD × días del turno
   */
  baseSalarioSemanal: 'siete',
  /** Catálogo SAT c_TipoJornada (01 Diurna, 02 Nocturna, 03 Mixta, …). */
  tipoJornadaCfdi: '01'
});

const TIPOS_JORNADA_CFDI = [
  { value: '01', label: 'Diurna' },
  { value: '02', label: 'Nocturna' },
  { value: '03', label: 'Mixta' },
  { value: '04', label: 'Por hora' },
  { value: '05', label: 'Reducida' },
  { value: '06', label: 'Continuada' },
  { value: '07', label: 'Partida' },
  { value: '08', label: 'Por turnos' },
  { value: '99', label: 'Otra jornada' }
];

function toPos(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Resuelve esquema efectivo desde un turno (o vacío → defaults 2027).
 * @param {object|null} turno
 */
function resolveEsquemaJornada(turno = null) {
  const t = turno || {};
  return {
    esquemaId: String(t.esquemaId || ESQUEMA_JORNADA_DEFAULTS.esquemaId).trim() || ESQUEMA_JORNADA_DEFAULTS.esquemaId,
    maxHorasOrdinariasSemana: toPos(
      t.maxHorasOrdinariasSemana,
      ESQUEMA_JORNADA_DEFAULTS.maxHorasOrdinariasSemana
    ),
    maxHorasExtraDoblesSemana: toPos(
      t.maxHorasExtraDoblesSemana,
      ESQUEMA_JORNADA_DEFAULTS.maxHorasExtraDoblesSemana
    ),
    maxHorasTotalesDia: toPos(t.maxHorasTotalesDia, ESQUEMA_JORNADA_DEFAULTS.maxHorasTotalesDia),
    maxHorasExtraDoblesDia: toPos(
      t.maxHorasExtraDoblesDia,
      ESQUEMA_JORNADA_DEFAULTS.maxHorasExtraDoblesDia
    ),
    baseSalarioSemanal:
      t.baseSalarioSemanal === 'dias_laborables' ? 'dias_laborables' : 'siete',
    tipoJornadaCfdi: String(t.tipoJornadaCfdi || ESQUEMA_JORNADA_DEFAULTS.tipoJornadaCfdi).trim() || '01',
    horasJornada: toPos(t.horasJornada, 8),
    diasLaborablesCount: Array.isArray(t.diasLaborables) && t.diasLaborables.length
      ? t.diasLaborables.length
      : 5
  };
}

/**
 * Valor hora reforma 2027: Salario_Semanal / max_horas_ordinarias.
 * Fallback legado: salarioDiario / horasJornada (si max ordinarias inválido).
 */
function computeValorHora(salarioDiario, turnoOrEsquema = null) {
  const sd = Number(salarioDiario) || 0;
  if (sd <= 0) return 0;

  const esquema = resolveEsquemaJornada(turnoOrEsquema);
  const maxOrd = esquema.maxHorasOrdinariasSemana;
  const dias =
    esquema.baseSalarioSemanal === 'dias_laborables'
      ? Math.max(1, esquema.diasLaborablesCount || 5)
      : 7;
  const salarioSemanal = sd * dias;

  if (maxOrd > 0) {
    return salarioSemanal / maxOrd;
  }

  const hj = esquema.horasJornada > 0 ? esquema.horasJornada : 8;
  return sd / hj;
}

/** Soft check: horasJornada del turno no debe superar tope diario (hard). Semanal = warning. */
function validateTurnoVsEsquema(turnoPartial = {}) {
  const esquema = resolveEsquemaJornada(turnoPartial);
  const hj = toPos(turnoPartial.horasJornada, esquema.horasJornada);
  const warnings = [];
  const errors = [];
  if (hj > esquema.maxHorasTotalesDia) {
    errors.push(
      `horasJornada (${hj}) supera maxHorasTotalesDia (${esquema.maxHorasTotalesDia}) — Art. 68`
    );
  }
  const ordinariasSemana = hj * (esquema.diasLaborablesCount || 5);
  if (ordinariasSemana > esquema.maxHorasOrdinariasSemana + 0.01) {
    warnings.push(
      `Horas ordinarias semanales programadas (~${ordinariasSemana.toFixed(1)}) superan el tope del esquema (${esquema.maxHorasOrdinariasSemana})`
    );
  }
  return { ok: errors.length === 0, errors, warnings, esquema };
}

module.exports = {
  ESQUEMA_JORNADA_DEFAULTS,
  TIPOS_JORNADA_CFDI,
  resolveEsquemaJornada,
  computeValorHora,
  validateTurnoVsEsquema
};
