'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_COMPANY_CONCEPT_CONFIG } = require('../config/constants');

/**
 * Diffs por empresa: qué conceptos del catálogo están activos y cómo se aplican.
 * tipoAplicacion: FIJO (siempre) | EVENTUAL (solo si condición / incidencia).
 */
const companyConceptConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    activo: { type: Boolean, default: true },
    deshabilitado: { type: Boolean, default: false },
    tipoAplicacion: {
      type: String,
      enum: ['FIJO', 'EVENTUAL'],
      default: 'FIJO',
      uppercase: true
    },
    plantillaOrigen: { type: String, trim: true, default: '' },
    ordenOverride: { type: Number, default: null },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_COMPANY_CONCEPT_CONFIG }
);

companyConceptConfigSchema.index({ tenantId: 1, empresaId: 1, conceptoCodigo: 1 }, { unique: true });

async function getCompanyConceptConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CompanyConceptConfig ||
    conn.model('CompanyConceptConfig', companyConceptConfigSchema, COLLECTION_COMPANY_CONCEPT_CONFIG)
  );
}

module.exports = getCompanyConceptConfigModel;
