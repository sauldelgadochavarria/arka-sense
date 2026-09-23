const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PAYROLL_PERIODS } = require('../config/constants');

const payrollPeriodSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    tipo: { type: String, enum: ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'], required: true },
    tipoNomina: {
      type: String,
      enum: [
        'ordinaria',
        'extraordinaria',
        'finiquito',
        'aguinaldo',
        'ptu',
        'primas',
        'comisiones',
        'indemnizacion',
        'otro'
      ],
      default: 'ordinaria',
      index: true
    },
    anio: { type: Number, default: null, index: true },
    numeroPeriodo: { type: Number, default: null },
    fechaInicio: { type: Date, required: true, index: true },
    fechaFin: { type: Date, required: true, index: true },
    /** Fecha sugerida/confirmada de dispersión (no afecta días pagados ni ISR). */
    fechaPago: { type: Date, default: null },
    estatus: {
      type: String,
      enum: ['pendiente', 'abierto', 'borrador', 'cerrado'],
      default: 'pendiente',
      index: true
    },
    abiertoAt: { type: Date },
    abiertoPorUserId: { type: String, default: '' },
    calculadoAt: { type: Date },
    calculadoPorUserId: { type: String, default: '' },
    cerradoAt: { type: Date },
    cerradoPorUserId: { type: String, default: '' },
    notas: { type: String, default: '' },
    tipoPeriodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'TipoPeriodoNomina', default: null },
    codigoLegadoTipoPeriodo: { type: Number, default: null },
    aplicaAsistenciaPrenomina: { type: Boolean, default: true },
    compartirConNomina: { type: Boolean, default: false },
    totales: {
      empleados: { type: Number, default: 0 },
      percepciones: { type: Number, default: 0 },
      deducciones: { type: Number, default: 0 },
      neto: { type: Number, default: 0 }
    }
  },
  { timestamps: true, collection: COLLECTION_PAYROLL_PERIODS }
);

payrollPeriodSchema.index({ tenantId: 1, fechaInicio: 1, fechaFin: 1 });
payrollPeriodSchema.index(
  { tenantId: 1, tipoPeriodoId: 1, anio: 1, numeroPeriodo: 1 },
  { unique: true, partialFilterExpression: { tipoPeriodoId: { $type: 'objectId' }, numeroPeriodo: { $type: 'number' } } }
);

async function getPayrollPeriodModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PayrollPeriod ||
    conn.model('PayrollPeriod', payrollPeriodSchema, COLLECTION_PAYROLL_PERIODS)
  );
}

module.exports = getPayrollPeriodModel;
