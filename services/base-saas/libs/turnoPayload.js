'use strict';

const {
  trimString,
  parsePositiveNumber,
  parseOptionalPositiveNumber,
  parseCheckbox
} = require('./formHelpers');
const { parseTimeHHMM } = require('./timeHelpers');
const { HOLGURA_DEFAULT_MIN } = require('../config/asistencia');
const {
  ESQUEMA_JORNADA_DEFAULTS,
  validateTurnoVsEsquema
} = require('./esquemaJornada');

const TIPOS_TURNO_VALIDOS = ['fijo', 'flexible', 'nocturno', 'remoto', 'por_horas'];
const MODOS_TOLERANCIA_VALIDOS = ['normal', 'concorte'];
const BASES_SALARIO_SEMANAL = ['siete', 'dias_laborables'];

function parseDiasLaborables(body) {
  const raw = body.diasLaborables;
  if (Array.isArray(raw)) {
    return raw.map((d) => Number(d)).filter((d) => !Number.isNaN(d));
  }
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    return Number.isNaN(n) ? [1, 2, 3, 4, 5] : [n];
  }
  const selected = [];
  for (const key of Object.keys(body)) {
    const match = /^dia_(\d)$/.exec(key);
    if (match && (body[key] === 'on' || body[key] === 'true' || body[key] === true || body[key] === '1')) {
      selected.push(Number(match[1]));
    }
  }
  return selected.length ? selected : [1, 2, 3, 4, 5];
}

function buildTurnoPayload(body, tenantId, empresaId) {
  const horaEntrada = trimString(body.horaEntrada);
  const horaSalida = trimString(body.horaSalida);
  if (!parseTimeHHMM(horaEntrada) || !parseTimeHHMM(horaSalida)) {
    throw new Error('INVALID_SHIFT_TIME');
  }

  const tipo = trimString(body.tipo);
  const modoTolerancia = trimString(body.modoTolerancia);
  const comidaChecada = parseCheckbox(body, 'comidaChecada');

  return {
    tenantId,
    empresaId,
    nombre: trimString(body.nombre),
    tipo: TIPOS_TURNO_VALIDOS.includes(tipo) ? tipo : 'fijo',
    diasLaborables: parseDiasLaborables(body),
    horaEntrada,
    horaSalida,
    toleranciaEntradaMin: parsePositiveNumber(body.toleranciaEntradaMin) ?? 10,
    toleranciaSalidaMin: parsePositiveNumber(body.toleranciaSalidaMin) ?? 5,
    modoTolerancia: MODOS_TOLERANCIA_VALIDOS.includes(modoTolerancia) ? modoTolerancia : 'normal',
    holguraAntesMin: parsePositiveNumber(body.holguraAntesMin) ?? HOLGURA_DEFAULT_MIN,
    holguraDespuesMin: parsePositiveNumber(body.holguraDespuesMin) ?? HOLGURA_DEFAULT_MIN,
    tiempoComidaMin: parsePositiveNumber(body.tiempoComidaMin) ?? 60,
    comidaChecada,
    noRegistrarComida: !comidaChecada,
    horasJornada: parsePositiveNumber(body.horasJornada) ?? 8,
    esquemaId: trimString(body.esquemaId) || ESQUEMA_JORNADA_DEFAULTS.esquemaId,
    maxHorasOrdinariasSemana:
      parsePositiveNumber(body.maxHorasOrdinariasSemana) ??
      ESQUEMA_JORNADA_DEFAULTS.maxHorasOrdinariasSemana,
    maxHorasExtraDoblesSemana:
      parsePositiveNumber(body.maxHorasExtraDoblesSemana) ??
      ESQUEMA_JORNADA_DEFAULTS.maxHorasExtraDoblesSemana,
    maxHorasTotalesDia:
      parsePositiveNumber(body.maxHorasTotalesDia) ?? ESQUEMA_JORNADA_DEFAULTS.maxHorasTotalesDia,
    maxHorasExtraDoblesDia:
      parsePositiveNumber(body.maxHorasExtraDoblesDia) ??
      ESQUEMA_JORNADA_DEFAULTS.maxHorasExtraDoblesDia,
    baseSalarioSemanal: BASES_SALARIO_SEMANAL.includes(trimString(body.baseSalarioSemanal))
      ? trimString(body.baseSalarioSemanal)
      : ESQUEMA_JORNADA_DEFAULTS.baseSalarioSemanal,
    tipoJornadaCfdi: trimString(body.tipoJornadaCfdi) || ESQUEMA_JORNADA_DEFAULTS.tipoJornadaCfdi,
    inicioHEOrdinariaMin: parsePositiveNumber(body.inicioHEOrdinariaMin) ?? 0,
    inicioHEDobleMin: parseOptionalPositiveNumber(body.inicioHEDobleMin),
    inicioHETripleMin: parseOptionalPositiveNumber(body.inicioHETripleMin),
    descansaSabado: parseCheckbox(body, 'descansaSabado'),
    descansaDomingo: parseCheckbox(body, 'descansaDomingo'),
    color: trimString(body.color) || '#2563eb',
    activo: body.activo !== 'off'
  };

  const check = validateTurnoVsEsquema(payload);
  if (!check.ok) {
    const err = new Error(check.errors.join('; ') || 'TURNO_EXCEDE_ESQUEMA');
    err.code = 'TURNO_EXCEDE_ESQUEMA';
    err.errors = check.errors;
    err.warnings = check.warnings;
    throw err;
  }
  payload._esquemaWarnings = check.warnings;

  return payload;
}

module.exports = { buildTurnoPayload, parseDiasLaborables };
