'use strict';

const { parse } = require('mathjs');

const ESTADO = { SIN_VISITAR: 0, EN_PROCESO: 1, TERMINADO: 2 };

/** Extrae símbolos de fórmula/condición que coincidan con códigos de conceptos del set. */
function inferirDependencias(formula, condicion, codigosDisponibles) {
  const deps = new Set();
  for (const expr of [formula, condicion]) {
    if (!expr || !String(expr).trim()) continue;
    try {
      const tree = parse(String(expr));
      tree.traverse((node) => {
        if (node.isSymbolNode && codigosDisponibles.has(node.name)) {
          deps.add(node.name);
        }
      });
    } catch {
      // si no parsea, no inferimos
    }
  }
  return [...deps];
}

function ordenarPorDependencias(formulas) {
  const porCodigo = new Map(formulas.map((f) => [f.conceptoCodigo, f]));
  const codigos = new Set(porCodigo.keys());
  const estado = new Map();
  const orden = [];
  const pilaRastreo = [];

  function depsDe(formula) {
    const explicitas = formula.dependencias || [];
    const inferidas = inferirDependencias(formula.formula, formula.condicion, codigos);
    const todas = new Set([...explicitas, ...inferidas]);
    todas.delete(formula.conceptoCodigo);
    return [...todas];
  }

  function visitar(codigo) {
    const actual = estado.get(codigo) ?? ESTADO.SIN_VISITAR;

    if (actual === ESTADO.TERMINADO) return;

    if (actual === ESTADO.EN_PROCESO) {
      const inicioCiclo = pilaRastreo.indexOf(codigo);
      const ciclo = pilaRastreo.slice(inicioCiclo).concat(codigo);
      throw new Error(`Dependencia circular detectada: ${ciclo.join(' -> ')}`);
    }

    estado.set(codigo, ESTADO.EN_PROCESO);
    pilaRastreo.push(codigo);

    const formula = porCodigo.get(codigo);
    if (formula) {
      for (const dep of depsDe(formula)) {
        if (porCodigo.has(dep)) {
          visitar(dep);
        }
      }
    }

    pilaRastreo.pop();
    estado.set(codigo, ESTADO.TERMINADO);
    if (formula) orden.push(formula);
  }

  for (const f of formulas) {
    visitar(f.conceptoCodigo);
  }

  return orden;
}

module.exports = { ordenarPorDependencias, inferirDependencias };
