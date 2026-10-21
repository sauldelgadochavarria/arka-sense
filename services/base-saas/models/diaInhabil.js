'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DIAS_INHABILES } = require('../config/constants');

/** Día no laborable (festivo oficial o inhábil de empresa) para conteo de vacaciones. */
const diaInhabilSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    /** Medianoche conceptual / mediodía UTC del YMD */
    fecha: { type: Date, required: true, index: true },
    nombre: { type: String, trim: true, default: '' },
    tipo: {
      type: String,
      enum: ['oficial', 'empresa', 'subsidiaria'],
      default: 'empresa'
    },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_DIAS_INHABILES }
);

diaInhabilSchema.index({ tenantId: 1, fecha: 1, subsidiariaId: 1 });

async function getDiaInhabilModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.DiaInhabil || conn.model('DiaInhabil', diaInhabilSchema, COLLECTION_DIAS_INHABILES);
}

module.exports = getDiaInhabilModel;
