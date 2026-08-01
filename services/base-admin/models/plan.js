const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    periodMonths: { type: Number, default: 1 },
    priceCents: { type: Number, default: 0 },
    activo: { type: Boolean, default: true },
    featureFlags: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: 'plans' }
);

module.exports = mongoose.model('Plan', planSchema, 'plans');
