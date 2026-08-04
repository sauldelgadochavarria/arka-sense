'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_HISTORICO } = require('../config/constants');

/**
 * Snapshot inmutable de un recibo al cerrar el período.
 * También admite cargas de migración (origen=importacion) sin periodo/recibo local.
 */
const conceptoHistoricoSubSchema = new mongoose.Schema(
  {
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    formulaUsada: { type: String, default: '' },
    condicionUsada: { type: String, default: '' },
    variablesUsadas: { type: mongoose.Schema.Types.Mixed, default: {} },
    importe: { type: Number, default: 0 },
    gravado: { type: Number, default: 0 },
    exento: { type: Number, default: 0 },
    desgloseModo: { type: String, default: '' },
    claveSAT: { type: String, default: '' },
    tipo: { type: String, default: '' },
    requiereRevision: { type: Boolean, default: false },
    errorCalculo: { type: String, default: '' },
    versionFormula: { type: Number, default: 1 }
  },
  { _id: false }
);

const nominaHistoricoReciboSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null },
    /** Presente en cierres locales; null en importación de legado. */
    periodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null, index: true },
    reciboOrigenId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReciboNomina', default: null },
    /** Clave estable para upsert de cargas (importación). */
    claveImportacion: { type: String, trim: true, default: '', index: true },
    origen: {
      type: String,
      enum: ['cierre', 'importacion'],
      default: 'cierre',
      index: true
    },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    anio: { type: Number, required: true, index: true },
    mes: { type: Number, required: true, min: 1, max: 12 },
    periodo: {
      tipoPeriodo: { type: String, default: '' },
      tipoNomina: { type: String, default: '' },
      numeroPeriodo: { type: Number, default: null },
      fechaInicio: { type: Date },
      fechaFin: { type: Date },
      diasPeriodo: { type: Number, default: 0 }
    },
    empleado: {
      numEmpleado: { type: String, default: '' },
      nombre: { type: String, default: '' },
      tipoEmpleado: { type: String, default: '' },
      tipoContrato: { type: String, default: '' }
    },
    diasLaborados: { type: Number, default: 0 },
    diasPagados: { type: Number, default: null },
    faltas: { type: Number, default: 0 },
    totalPercepciones: { type: Number, default: 0 },
    totalDeducciones: { type: Number, default: 0 },
    netoPagar: { type: Number, default: 0 },
    basesFiscales: { type: mongoose.Schema.Types.Mixed, default: {} },
    insumosFuente: { type: String, default: '' },
    insumosResumen: { type: mongoose.Schema.Types.Mixed, default: {} },
    conceptos: { type: [conceptoHistoricoSubSchema], default: [] },
    isrMotor: { type: mongoose.Schema.Types.Mixed, default: null },
    fechaCalculo: { type: Date },
    fechaCierre: { type: Date, required: true },
    cerradoPorUserId: { type: String, default: '' },
    /** Auditoría: ID del recibo en la corrida de cálculo. */
    calculoId: { type: String, trim: true, default: '', index: true },
    calculoLoteId: { type: String, trim: true, default: '', index: true }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_HISTORICO }
);

// Cierres locales: un recibo por período/empleado
nominaHistoricoReciboSchema.index(
  { tenantId: 1, periodoId: 1, empleadoId: 1 },
  {
    unique: true,
    partialFilterExpression: { periodoId: { $type: 'objectId' } }
  }
);
// Importaciones: clave deduplicada
nominaHistoricoReciboSchema.index(
  { tenantId: 1, claveImportacion: 1 },
  {
    unique: true,
    partialFilterExpression: { claveImportacion: { $type: 'string', $gt: '' } }
  }
);
nominaHistoricoReciboSchema.index({ tenantId: 1, empleadoId: 1, anio: 1, mes: 1 });
nominaHistoricoReciboSchema.index({ tenantId: 1, anio: 1, mes: 1 });

async function getNominaHistoricoReciboModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.NominaHistoricoRecibo ||
    conn.model('NominaHistoricoRecibo', nominaHistoricoReciboSchema, COLLECTION_NOMINA_HISTORICO)
  );
}

module.exports = getNominaHistoricoReciboModel;
