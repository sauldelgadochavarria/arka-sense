'use strict';

/**
 * Ejecutor restringido para funciones de fórmula tipo JavaScript (estilo NetSuite).
 * No es isolated-vm: sandbox Node vm + timeout + denylist básica.
 * Suficiente para admin interno; endurecer con isolated-vm en producción.
 */

const vm = require('vm');

const FORBIDDEN_RE =
  /\b(require|process|global|globalThis|Function|eval|import|export|Buffer|child_process|fs|net|http|https|__dirname|__filename)\b/;

const DEFAULT_TIMEOUT_MS = 80;

function assertSafeScript(cuerpo) {
  const src = String(cuerpo || '');
  if (!src.trim()) throw new Error('El script JS está vacío');
  if (FORBIDDEN_RE.test(src)) {
    throw new Error('Script no permitido: contiene APIs bloqueadas (require/process/eval/…)');
  }
  if (src.length > 20000) throw new Error('Script demasiado largo (máx. 20 KB)');
}

/**
 * Compila el cuerpo como función (args…) { <cuerpo> }
 * El cuerpo debe hacer return de un número.
 */
function compileJavascriptFunction(args, cuerpo) {
  assertSafeScript(cuerpo);
  const argNames = Array.isArray(args) ? args : [];
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...argNames, `"use strict";\n${cuerpo}`);
  } catch (err) {
    throw new Error(`JS inválido: ${err.message}`);
  }
  return fn;
}

function buildSandboxHelpers() {
  return {
    Math,
    Number,
    String,
    Boolean,
    Array,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    min: Math.min,
    max: Math.max,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    si: (cond, a, b) => {
      const ok =
        typeof cond === 'boolean' ? cond : Number(cond) !== 0 && cond != null && cond !== '';
      return ok ? a : b;
    },
    redondear: (valor, decimales = 2) => {
      const n = Number(valor);
      if (!Number.isFinite(n)) return 0;
      const d = Number(decimales);
      const places = Number.isFinite(d) && d >= 0 ? Math.min(8, Math.floor(d)) : 2;
      const factor = 10 ** places;
      return Math.round((n + Number.EPSILON) * factor) / factor;
    }
  };
}

/**
 * Ejecuta la función compilada dentro de vm con timeout.
 * @returns {number}
 */
function runJavascriptFunction(fn, argValues, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const sandbox = {
    ...buildSandboxHelpers(),
    __args: Array.isArray(argValues) ? argValues : [],
    __fn: fn,
    __result: undefined,
    __error: undefined
  };
  const code = `
    try {
      __result = __fn.apply(null, __args);
    } catch (e) {
      __error = e && e.message ? e.message : String(e);
    }
  `;
  try {
    vm.runInNewContext(code, sandbox, { timeout: timeoutMs, displayErrors: true });
  } catch (err) {
    if (String(err.message || err).includes('Script execution timed out')) {
      throw new Error(`Timeout (>${timeoutMs} ms)`);
    }
    throw new Error(`Error al ejecutar: ${err.message}`);
  }
  if (sandbox.__error) throw new Error(sandbox.__error);
  const n = Number(sandbox.__result);
  if (!Number.isFinite(n)) {
    throw new Error(`La función debe devolver un número (recibió: ${sandbox.__result})`);
  }
  return n;
}

function validateJavascriptCuerpo(cuerpo, args) {
  compileJavascriptFunction(args, cuerpo);
}

function evaluateJavascriptCuerpo(cuerpo, args, argValues, opts) {
  const fn = compileJavascriptFunction(args, cuerpo);
  return runJavascriptFunction(fn, argValues, opts);
}

module.exports = {
  assertSafeScript,
  compileJavascriptFunction,
  validateJavascriptCuerpo,
  evaluateJavascriptCuerpo,
  runJavascriptFunction,
  DEFAULT_TIMEOUT_MS
};
