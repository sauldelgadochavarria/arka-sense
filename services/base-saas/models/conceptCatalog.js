'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CONCEPT_CATALOG } = require('../config/constants');
const { fiscalSubSchema, satSubSchema } = require('./fiscalConceptoShared');

const conceptCatalogSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, trim: true, uppercase: true },
    codigo: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, required: true, trim: true, lowercase: true },
    naturaleza: { type: String, required: true, trim: true, lowercase: true },
    fase: { type: Number, required: true, min: 1, max: 4, default: 1, index: true },
    aplicaEn: {
      type: String,
      enum: ['nomina', 'prenomina', 'ambos'],
      default: 'nomina',
      index: true
    },
    clavePrenomina: { type: String, trim: true, uppercase: true, default: '' },
    formulaPrenomina: { type: String, trim: true, lowercase: true, default: '' },
    tiposIncidencia: { type: [String], default: [] },
    insumosContexto: { type: [String], default: [] },
    claveSAT: { type: String, trim: true, default: '' },
    sat: { type: satSubSchema, default: () => ({}) },
    fiscal: { type: fiscalSubSchema, default: () => ({}) },
    descripcion: { type: String, default: '' },
    esAcumulador: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
    ordenDefault: { type: Number, default: 100 },
    aplicaTipoNomina: { type: [String], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_CONCEPT_CATALOG }
);

conceptCatalogSchema.index({ tipo: 1, fase: 1, ordenDefault: 1 });
conceptCatalogSchema.index({ aplicaEn: 1, activo: 1 });

function aplicaEnNomina(aplicaEn) {
  const v = String(aplicaEn || 'nomina').toLowerCase();
  return v === 'nomina' || v === 'ambos';
}

function aplicaEnPrenomina(aplicaEn) {
  const v = String(aplicaEn || 'nomina').toLowerCase();
  return v === 'prenomina' || v === 'ambos';
}

async function getConceptCatalogModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ConceptCatalog ||
    conn.model('ConceptCatalog', conceptCatalogSchema, COLLECTION_CONCEPT_CATALOG)
  );
}

module.exports = getConceptCatalogModel;
module.exports.aplicaEnNomina = aplicaEnNomina;
module.exports.aplicaEnPrenomina = aplicaEnPrenomina;
