'use strict';

const mongoose = require('mongoose');
const { COLLECTION_PARAMETROS_GENERALES } = require('../../config/constants');
const { getEnumItems } = require('./systemEnumService');
const { listActiveFormulaFunctions } = require('./formulaFunctionsService');

const ARGS_COMUNES = [
  { key: 'sueldoDiario', label: 'sueldoDiario', descripcion: 'Salario diario' },
  { key: 'diasLaborados', label: 'diasLaborados', descripcion: 'Días laborados / pagados' },
  { key: 'diasPeriodo', label: 'diasPeriodo', descripcion: 'Días calendario del período' },
  { key: 'porcentajeFondoAhorro', label: 'porcentajeFondoAhorro', descripcion: '% fondo' },
  { key: 'aplicaFondoAhorro', label: 'aplicaFondoAhorro', descripcion: '0/1' },
  { key: 'fondoAhorroTopeExento', label: 'fondoAhorroTopeExento', descripcion: 'Tope exento precalculado' },
  { key: 'fondoAhorroEmpresa', label: 'fondoAhorroEmpresa', descripcion: 'Mitad aportación empresa' },
  { key: 'uma', label: 'uma', descripcion: 'UMA diaria vigente' }
];

async function loadFormulaHelperCatalogForSaas() {
  const [contextItems, funciones, paramDocs] = await Promise.all([
    getEnumItems('formula_context_vars').catch(() => []),
    listActiveFormulaFunctions().catch(() => []),
    mongoose.connection.db
      .collection(COLLECTION_PARAMETROS_GENERALES)
      .find({})
      .project({ clave: 1, valor: 1, descripcion: 1 })
      .sort({ clave: 1 })
      .limit(60)
      .toArray()
      .catch(() => [])
  ]);

  const seen = new Set();
  const parametros = [];
  for (const p of paramDocs) {
    if (!p.clave || seen.has(p.clave)) continue;
    seen.add(p.clave);
    parametros.push({
      key: p.clave,
      label: p.clave,
      descripcion: p.descripcion || `Valor: ${p.valor}`,
      valor: p.valor
    });
  }

  return {
    argsComunes: ARGS_COMUNES,
    helpersSandbox: [],
    contextVars: contextItems.map((it) => ({
      key: it.value,
      label: it.label || it.value,
      descripcion: it.descripcion || '',
      grupo: it.meta?.namespace || ''
    })),
    parametros,
    funciones: funciones.map((f) => ({
      key: f.name,
      label: f.signature || `${f.name}(…)`,
      descripcion: f.descripcion || f.tipo || '',
      tipo: f.tipo,
      ejemplo: f.ejemplo || '',
      args: f.args || []
    })),
    notaJs:
      'Clic para insertar en el cuerpo mathjs. Las funciones publicadas y variables de contexto están las mismas del editor de conceptos.'
  };
}

module.exports = { loadFormulaHelperCatalogForSaas };
