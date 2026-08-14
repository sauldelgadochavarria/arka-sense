'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TIMBRADO_LOTES } = require('../config/constants');
const { timbradoStatusFields } = require('./timbradoStatusFields');

const itemSchema = new mongoose.Schema(
  {
    reciboId: { type: mongoose.Schema.Types.ObjectId, default: null },
    historicoId: { type: mongoose.Schema.Types.ObjectId, default: null },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
    numEmpleado: { type: String, default: '' },
    nombre: { type: String, default: '' },
    netoPagar: { type: Number, default: 0 },
    ...timbradoStatusFields()
  },
  { _id: true }
);

const timbradoLoteSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', required: true, index: true },
    pacConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'PacConfig', required: true },
    plantillaPdfId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReciboPdfPlantilla',
      default: null
    },
    estatus: {
      type: String,
      enum: ['borrador', 'en_proceso', 'completado', 'completado_parcial', 'error', 'cancelado'],
      default: 'borrador',
      index: true
    },
    modo: { type: String, enum: ['simulacion', 'real'], default: 'simulacion' },
    formato: { type: String, enum: ['JSON', 'XML'], default: 'JSON' },
    generarLayout: { type: Boolean, default: true },
    serie: { type: String, trim: true, uppercase: true, default: '' },
    totales: {
      recibos: { type: Number, default: 0 },
      timbrados: { type: Number, default: 0 },
      errores: { type: Number, default: 0 },
      omitidos: { type: Number, default: 0 },
      neto: { type: Number, default: 0 }
    },
    items: { type: [itemSchema], default: [] },
    iniciadoAt: { type: Date, default: null },
    finalizadoAt: { type: Date, default: null },
    creadoPorUserId: { type: String, default: '' },
    creadoPorLabel: { type: String, default: '' },
    notas: { type: String, default: '' },
    errorMensaje: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_TIMBRADO_LOTES }
);

timbradoLoteSchema.index({ tenantId: 1, periodoId: 1, createdAt: -1 });

async function getTimbradoLoteModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TimbradoLote || conn.model('TimbradoLote', timbradoLoteSchema, COLLECTION_TIMBRADO_LOTES)
  );
}

module.exports = getTimbradoLoteModel;
