'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_AYUDA_ARTICULOS } = require('../config/constants');

const articuloAyudaSchema = new mongoose.Schema(
  {
    /** null = artículo global de plataforma (visible a todos los tenants) */
    tenantId: { type: String, default: null, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    titulo: { type: String, required: true, trim: true },
    categoria: { type: String, required: true, trim: true, default: 'general', index: true },
    resumen: { type: String, default: '', trim: true },
    cuerpo: { type: String, default: '' },
    tags: [{ type: String, trim: true, lowercase: true }],
    orden: { type: Number, default: 100 },
    publicado: { type: Boolean, default: true },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_AYUDA_ARTICULOS }
);

articuloAyudaSchema.index(
  { tenantId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { tenantId: { $type: 'string' } } }
);
articuloAyudaSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { tenantId: null } }
);

async function getArticuloAyudaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ArticuloAyuda ||
    conn.model('ArticuloAyuda', articuloAyudaSchema, COLLECTION_AYUDA_ARTICULOS)
  );
}

module.exports = getArticuloAyudaModel;
