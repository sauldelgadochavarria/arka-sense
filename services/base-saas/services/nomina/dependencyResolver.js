'use strict';

const ESTADO = { SIN_VISITAR: 0, EN_PROCESO: 1, TERMINADO: 2 };

function ordenarPorDependencias(formulas) {
  const porCodigo = new Map(formulas.map((f) => [f.conceptoCodigo, f]));
  const estado = new Map();
  const orden = [];
  const pilaRastreo = [];

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
      for (const dep of formula.dependencias || []) {
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

module.exports = { ordenarPorDependencias };
