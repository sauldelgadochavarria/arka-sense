'use strict';

const { create, all, parse } = require('mathjs');
const {
  FORMULA_SYSTEM_FUNCTION_NAMES,
  FORMULA_SYSTEM_FUNCTIONS,
  buildSystemFunctionImplementations
} = require('../../config/formulaSystemFunctions');

const FUNCIONES_PERMITIDAS = FORMULA_SYSTEM_FUNCTION_NAMES;

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

function createFormulaScope(parametros = {}, tablaFns = {}, catalogFns = null) {
  const scope = create(all, { override: true });
  const base = buildSystemFunctionImplementations(parametros, tablaFns);
  const merged = catalogFns && typeof catalogFns === 'object' ? { ...base, ...catalogFns } : base;
  scope.import(merged, { override: true });
  return scope;
}

/**
 * Crea scope incluyendo funciones del catálogo admin (async).
 */
async function createFormulaScopeWithCatalog(parametros = {}, tablaFns = {}) {
  const { buildCatalogFunctionImplementations } = require('./formulaFunctionsService');
  const catalogFns = await buildCatalogFunctionImplementations(parametros, tablaFns);
  return createFormulaScope(parametros, tablaFns, catalogFns);
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
  // Símbolos aún no calculados → 0 (evita tumbar ISR si el orden falla)
  let tree;
  try {
    tree = parse(normalizada);
  } catch {
    return Boolean(evaluateExpression(normalizada, contexto, scope));
  }
  const ctx = { ...contexto };
  tree.traverse((node) => {
    if (node.isSymbolNode && !Object.prototype.hasOwnProperty.call(ctx, node.name)) {
      ctx[node.name] = 0;
    }
  });
  const result = evaluateExpression(normalizada, ctx, scope);
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
  createFormulaScopeWithCatalog,
  evaluateExpression,
  evaluateCondicion,
  extractVariablesUsadas,
  validateFormulaSyntax,
  normalizeConditionComparisons,
  FUNCIONES_PERMITIDAS,
  FORMULA_SYSTEM_FUNCTIONS
};
