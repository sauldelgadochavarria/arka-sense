const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_PERIODOS } = require('../config/constants');

const periodoNominaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    tipoPeriodo: {
      type: String,
      enum: ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'],
      required: true
    },
    tipoNomina: {
      type: String,
      enum: ['ordinaria', 'extraordinaria', 'finiquito', 'aguinaldo'],
      default: 'ordinaria'
    },
    fechaInicio: { type: Date, required: true, index: true },
    fechaFin: { type: Date, required: true, index: true },
    diasPeriodo: { type: Number, default: 0 },
    estatus: {
      type: String,
      enum: ['abierto', 'calculando', 'calculado', 'cerrado'],
      default: 'abierto',
      index: true
    },
    calculoJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'NominaCalculoJob', default: null },
    payrollPeriodId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollPeriod', default: null },
    calculadoAt: { type: Date },
    calculadoPorUserId: { type: String, default: '' },
    cerradoAt: { type: Date },
    cerradoPorUserId: { type: String, default: '' },
    notas: { type: String, default: '' },
    totales: {
      empleados: { type: Number, default: 0 },
      empleadosConError: { type: Number, default: 0 },
      percepciones: { type: Number, default: 0 },
      deducciones: { type: Number, default: 0 },
      neto: { type: Number, default: 0 }
    }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_PERIODOS }
);

periodoNominaSchema.index({ tenantId: 1, fechaInicio: 1, fechaFin: 1, tipoNomina: 1 });

async function getPeriodoNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PeriodoNomina ||
    conn.model('PeriodoNomina', periodoNominaSchema, COLLECTION_NOMINA_PERIODOS)
  );
}

module.exports = getPeriodoNominaModel;
