const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_INTEGRATION_PROFILES } = require('../config/constants');

const integrationProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    adaptador: {
      type: String,
      enum: ['contpaqi', 'aspel', 'sap', 'csv'],
      required: true
    },
    fieldMapping: { type: mongoose.Schema.Types.Mixed, default: {} },
    activo: { type: Boolean, default: true },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_INTEGRATION_PROFILES }
);

integrationProfileSchema.index({ tenantId: 1, adaptador: 1 });

async function getIntegrationProfileModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.IntegrationProfile ||
    conn.model('IntegrationProfile', integrationProfileSchema, COLLECTION_INTEGRATION_PROFILES)
  );
}

module.exports = getIntegrationProfileModel;
