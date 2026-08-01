'use strict';

/**
 * Construye el contexto de cálculo con namespaces + alias planos.
 * INCIDENCIAS / EMPLEADO.atributos aceptan claves extra (flex) sin tocar el motor.
 */

const CORE_INCIDENCIA_KEYS = [
  'faltas',
  'horasExtraDobles',
  'horasExtraTriples',
  'minutosRetardo',
  'minutosSalidaAnticipada',
  'diasConRetardo',
  'llegadasTarde'
];

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickNumericExtras(source = {}, reserved = []) {
  const skip = new Set(reserved);
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (skip.has(k)) continue;
    if (v == null || typeof v === 'object') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function buildNamespacedContext({ empleado, periodo, incidencias, parametros, extras = {}, resultadosPrevios = {} }) {
  const emp = empleado || {};
  const per = periodo || {};
  const inc = incidencias || {};
  const par = parametros || {};

  const atributos = { ...(emp.atributos || {}) };
  // Flex JSON del empleado / config nómina → EMPLEADO.atributos.*
  if (emp.nominaConfig && typeof emp.nominaConfig === 'object') {
    for (const [k, v] of Object.entries(emp.nominaConfig)) {
      if (atributos[k] == null && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) {
        atributos[k] = v;
      }
    }
  }

  const EMPLEADO = {
    salarioDiario: toNum(emp.salarioDiario ?? emp.sueldoDiario),
    sueldoDiario: toNum(emp.salarioDiario ?? emp.sueldoDiario),
    horasJornada: toNum(emp.horasJornada ?? atributos.horasJornada, 8),
    antiguedadAnios: toNum(emp.antiguedadAnios),
    sbc: toNum(emp.sbc),
    atributos
  };

  const diasTrabajados = toNum(per.diasTrabajados ?? per.diasLaborados);
  const PERIODO = {
    diasPeriodo: toNum(per.diasPeriodo),
    diasTrabajados,
    diasLaborados: diasTrabajados,
    faltas: toNum(per.faltas ?? inc.faltas)
  };

  const minutosRetardo = toNum(inc.minutosRetardo);
  const diasConRetardo = toNum(inc.diasConRetardo ?? inc.llegadasTarde);
  const llegadasTarde = toNum(inc.llegadasTarde ?? diasConRetardo);

  const INCIDENCIAS = {
    faltas: toNum(inc.faltas ?? per.faltas),
    horasExtraDobles: toNum(inc.horasExtraDobles),
    horasExtraTriples: toNum(inc.horasExtraTriples),
    minutosRetardo,
    minutosSalidaAnticipada: toNum(inc.minutosSalidaAnticipada),
    diasConRetardo,
    llegadasTarde,
    // Flags 0/1 útiles en condiciones (mathjs no tiene booleanos nativos cómodos)
    sinRetardo: minutosRetardo === 0 && llegadasTarde === 0 ? 1 : 0,
    sinFaltas: toNum(inc.faltas ?? per.faltas) === 0 ? 1 : 0,
    ...pickNumericExtras(inc, CORE_INCIDENCIA_KEYS)
  };

  const PARAMETROS = {
    uma: toNum(par.uma),
    salarioMinimo: toNum(par.salarioMinimo),
    ...pickNumericExtras(par, ['uma', 'salarioMinimo'])
  };

  // Extras libres de la corrida (empresa / plantilla / pruebas)
  const EXTRAS = pickNumericExtras(extras);

  const flat = {
    diasPeriodo: PERIODO.diasPeriodo,
    diasLaborados: PERIODO.diasLaborados,
    diasTrabajados: PERIODO.diasTrabajados,
    faltas: INCIDENCIAS.faltas,
    sueldoDiario: EMPLEADO.salarioDiario,
    salarioDiario: EMPLEADO.salarioDiario,
    horasJornada: EMPLEADO.horasJornada,
    horasExtraDobles: INCIDENCIAS.horasExtraDobles,
    horasExtraTriples: INCIDENCIAS.horasExtraTriples,
    antiguedadAnios: EMPLEADO.antiguedadAnios,
    uma: PARAMETROS.uma,
    salarioMinimo: PARAMETROS.salarioMinimo,
    sbc: EMPLEADO.sbc || Math.min(EMPLEADO.salarioDiario, PARAMETROS.uma * 25 || Infinity),
    minutosRetardo: INCIDENCIAS.minutosRetardo,
    minutosSalidaAnticipada: INCIDENCIAS.minutosSalidaAnticipada,
    diasConRetardo: INCIDENCIAS.diasConRetardo,
    llegadasTarde: INCIDENCIAS.llegadasTarde,
    sinRetardo: INCIDENCIAS.sinRetardo,
    sinFaltas: INCIDENCIAS.sinFaltas,
    ...EXTRAS,
    ...resultadosPrevios
  };

  return {
    EMPLEADO,
    PERIODO,
    INCIDENCIAS,
    PARAMETROS,
    EXTRAS,
    ...flat
  };
}

module.exports = { buildNamespacedContext, pickNumericExtras, CORE_INCIDENCIA_KEYS };
