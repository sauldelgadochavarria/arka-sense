const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const tenantSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    displayName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'cancelled'],
      default: 'pending',
      index: true
    },
    featureFlags: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: 'tenants' }
);

async function getTenantModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Tenant || conn.model('Tenant', tenantSchema, 'tenants');
}

module.exports = getTenantModel;
