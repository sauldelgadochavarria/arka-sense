const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_SYNC_LOGS } = require('../config/constants');

const conflictoSchema = new mongoose.Schema(
  {
    tipo: { type: String, default: 'dato_diferente' },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado' },
    numEmpleado: { type: String, default: '' },
    campo: { type: String, default: '' },
    valorLocal: { type: String, default: '' },
    valorRemoto: { type: String, default: '' },
    mensaje: { type: String, default: '' },
    resolucion: {
      type: String,
      enum: ['pendiente', 'aceptar_local', 'aceptar_remoto'],
      default: 'pendiente'
    }
  },
  { _id: true }
);

const syncLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa' },
    tipo: {
      type: String,
      enum: ['prenomina_export', 'empleados_export', 'empleados_import', 'catalogo_dispositivo'],
      required: true,
      index: true
    },
    adaptador: { type: String, default: '' },
    referenciaId: { type: String, default: '' },
    estatus: { type: String, enum: ['ok', 'parcial', 'error'], default: 'ok', index: true },
    registrosOk: { type: Number, default: 0 },
    registrosError: { type: Number, default: 0 },
    conflictos: [conflictoSchema],
    detalle: { type: String, default: '' },
    archivoNombre: { type: String, default: '' },
    archivoContenido: { type: String, default: '' },
    userId: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_SYNC_LOGS }
);

syncLogSchema.index({ tenantId: 1, createdAt: -1 });

async function getSyncLogModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.SyncLog || conn.model('SyncLog', syncLogSchema, COLLECTION_SYNC_LOGS);
}

module.exports = getSyncLogModel;
