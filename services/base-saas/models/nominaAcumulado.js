'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_NOMINA_ACUMULADOS } = require('../config/constants');

/**
 * Acumulados anuales por empleado y concepto (se actualizan al cerrar período).
 * porMes permite consultas mensuales sin fragmentar en 12 docs.
 * Alcance de consulta: tenantId + empresaId + subsidiariaId.
 */
const nominaAcumuladoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', default: null, index: true },
    subsidiariaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subsidiaria',
      default: null,
      index: true
    },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    anio: { type: Number, required: true, index: true },
    conceptoCodigo: { type: String, required: true, trim: true, uppercase: true },
    importeAnual: { type: Number, default: 0 },
    gravadoAnual: { type: Number, default: 0 },
    exentoAnual: { type: Number, default: 0 },
    porMes: { type: mongoose.Schema.Types.Mixed, default: {} },
    ultimoPeriodoId: { type: mongoose.Schema.Types.ObjectId, ref: 'PeriodoNomina', default: null },
    ultimaFechaCierre: { type: Date }
  },
  { timestamps: true, collection: COLLECTION_NOMINA_ACUMULADOS }
);

// Unicidad operativa (empleado es único en el tenant); empresa/subsidiaria van denormalizadas.
nominaAcumuladoSchema.index(
  { tenantId: 1, empleadoId: 1, anio: 1, conceptoCodigo: 1 },
  { unique: true }
);
nominaAcumuladoSchema.index({ tenantId: 1, empresaId: 1, subsidiariaId: 1, anio: 1, conceptoCodigo: 1 });
nominaAcumuladoSchema.index({ tenantId: 1, subsidiariaId: 1, anio: 1, conceptoCodigo: 1 });

async function getNominaAcumuladoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.NominaAcumulado ||
    conn.model('NominaAcumulado', nominaAcumuladoSchema, COLLECTION_NOMINA_ACUMULADOS)
  );
}

module.exports = getNominaAcumuladoModel;
