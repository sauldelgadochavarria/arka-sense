'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_SAT_CONCEPTO_MOTOR_MAP } = require('../config/constants');

/**
 * Overrides por subsidiaria del mapa SAT → código motor.
 * Sin registro = se usa el mapa de sistema (config/satConceptoMotorMap.js).
 */
const satConceptoMotorMapSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    tipo: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      enum: ['percepcion', 'deduccion', 'otro_pago']
    },
    claveSat: { type: String, required: true, trim: true },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    /** Opcional: si hay varias filas misma clave, desambigua por nombre CFDI (texto o /regex/). */
    matchNombre: { type: String, trim: true, default: '' },
    esDefault: { type: Boolean, default: true },
    activo: { type: Boolean, default: true },
    notas: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_SAT_CONCEPTO_MOTOR_MAP }
);

satConceptoMotorMapSchema.index(
  {
    tenantId: 1,
    empresaId: 1,
    subsidiariaId: 1,
    tipo: 1,
    claveSat: 1,
    matchNombre: 1
  },
  { unique: true }
);

async function getSatConceptoMotorMapModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.SatConceptoMotorMap ||
    conn.model('SatConceptoMotorMap', satConceptoMotorMapSchema, COLLECTION_SAT_CONCEPTO_MOTOR_MAP)
  );
}

module.exports = getSatConceptoMotorMapModel;
