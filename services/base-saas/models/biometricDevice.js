const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_BIOMETRIC_DEVICES } = require('../config/constants');

const biometricDeviceSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    nombre: { type: String, required: true, trim: true },
    tipo: { type: String, enum: ['zkteco', 'anviz', 'generico'], default: 'generico' },
    host: { type: String, trim: true, default: '' },
    puerto: { type: Number, default: 4370 },
    ubicacion: { type: String, trim: true, default: '' },
    estatus: { type: String, enum: ['online', 'offline', 'desconocido'], default: 'desconocido', index: true },
    ultimoPing: { type: Date },
    ultimaSincCatalogo: { type: Date },
    syncCatalogoPendiente: { type: Boolean, default: false },
    empleadosSincronizados: { type: Number, default: 0 },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_BIOMETRIC_DEVICES }
);

biometricDeviceSchema.index({ tenantId: 1, nombre: 1 });

async function getBiometricDeviceModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.BiometricDevice ||
    conn.model('BiometricDevice', biometricDeviceSchema, COLLECTION_BIOMETRIC_DEVICES)
  );
}

module.exports = getBiometricDeviceModel;
