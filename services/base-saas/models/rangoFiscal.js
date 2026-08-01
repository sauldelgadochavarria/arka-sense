const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_RANGOS_FISCALES } = require('../config/constants');

const rangoFiscalSchema = new mongoose.Schema(
  {
    tablaId: { type: mongoose.Schema.Types.ObjectId, ref: 'TablaFiscal', required: true, index: true },
    limiteInferior: { type: Number, required: true },
    limiteSuperior: { type: Number, required: true },
    cuotaFija: { type: Number, default: 0 },
    porcentajeExcedente: { type: Number, default: 0 }
  },
  { timestamps: true, collection: COLLECTION_RANGOS_FISCALES }
);

rangoFiscalSchema.index({ tablaId: 1, limiteInferior: 1 });

async function getRangoFiscalModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.RangoFiscal ||
    conn.model('RangoFiscal', rangoFiscalSchema, COLLECTION_RANGOS_FISCALES)
  );
}

module.exports = getRangoFiscalModel;
