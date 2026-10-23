'use strict';

/**
 * Zona dentro de una subsidiaria: recepción, almacén, piso.
 * Agrupa puntos de acceso y terminales. La zona horaria sigue en la subsidiaria.
 */

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ZONAS } = require('../config/constants');

const zonaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      required: true,
      index: true
    },
    codigo: { type: String, trim: true, uppercase: true, default: '' },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true, index: true }
  },
  { timestamps: true, collection: COLLECTION_ZONAS }
);

zonaSchema.index({ tenantId: 1, subsidiariaId: 1, nombre: 1 }, { unique: true });
zonaSchema.index(
  { tenantId: 1, codigo: 1 },
  { unique: true, partialFilterExpression: { codigo: { $type: 'string', $ne: '' } } }
);

async function getZonaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Zona || conn.model('Zona', zonaSchema, COLLECTION_ZONAS);
}

module.exports = getZonaModel;
