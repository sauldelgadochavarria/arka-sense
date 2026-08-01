const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TIPOS_PERIODO_NOMINA } = require('../config/constants');

const tipoPeriodoNominaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    codigoLegado: { type: Number, required: true },
    codigoExterno: { type: String, trim: true, default: '' },
    nombre: { type: String, required: true, trim: true },
    tipoMotor: {
      type: String,
      enum: ['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'],
      default: 'quincenal'
    },
    diasPeriodo: { type: Number, default: 0 },
    esSeptimo: { type: Boolean, default: false },
    diasLaborables: { type: Number, default: 0 },
    leyenda: { type: String, trim: true, default: '' },
    periodicidadPagoSat: { type: Number, default: null },
    aplicaAsistenciaPrenomina: { type: Boolean, default: true },
    compartirConNomina: { type: Boolean, default: true },
    activo: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_TIPOS_PERIODO_NOMINA }
);

tipoPeriodoNominaSchema.index({ tenantId: 1, codigoLegado: 1 }, { unique: true });

async function getTipoPeriodoNominaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TipoPeriodoNomina ||
    conn.model('TipoPeriodoNomina', tipoPeriodoNominaSchema, COLLECTION_TIPOS_PERIODO_NOMINA)
  );
}

module.exports = getTipoPeriodoNominaModel;
