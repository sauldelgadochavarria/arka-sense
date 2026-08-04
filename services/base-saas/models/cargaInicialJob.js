'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CARGAS_INICIALES } = require('../config/constants');

const errorFilaSchema = new mongoose.Schema(
  {
    fila: { type: Number, default: 0 },
    campo: { type: String, default: '' },
    mensaje: { type: String, default: '' },
    valor: { type: String, default: '' }
  },
  { _id: false }
);

const cargaInicialJobSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null },
    tipo: {
      type: String,
      enum: ['empleados', 'historial_laboral', 'acumulados', 'historico_recibos', 'creditos_saldos'],
      required: true,
      index: true
    },
    estatus: {
      type: String,
      enum: ['borrador', 'validado', 'aplicando', 'ok', 'parcial', 'error', 'cancelado'],
      default: 'borrador',
      index: true
    },
    modo: {
      type: String,
      enum: ['dry_run', 'aplicar'],
      default: 'dry_run'
    },
    archivoNombre: { type: String, default: '' },
    /** CSV crudo (limitado; no para archivos enormes) */
    contenidoCsv: { type: String, default: '' },
    totalFilas: { type: Number, default: 0 },
    filasOk: { type: Number, default: 0 },
    filasError: { type: Number, default: 0 },
    filasAplicadas: { type: Number, default: 0 },
    errores: { type: [errorFilaSchema], default: [] },
    resumen: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Muestra de filas válidas (para UI dry-run) */
    muestraOk: { type: [mongoose.Schema.Types.Mixed], default: [] },
    userId: { type: String, default: '' },
    userLabel: { type: String, default: '' },
    aplicadoAt: { type: Date, default: null },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_CARGAS_INICIALES }
);

cargaInicialJobSchema.index({ tenantId: 1, tipo: 1, createdAt: -1 });

async function getCargaInicialJobModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CargaInicialJob ||
    conn.model('CargaInicialJob', cargaInicialJobSchema, COLLECTION_CARGAS_INICIALES)
  );
}

module.exports = getCargaInicialJobModel;
