const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PRENOMINA_PROCESO_JOBS } = require('../config/constants');

const prenominaProcesoJobSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    periodId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tipo: { type: String, enum: ['asistencia', 'calculo'], required: true },
    estatus: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
      index: true
    },
    progreso: {
      total: { type: Number, default: 0 },
      procesados: { type: Number, default: 0 },
      exitos: { type: Number, default: 0 },
      errores: { type: Number, default: 0 },
      mensaje: { type: String, default: '' }
    },
    resultado: { type: mongoose.Schema.Types.Mixed, default: null },
    userId: { type: String, default: '' },
    error: { type: String, default: '' },
    startedAt: { type: Date },
    completedAt: { type: Date },
    /** Presente solo mientras el proceso sigue. El índice único impide dos a la vez. */
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_PRENOMINA_PROCESO_JOBS }
);

prenominaProcesoJobSchema.index(
  { tenantId: 1, periodId: 1, activo: 1 },
  { unique: true, partialFilterExpression: { activo: true } }
);

async function getPrenominaProcesoJobModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PrenominaProcesoJob ||
    conn.model('PrenominaProcesoJob', prenominaProcesoJobSchema, COLLECTION_PRENOMINA_PROCESO_JOBS)
  );
}

module.exports = getPrenominaProcesoJobModel;
