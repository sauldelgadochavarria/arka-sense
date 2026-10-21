'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const COLLECTION =
  (process.env.BASE_COLLECTION_PUSH_TOKENS || 'push_tokens').trim();

const pushTokenSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    userId: { type: String, default: '', index: true },
    token: { type: String, required: true, trim: true },
    plataforma: { type: String, default: '', trim: true },
    deviceUuid: { type: String, default: '', trim: true, index: true },
    activo: { type: Boolean, default: true },
    ultimoUsoAt: { type: Date, default: Date.now }
  },
  { timestamps: true, collection: COLLECTION }
);

pushTokenSchema.index({ tenantId: 1, empleadoId: 1, token: 1 }, { unique: true });

async function getPushTokenModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.PushToken || conn.model('PushToken', pushTokenSchema, COLLECTION);
}

module.exports = getPushTokenModel;
