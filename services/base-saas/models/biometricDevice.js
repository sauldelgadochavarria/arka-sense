const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_BIOMETRIC_DEVICES } = require('../config/constants');

const biometricDeviceSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    zonaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zona', default: null, index: true },
    nombre: { type: String, required: true, trim: true },
    /** Número de serie del equipo físico. Vacío en terminales dadas de alta solo por IP. */
    numeroSerie: { type: String, trim: true, uppercase: true, default: '' },
    /** asistencia = checador; acceso = reservado para una puerta, sin abrirla desde aquí. */
    proposito: { type: String, enum: ['asistencia', 'acceso'], default: 'asistencia' },
    /**
     * Quién puede checar en este equipo. Vacío = la sincronización sigue enviando
     * a todos los activos del tenant (compatibilidad con terminales ya dadas de alta).
     */
    empleadosAutorizados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' }],
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
biometricDeviceSchema.index(
  { tenantId: 1, numeroSerie: 1 },
  { unique: true, partialFilterExpression: { numeroSerie: { $type: 'string', $ne: '' } } }
);

async function getBiometricDeviceModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.BiometricDevice ||
    conn.model('BiometricDevice', biometricDeviceSchema, COLLECTION_BIOMETRIC_DEVICES)
  );
}

module.exports = getBiometricDeviceModel;
