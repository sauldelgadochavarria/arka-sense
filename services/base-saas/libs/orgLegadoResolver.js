'use strict';

const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const getSubsidiariaModel = require('../models/subsidiaria');

function claveLegadoValida(val) {
  if (val === undefined || val === null || val === '' || val === 'NULL') return null;
  const n = Number(val);
  return Number.isFinite(n) ? String(n) : null;
}

function buildMapByLegado(items) {
  const map = new Map();
  for (const item of items) {
    if (item.codigoLegado == null) continue;
    map.set(String(item.codigoLegado), item._id);
  }
  return map;
}

async function buildOrgLegadoMaps(tenantId, empresaId) {
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [departamentos, puestos, subsidiarias] = await Promise.all([
    Departamento.find({ tenantId }).lean(),
    Puesto.find({ tenantId }).lean(),
    empresaId ? Subsidiaria.find({ empresaId }).lean() : []
  ]);

  const deptoByLegado = buildMapByLegado(departamentos);
  const puestoByLegado = buildMapByLegado(puestos);
  const subsidiariaByLegado = buildMapByLegado(subsidiarias);

  const faltantes = {
    departamentos: new Set(),
    puestos: new Set(),
    ubicaciones: new Set()
  };

  function resolve(map, clave, bucket) {
    const key = claveLegadoValida(clave);
    if (!key) return null;
    const id = map.get(key);
    if (!id && bucket) bucket.add(key);
    return id || null;
  }

  return {
    deptoByLegado,
    puestoByLegado,
    subsidiariaByLegado,
    faltantes,
    resolveDepartamento(claDepto) {
      return resolve(deptoByLegado, claDepto, faltantes.departamentos);
    },
    resolvePuesto(claPuesto) {
      return resolve(puestoByLegado, claPuesto, faltantes.puestos);
    },
    resolveSubsidiaria(claUbicacion) {
      return resolve(subsidiariaByLegado, claUbicacion, faltantes.ubicaciones);
    },
    resumenFaltantes() {
      return {
        departamentos: [...faltantes.departamentos].sort((a, b) => Number(a) - Number(b)),
        puestos: [...faltantes.puestos].sort((a, b) => Number(a) - Number(b)),
        ubicaciones: [...faltantes.ubicaciones].sort((a, b) => Number(a) - Number(b))
      };
    }
  };
}

module.exports = {
  claveLegadoValida,
  buildOrgLegadoMaps
};
