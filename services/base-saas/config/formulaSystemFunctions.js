'use strict';

/**
 * Funciones de sistema disponibles en fórmulas de nómina (mathjs scope).
 * No es JS libre: whitelist fija + implementaciones seguras.
 *
 * Uso en fórmulas:
 *   si(aplicaFondoAhorro == 1, fondoAhorroEmpresa, 0)
 *   redondear(sueldoDiario * diasLaborados, 2)
 */

const FORMULA_SYSTEM_FUNCTIONS = [
  {
    name: 'si',
    signature: 'si(condicion, siVerdadero, siFalso)',
    descripcion: 'Si condicion ≠ 0 / true, regresa siVerdadero; si no, siFalso.',
    ejemplo: 'si(aplicaFondoAhorro == 1, fondoAhorroEmpresa, 0)'
  },
  {
    name: 'redondear',
    signature: 'redondear(valor, decimales?)',
    descripcion: 'Redondeo bancario a N decimales (default 2). Preferir sobre round().',
    ejemplo: 'redondear(sueldoDiario * diasLaborados, 2)'
  },
  {
    name: 'min',
    signature: 'min(a, b, …)',
    descripcion: 'Mínimo de los argumentos.',
    ejemplo: 'min(fondoAhorroEmpresa, fondoAhorroTopeExento)'
  },
  {
    name: 'max',
    signature: 'max(a, b, …)',
    descripcion: 'Máximo de los argumentos.',
    ejemplo: 'max(0, fondoAhorroEmpresaGravado)'
  },
  {
    name: 'abs',
    signature: 'abs(x)',
    descripcion: 'Valor absoluto.',
    ejemplo: 'abs(ISR_DIFERENCIA)'
  },
  {
    name: 'round',
    signature: 'round(x)',
    descripcion: 'Math.round de un argumento (entero). Preferir redondear(x, n).',
    ejemplo: 'round(importe)'
  },
  {
    name: 'floor',
    signature: 'floor(x)',
    descripcion: 'Entero hacia abajo.',
    ejemplo: 'floor(diasLaborados)'
  },
  {
    name: 'ceil',
    signature: 'ceil(x)',
    descripcion: 'Entero hacia arriba.',
    ejemplo: 'ceil(diasLaborados)'
  },
  {
    name: 'aplicarTabla',
    signature: 'aplicarTabla(monto, "CODIGO_TABLA")',
    descripcion: 'Aplica tabla fiscal vigente (ej. ISR_MENSUAL).',
    ejemplo: 'aplicarTabla(PERCEPCIONES_GRAVADAS, "ISR_MENSUAL")'
  },
  {
    name: 'topeUMA',
    signature: 'topeUMA(valor, veces)',
    descripcion: 'min(valor, UMA × veces).',
    ejemplo: 'topeUMA(importe, 5)'
  },
  {
    name: 'isrPeriodo',
    signature: 'isrPeriodo(gravado)',
    descripcion: 'ISR del período según tabla del tipo de período.',
    ejemplo: 'isrPeriodo(PERCEPCIONES_GRAVADAS)'
  },
  {
    name: 'imssObrero',
    signature: 'imssObrero(sueldoDiario, dias)',
    descripcion: 'Cuota obrero IMSS del período (usa SDI interno).',
    ejemplo: 'imssObrero(sueldoDiario, diasCotizacion)'
  },
  {
    name: 'imssPatronal',
    signature: 'imssPatronal(sueldoDiario, dias)',
    descripcion: 'Cuota patronal IMSS (informativa).',
    ejemplo: 'imssPatronal(sueldoDiario, diasCotizacion)'
  }
];

const FORMULA_SYSTEM_FUNCTION_NAMES = FORMULA_SYSTEM_FUNCTIONS.map((f) => f.name);

function buildSystemFunctionImplementations(parametros = {}, tablaFns = {}) {
  return {
    si: (condicion, siVerdadero, siFalso) => {
      const ok =
        typeof condicion === 'boolean'
          ? condicion
          : Number(condicion) !== 0 && condicion != null && condicion !== '';
      return ok ? siVerdadero : siFalso;
    },
    redondear: (valor, decimales = 2) => {
      const n = Number(valor);
      if (!Number.isFinite(n)) return 0;
      const d = Number(decimales);
      const places = Number.isFinite(d) && d >= 0 ? Math.min(8, Math.floor(d)) : 2;
      const factor = 10 ** places;
      return Math.round((n + Number.EPSILON) * factor) / factor;
    },
    aplicarTabla: tablaFns.aplicarTabla || (() => 0),
    topeUMA:
      tablaFns.topeUMA ||
      ((valor, veces) => Math.min(Number(valor) || 0, (parametros.uma || 0) * (veces || 1))),
    isrPeriodo: tablaFns.isrPeriodo || (() => 0),
    imssObrero: tablaFns.imssObrero || (() => 0),
    imssPatronal: tablaFns.imssPatronal || (() => 0),
    min: Math.min,
    max: Math.max,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil
  };
}

module.exports = {
  FORMULA_SYSTEM_FUNCTIONS,
  FORMULA_SYSTEM_FUNCTION_NAMES,
  buildSystemFunctionImplementations
};
