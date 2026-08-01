const mongoose = require('mongoose');

const tenantDomainSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    verified: { type: Boolean, default: false },
    primary: { type: Boolean, default: false }
  },
  { timestamps: true, collection: 'tenantDomains' }
);

module.exports = mongoose.model('TenantDomain', tenantDomainSchema, 'tenantDomains');
