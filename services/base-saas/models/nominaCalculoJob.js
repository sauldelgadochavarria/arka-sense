const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_CALCULO_JOBS } = require('../config/constants');

const nominaCalculoJobSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', required: true, index: true },
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
      errores: { type: Number, default: 0 }
    },
    erroresDetalle: [
      {
        empleadoId: mongoose.Schema.Types.ObjectId,
        numEmpleado: String,
        nombre: String,
        error: String
      }
    ],
    totales: {
      empleados: { type: Number, default: 0 },
      empleadosConError: { type: Number, default: 0 },
      percepciones: { type: Number, default: 0 },
      deducciones: { type: Number, default: 0 },
      neto: { type: Number, default: 0 }
    },
    userId: { type: String, default: '' },
    error: { type: String, default: '' },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_CALCULO_JOBS }
);

nominaCalculoJobSchema.index({ tenantId: 1, periodoId: 1, createdAt: -1 });

async function getNominaCalculoJobModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.NominaCalculoJob ||
    conn.model('NominaCalculoJob', nominaCalculoJobSchema, COLLECTION_NOMINA_CALCULO_JOBS)
  );
}

module.exports = getNominaCalculoJobModel;
