const mongoose = require('mongoose');

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
    tier: { type: String, enum: ['shared', 'dedicated'], default: 'shared' },
    ownerUserId: { type: String, default: '' },
    origin: { type: String, enum: ['landing', 'admin', 'seed'], default: 'admin' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    billingStatus: {
      type: String,
      enum: ['pending_activation', 'trial', 'active', 'past_due', 'suspended', 'cancelled'],
      default: 'pending_activation'
    },
    currentPlan: { type: String, default: '' },
    featureFlags: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: 'tenants' }
);

module.exports = mongoose.model('Tenant', tenantSchema, 'tenants');
