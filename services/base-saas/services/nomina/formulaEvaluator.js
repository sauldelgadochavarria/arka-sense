'use strict';

const { create, all, parse } = require('mathjs');

const FUNCIONES_PERMITIDAS = ['min', 'max', 'abs', 'round', 'floor', 'ceil', 'aplicarTabla', 'topeUMA', 'isrPeriodo', 'imssObrero', 'imssPatronal'];

function redondear(valor, decimales = 2) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

/**
 * En mathjs `=` es asignación (devuelve el valor asignado).
 * En condiciones de nómina el usuario casi siempre quiere comparación `==`.
 * Respeta <=, >=, !=, ==, ===.
 */
function normalizeConditionComparisons(expr) {
  if (!expr || !String(expr).trim()) return '';
  return String(expr).replace(/(?<![!<>=])=(?!=)/g, '==');
}

function createFormulaScope(parametros = {}, tablaFns = {}) {
  const scope = create(all, { override: true });
  scope.import(
    {
      aplicarTabla: tablaFns.aplicarTabla || (() => 0),
      topeUMA: tablaFns.topeUMA || ((valor, veces) => Math.min(Number(valor) || 0, (parametros.uma || 0) * (veces || 1))),
      isrPeriodo: tablaFns.isrPeriodo || (() => 0),
      imssObrero: tablaFns.imssObrero || (() => 0),
      imssPatronal: tablaFns.imssPatronal || (() => 0),
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      round: Math.round,
      floor: Math.floor,
      ceil: Math.ceil
    },
    { override: true }
  );
  return scope;
}

function evaluateExpression(expr, contexto, scope) {
  if (!expr || !String(expr).trim()) return 0;
  try {
    return scope.evaluate(String(expr).trim(), contexto);
  } catch (err) {
    throw new Error(`Error al evaluar expresión "${expr}": ${err.message}`);
  }
}

function evaluateCondicion(condicion, contexto, scope) {
  if (!condicion || !String(condicion).trim()) return true;
  const normalizada = normalizeConditionComparisons(condicion);
  const result = evaluateExpression(normalizada, contexto, scope);
  if (typeof result === 'boolean') return result;
  if (typeof result === 'number') return result !== 0;
  return Boolean(result);
}

function extractVariablesUsadas(formula, contexto) {
  const usadas = {};
  if (!formula || !String(formula).trim()) return usadas;

  try {
    const tree = parse(String(formula));
    const symbols = new Set();
    tree.traverse((node) => {
      if (node.isSymbolNode && !FUNCIONES_PERMITIDAS.includes(node.name)) {
        symbols.add(node.name);
      }
    });
    for (const sym of symbols) {
      if (Object.prototype.hasOwnProperty.call(contexto, sym)) {
        usadas[sym] = contexto[sym];
      }
    }
  } catch {
    // si no parsea, no guardamos variables
  }
  return usadas;
}

function validateFormulaSyntax(formula) {
  if (!formula || !String(formula).trim()) {
    throw new Error('La fórmula no puede estar vacía');
  }
  parse(String(formula).trim());
}

module.exports = {
  redondear,
  createFormulaScope,
  evaluateExpression,
  evaluateCondicion,
  extractVariablesUsadas,
  validateFormulaSyntax,
  normalizeConditionComparisons
};
