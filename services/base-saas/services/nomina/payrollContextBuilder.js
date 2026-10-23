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
  'llegadasTarde',
  'domingosTrabajados'
];

const { metricasFamilia } = require('../../libs/empleadoFamilia');

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

  const numEmpleado = String(emp.numEmpleado ?? emp.numeroEmpleado ?? '').trim();
  const numEmpleadoNum = Number(numEmpleado);
  const departamento = String(emp.departamento ?? emp.departamentoNombre ?? '').trim();
  const departamentoCodigo = String(emp.departamentoCodigo ?? '').trim();
  const departamentoCodigoNum = Number(departamentoCodigo);

  const fam = metricasFamilia(emp, per);

  const EMPLEADO = {
    salarioDiario: toNum(emp.salarioDiario ?? emp.sueldoDiario),
    sueldoDiario: toNum(emp.salarioDiario ?? emp.sueldoDiario),
    horasJornada: toNum(emp.horasJornada ?? atributos.horasJornada, 8),
    valorHora: toNum(
      emp.valorHora ??
        atributos.valorHora ??
        (toNum(emp.salarioDiario ?? emp.sueldoDiario) /
          toNum(emp.horasJornada ?? atributos.horasJornada, 8))
    ),
    maxHorasOrdinariasSemana: toNum(emp.maxHorasOrdinariasSemana ?? atributos.maxHorasOrdinariasSemana, 46),
    tipoJornadaCfdi: String(emp.tipoJornadaCfdi || atributos.tipoJornadaCfdi || '01'),
    antiguedadAnios: toNum(emp.antiguedadAnios),
    sdi: toNum(emp.sdi ?? emp.salarioDiario ?? emp.sueldoDiario),
    sbc: toNum(emp.sbc),
    tipoSalario: String(emp.tipoSalario || 'fijo').trim() || 'fijo',
    tipoEmpleado: String(emp.tipoEmpleado || '').trim(),
    // Útiles en condiciones: si(EMPLEADO.numEmpleado == "1234", …) / si(EMPLEADO.departamento == "Ventas", …)
    numEmpleado,
    numeroEmpleado: numEmpleado,
    numero: Number.isFinite(numEmpleadoNum) ? numEmpleadoNum : 0,
    departamento,
    departamentoNombre: departamento,
    // codigoExterno / legado del catálogo (p.ej. "20" para AC LINE I AC28)
    departamentoCodigo,
    departamentoCodigoNum: Number.isFinite(departamentoCodigoNum) ? departamentoCodigoNum : 0,
    departamentoId: String(emp.departamentoId || '').trim(),
    hijos: fam.hijos,
    hijosMenores: fam.hijosMenores,
    hijosEscolares: fam.hijosEscolares,
    tieneConyuge: fam.tieneConyuge,
    nacimientoEnPeriodo: fam.nacimientoEnPeriodo,
    atributos
  };

  const diasTrabajados = toNum(per.diasTrabajados ?? per.diasLaborados);
  const diasPagados = toNum(per.diasPagados ?? per.diasLaborados ?? diasTrabajados);
  const diasCotizacion = toNum(per.diasCotizacion ?? diasPagados);
  const PERIODO = {
    diasPeriodo: toNum(per.diasPeriodo),
    diasTrabajados,
    diasLaborados: diasTrabajados,
    diasPagados,
    diasCotizacion,
    diasProgramados: toNum(per.diasProgramados),
    diasDescanso: toNum(per.diasDescanso),
    diasDescansoPagados: toNum(per.diasDescansoPagados),
    domingosEnPeriodo: toNum(per.domingosEnPeriodo),
    faltas: toNum(per.faltas ?? inc.faltas)
  };

  const minutosRetardo = toNum(inc.minutosRetardo);
  const diasConRetardo = toNum(inc.diasConRetardo ?? inc.llegadasTarde);
  const llegadasTarde = toNum(inc.llegadasTarde ?? diasConRetardo);
  const domingosTrabajados = toNum(inc.domingosTrabajados);

  const INCIDENCIAS = {
    faltas: toNum(inc.faltas ?? per.faltas),
    horasExtraDobles: toNum(inc.horasExtraDobles),
    horasExtraTriples: toNum(inc.horasExtraTriples),
    minutosRetardo,
    minutosSalidaAnticipada: toNum(inc.minutosSalidaAnticipada),
    diasConRetardo,
    llegadasTarde,
    domingosTrabajados,
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
    diasPagados: PERIODO.diasPagados,
    diasCotizacion: PERIODO.diasCotizacion,
    diasProgramados: PERIODO.diasProgramados,
    diasDescanso: PERIODO.diasDescanso,
    diasDescansoPagados: PERIODO.diasDescansoPagados,
    domingosEnPeriodo: PERIODO.domingosEnPeriodo,
    domingosTrabajados: INCIDENCIAS.domingosTrabajados,
    faltas: INCIDENCIAS.faltas,
    sueldoDiario: EMPLEADO.salarioDiario,
    salarioDiario: EMPLEADO.salarioDiario,
    horasJornada: EMPLEADO.horasJornada,
    valorHora: EMPLEADO.valorHora,
    horasExtraDobles: INCIDENCIAS.horasExtraDobles,
    horasExtraTriples: INCIDENCIAS.horasExtraTriples,
    antiguedadAnios: EMPLEADO.antiguedadAnios,
    sdi: EMPLEADO.sdi,
    sbc: EMPLEADO.sbc || Math.min(EMPLEADO.sdi || EMPLEADO.salarioDiario, PARAMETROS.uma * 25 || Infinity),
    tipoSalario: EMPLEADO.tipoSalario,
    numEmpleado: EMPLEADO.numEmpleado,
    numeroEmpleado: EMPLEADO.numEmpleado,
    numero: EMPLEADO.numero,
    departamento: EMPLEADO.departamento,
    departamentoNombre: EMPLEADO.departamento,
    departamentoCodigo: EMPLEADO.departamentoCodigo,
    departamentoCodigoNum: EMPLEADO.departamentoCodigoNum,
    uma: PARAMETROS.uma,
    salarioMinimo: PARAMETROS.salarioMinimo,
    minutosRetardo: INCIDENCIAS.minutosRetardo,
    minutosSalidaAnticipada: INCIDENCIAS.minutosSalidaAnticipada,
    diasConRetardo: INCIDENCIAS.diasConRetardo,
    llegadasTarde: INCIDENCIAS.llegadasTarde,
    sinRetardo: INCIDENCIAS.sinRetardo,
    sinFaltas: INCIDENCIAS.sinFaltas,
    hijos: EMPLEADO.hijos,
    hijosMenores: EMPLEADO.hijosMenores,
    hijosEscolares: EMPLEADO.hijosEscolares,
    tieneConyuge: EMPLEADO.tieneConyuge,
    nacimientoEnPeriodo: EMPLEADO.nacimientoEnPeriodo,
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
