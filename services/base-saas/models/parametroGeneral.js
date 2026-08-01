const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PARAMETROS_GENERALES } = require('../config/constants');

const parametroGeneralSchema = new mongoose.Schema(
  {
    clave: { type: String, required: true, trim: true, uppercase: true },
    valor: { type: Number, required: true },
    vigenciaDesde: { type: Date, required: true },
    vigenciaHasta: { type: Date, default: null },
    descripcion: { type: String, trim: true, default: '' }
  },
  { timestamps: true, collection: COLLECTION_PARAMETROS_GENERALES }
);

parametroGeneralSchema.index({ clave: 1, vigenciaDesde: -1 });

async function getParametroGeneralModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.ParametroGeneral ||
    conn.model('ParametroGeneral', parametroGeneralSchema, COLLECTION_PARAMETROS_GENERALES)
  );
}

module.exports = getParametroGeneralModel;
