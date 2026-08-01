'use strict';

const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const { DEFAULT_TIPOS_INCIDENCIA } = require('../config/incidenciasCatalog');

async function syncDefaultTiposForTenant(tenantId, empresaId) {
  const TipoIncidencia = await getTipoIncidenciaModel();
  for (const tipo of DEFAULT_TIPOS_INCIDENCIA) {
    await TipoIncidencia.updateOne(
      { tenantId, clave: tipo.clave },
      {
        $setOnInsert: {
          tenantId,
          empresaId,
          ...tipo,
          activo: true
        }
      },
      { upsert: true }
    );
  }
}

async function ensureTiposIncidenciaForTenant(tenantId, empresaId) {
  const TipoIncidencia = await getTipoIncidenciaModel();
  const count = await TipoIncidencia.countDocuments({ tenantId });
  if (count === 0) {
    await TipoIncidencia.insertMany(
      DEFAULT_TIPOS_INCIDENCIA.map((t) => ({
        tenantId,
        empresaId,
        ...t,
        activo: true
      }))
    );
  } else {
    await syncDefaultTiposForTenant(tenantId, empresaId);
  }

  return TipoIncidencia.find({ tenantId, activo: true }).sort({ clave: 1 }).lean();
}

async function listAllTiposForTenant(tenantId, empresaId) {
  await ensureTiposIncidenciaForTenant(tenantId, empresaId);
  const TipoIncidencia = await getTipoIncidenciaModel();
  return TipoIncidencia.find({ tenantId }).sort({ clave: 1 }).lean();
}

module.exports = { ensureTiposIncidenciaForTenant, listAllTiposForTenant, syncDefaultTiposForTenant };
