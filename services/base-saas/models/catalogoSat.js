const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CATALOGOS_SAT } = require('../config/constants');

const catalogoSatSchema = new mongoose.Schema(
  {
    catalogo: {
      type: String,
      required: true,
      trim: true,
      enum: ['c_TipoPercepcion', 'c_TipoDeduccion', 'c_TipoOtroPago', 'c_TipoHorasExtra']
    },
    clave: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    vigenciaDesde: { type: Date, required: true },
    vigenciaHasta: { type: Date, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_CATALOGOS_SAT }
);

catalogoSatSchema.index({ catalogo: 1, clave: 1, vigenciaDesde: -1 }, { unique: true });

async function getCatalogoSatModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CatalogoSat ||
    conn.model('CatalogoSat', catalogoSatSchema, COLLECTION_CATALOGOS_SAT)
  );
}

module.exports = getCatalogoSatModel;
