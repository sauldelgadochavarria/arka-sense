'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_SUBSIDIARY_CONCEPT_CONFIG } = require('../config/constants');

/**
 * Visibilidad / uso de conceptos por subsidiaria.
 * El catálogo maestro (`nomina_conceptos`) sigue siendo por tenant;
 * esta colección decide qué códigos CFDI/manuales ve cada sub.
 * subsidiariaId null = ámbito MAIN / sin subsidiaria.
 */
const subsidiaryConceptConfigSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    activo: { type: Boolean, default: true },
    deshabilitado: { type: Boolean, default: false },
    origen: {
      type: String,
      enum: ['cfdi', 'cfdi_sat', 'catalog', 'manual', 'historico'],
      default: 'manual'
    },
    aliasNombre: { type: String, trim: true, default: '' },
    claveSat: { type: String, trim: true, default: '' },
    /** Clave interna del XML (Clave=) cuando se mapeó a código motor. */
    claveInternaCfdi: { type: String, trim: true, default: '' },
    tipo: {
      type: String,
      enum: ['percepcion', 'deduccion', 'otro_pago', ''],
      default: ''
    },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_SUBSIDIARY_CONCEPT_CONFIG }
);

subsidiaryConceptConfigSchema.index(
  { tenantId: 1, empresaId: 1, subsidiariaId: 1, conceptoCodigo: 1 },
  { unique: true }
);

async function getSubsidiaryConceptConfigModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.SubsidiaryConceptConfig ||
    conn.model(
      'SubsidiaryConceptConfig',
      subsidiaryConceptConfigSchema,
      COLLECTION_SUBSIDIARY_CONCEPT_CONFIG
    )
  );
}

module.exports = getSubsidiaryConceptConfigModel;
