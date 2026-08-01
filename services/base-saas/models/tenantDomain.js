const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const tenantDomainSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    verified: { type: Boolean, default: false }
  },
  { collection: 'tenantDomains' }
);

async function getTenantDomainModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.TenantDomain || conn.model('TenantDomain', tenantDomainSchema, 'tenantDomains');
}

module.exports = getTenantDomainModel;
