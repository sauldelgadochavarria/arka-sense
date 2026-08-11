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
    /** Año calendario del período (fechaInicio) — base de la numeración. */
    anio: { type: Number, index: true },
    /**
     * Número de período dentro del año y tipoPeriodo (reinicia cada año).
     * Independiente del _id de Mongo.
     */
    numeroPeriodo: { type: Number, default: null, index: true },
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
    /** Alias explícito de calculadoAt (UI / reportes). */
    fechaCalculo: { type: Date },
    /** Última corrida de cálculo (auditoría). */
    calculoLoteId: { type: String, trim: true, default: '', index: true },
    calculadoPorUserId: { type: String, default: '' },
    calculadoPorLabel: { type: String, default: '' },
    cerradoAt: { type: Date },
    /** Alias explícito de cerradoAt (UI / reportes). */
    fechaCierre: { type: Date },
    cerradoPorUserId: { type: String, default: '' },
    cerradoPorLabel: { type: String, default: '' },
    /** Resumen del archivo histórico al cerrar. */
    cierreResumen: {
      recibosArchivados: { type: Number, default: 0 },
      conceptosAcumulados: { type: Number, default: 0 }
    },
    notas: { type: String, default: '' },
    /**
     * Prestaciones de pago puntual (p.ej. despensa 1 vez al mes).
     * pagaDespensa: si true, el resolver calcula despensaMonto para los empleados.
     */
    prestaciones: {
      pagaDespensa: { type: Boolean, default: false },
      /** Override opcional del monto del período (ignora política del empleado si > 0). */
      despensaMontoOverride: { type: Number, default: 0, min: 0 },
      /** true = pago mensual completo → tope IMSS mensual (no prorrateo a días). */
      despensaPagoMensual: { type: Boolean, default: true }
    },
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
periodoNominaSchema.index(
  { tenantId: 1, anio: 1, tipoPeriodo: 1, numeroPeriodo: 1 },
  { unique: true, partialFilterExpression: { numeroPeriodo: { $type: 'number' } } }
);

async function getPeriodoNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PeriodoNomina ||
    conn.model('PeriodoNomina', periodoNominaSchema, COLLECTION_NOMINA_PERIODOS)
  );
}

module.exports = getPeriodoNominaModel;
