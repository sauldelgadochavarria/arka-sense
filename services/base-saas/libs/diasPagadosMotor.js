'use strict';

const { POLITICA_DESCANSO_DEFAULT } = require('../config/politicaDescansoDefaults');

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mergePolitica(empresaPolitica = {}, overrides = {}) {
  return {
    ...POLITICA_DESCANSO_DEFAULT,
    ...(empresaPolitica || {}),
    ...(overrides || {})
  };
}

function resolverDiasEstructura(periodo, tipoPeriodoRef, politica) {
  const diasCalendario = Math.max(1, toNum(periodo.diasPeriodo, 7));
  const tipoMotor = String(periodo.tipoPeriodo || tipoPeriodoRef?.tipoMotor || '').toLowerCase();

  let diasProgramados =
    politica.diasProgramadosPorPeriodo != null
      ? toNum(politica.diasProgramadosPorPeriodo)
      : tipoPeriodoRef?.diasLaborables != null
        ? toNum(tipoPeriodoRef.diasLaborables)
        : null;

  let diasDescanso =
    politica.diasDescansoPorPeriodo != null
      ? toNum(politica.diasDescansoPorPeriodo)
      : null;

  if (diasProgramados == null) {
    if (tipoMotor === 'semanal') diasProgramados = 5;
    else if (tipoMotor === 'catorcenal') diasProgramados = 10;
    else if (tipoMotor === 'decena' || tipoMotor === 'decenal') diasProgramados = 8;
    else if (tipoMotor === 'quincenal') diasProgramados = 12;
    else if (tipoMotor === 'mensual') diasProgramados = 24;
    else diasProgramados = Math.max(1, diasCalendario - Math.floor(diasCalendario / 7));
  }

  if (diasDescanso == null) {
    if (tipoPeriodoRef && tipoPeriodoRef.esSeptimo === false) {
      diasDescanso = 0;
    } else {
      diasDescanso = Math.max(0, diasCalendario - diasProgramados);
    }
  }

  return {
    diasCalendario,
    diasProgramados: Math.max(0, diasProgramados),
    diasDescanso: Math.max(0, diasDescanso),
    tipoMotor,
    esSeptimo: tipoPeriodoRef?.esSeptimo !== false && diasDescanso > 0
  };
}

/**
 * Motor de reglas: días pagados / descanso pagado.
 *
 * @param {object} input
 * @param {object} input.periodo
 * @param {object} [input.tipoPeriodoRef]
 * @param {object} [input.politica]
 * @param {number} input.diasLaborados - efectivamente laborados
 * @param {number} [input.faltasInjustificadas]
 * @param {number} [input.faltasJustificadas]
 * @param {number} [input.diasIncapacidad]
 * @param {number} [input.diasVacaciones]
 * @param {number} [input.diasPermisoConGoce]
 */
function calcularDiasPagados(input = {}) {
  const politica = mergePolitica(input.politica);
  const estructura = resolverDiasEstructura(input.periodo || {}, input.tipoPeriodoRef, politica);

  const diasLaborados = Math.max(0, toNum(input.diasLaborados));
  const faltasInjustificadas = Math.max(0, toNum(input.faltasInjustificadas));
  const faltasJustificadas = Math.max(0, toNum(input.faltasJustificadas));
  const diasIncapacidad = Math.max(0, toNum(input.diasIncapacidad));
  const diasVacaciones = Math.max(0, toNum(input.diasVacaciones));
  const diasPermisoConGoce = Math.max(0, toNum(input.diasPermisoConGoce));

  const justificadasParaDescanso =
    (politica.cuentaJustificadasComoCumplidas ? faltasJustificadas : 0) +
    (politica.pagaDescansoConIncapacidad ? diasIncapacidad : 0) +
    (politica.pagaDescansoConVacaciones ? diasVacaciones : 0) +
    (politica.pagaDescansoConPermisoConGoce ? diasPermisoConGoce : 0);

  const diasCumplidosParaDescanso = diasLaborados + justificadasParaDescanso;
  const programados = Math.max(1, estructura.diasProgramados);

  let diasDescansoPagados = 0;
  let reglaAplicada = 'inactivo';

  if (!politica.activo || estructura.diasDescanso <= 0) {
    diasDescansoPagados = 0;
    reglaAplicada = 'sin_descanso_o_inactivo';
  } else if (politica.modoDescanso === 'ninguno') {
    diasDescansoPagados = 0;
    reglaAplicada = 'ninguno';
  } else if (politica.modoDescanso === 'conservar') {
    diasDescansoPagados = estructura.diasDescanso;
    reglaAplicada = 'conservar';
  } else if (politica.modoDescanso === 'proporcional') {
    const ratio = Math.min(1, diasCumplidosParaDescanso / programados);
    diasDescansoPagados = Math.round(estructura.diasDescanso * ratio * 100) / 100;
    if (
      politica.pierdeDescansoConUnaFaltaInjustificada &&
      faltasInjustificadas > 0 &&
      ratio < 1
    ) {
      // En proporcional, falta injustificada puede anular el resto no ganado
      diasDescansoPagados = Math.min(
        diasDescansoPagados,
        Math.round(estructura.diasDescanso * (diasLaborados / programados) * 100) / 100
      );
    }
    reglaAplicada = 'proporcional';
  } else {
    // todo_o_nada (default / práctica frecuente)
    if (politica.pierdeDescansoConUnaFaltaInjustificada && faltasInjustificadas > 0) {
      diasDescansoPagados = 0;
      reglaAplicada = 'todo_o_nada_perdida_por_falta';
    } else if (diasCumplidosParaDescanso >= programados) {
      diasDescansoPagados = estructura.diasDescanso;
      reglaAplicada = 'todo_o_nada_completo';
    } else if (faltasInjustificadas === 0 && justificadasParaDescanso > 0) {
      diasDescansoPagados = estructura.diasDescanso;
      reglaAplicada = 'todo_o_nada_justificadas_ok';
    } else {
      diasDescansoPagados = 0;
      reglaAplicada = 'todo_o_nada_incompleto';
    }
  }

  const diasPagados = Math.round((diasLaborados + diasDescansoPagados) * 100) / 100;
  const diasCotizacion = politica.imssUsaDiasPagados ? diasPagados : diasLaborados;

  return {
    diasCalendario: estructura.diasCalendario,
    diasProgramados: estructura.diasProgramados,
    diasLaborados,
    faltasInjustificadas,
    faltasJustificadas,
    diasIncapacidad,
    diasVacaciones,
    diasPermisoConGoce,
    diasDescanso: estructura.diasDescanso,
    diasDescansoPagados,
    diasPagados,
    diasCotizacion,
    reglaAplicada,
    modoDescanso: politica.modoDescanso,
    politicaResumen: {
      activo: politica.activo,
      modoDescanso: politica.modoDescanso,
      pierdeDescansoConUnaFaltaInjustificada: politica.pierdeDescansoConUnaFaltaInjustificada,
      notas: politica.notas || ''
    }
  };
}

module.exports = {
  calcularDiasPagados,
  mergePolitica,
  resolverDiasEstructura,
  POLITICA_DESCANSO_DEFAULT
};
