'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

/** OTP de verificación SMS para vincular un deviceUuid al empleado. */
const dispositivoOtpSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    deviceUuid: { type: String, required: true, trim: true },
    telefono: { type: String, required: true, trim: true },
    codeHash: { type: String, required: true },
    intentos: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date, default: null }
  },
  { timestamps: true, collection: 'dispositivo_otps' }
);

dispositivoOtpSchema.index({ tenantId: 1, empleadoId: 1, deviceUuid: 1 });

async function getDispositivoOtpModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.DispositivoOtp || conn.model('DispositivoOtp', dispositivoOtpSchema, 'dispositivo_otps');
}

module.exports = getDispositivoOtpModel;
