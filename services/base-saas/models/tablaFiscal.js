const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TABLAS_FISCALES } = require('../config/constants');

const tablaFiscalSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, trim: true, default: '' },
    vigenciaDesde: { type: Date, required: true },
    vigenciaHasta: { type: Date, default: null },
    periodicidad: {
      type: String,
      enum: ['diario', 'semanal', 'quincenal', 'mensual', 'anual'],
      default: 'mensual'
    },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_TABLAS_FISCALES }
);

tablaFiscalSchema.index({ codigo: 1, vigenciaDesde: -1 });

async function getTablaFiscalModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TablaFiscal ||
    conn.model('TablaFiscal', tablaFiscalSchema, COLLECTION_TABLAS_FISCALES)
  );
}

module.exports = getTablaFiscalModel;
