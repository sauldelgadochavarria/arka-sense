const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CATALOGO_MAPEO_LEGADO } = require('../config/constants');

const catalogoMapeoLegadoSchema = new mongoose.Schema(
  {
    fuente: { type: String, required: true, trim: true, default: 'legado' },
    tipoMapeo: {
      type: String,
      required: true,
      enum: ['tipo_perded_sat', 'tipo_hora_extra_sat', 'tipo_otro_pago_sat']
    },
    claveLegado: { type: String, required: true, trim: true },
    tipoConcepto: {
      type: String,
      enum: ['percepcion', 'deduccion', 'otro_pago', ''],
      default: ''
    },
    catalogoSat: {
      type: String,
      required: true,
      trim: true,
      enum: ['c_TipoPercepcion', 'c_TipoDeduccion', 'c_TipoOtroPago', 'c_TipoHorasExtra']
    },
    claveSat: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    tipoHoraExtra: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_CATALOGO_MAPEO_LEGADO }
);

catalogoMapeoLegadoSchema.index({ fuente: 1, tipoMapeo: 1, claveLegado: 1 }, { unique: true });

async function getCatalogoMapeoLegadoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CatalogoMapeoLegado ||
    conn.model('CatalogoMapeoLegado', catalogoMapeoLegadoSchema, COLLECTION_CATALOGO_MAPEO_LEGADO)
  );
}

module.exports = getCatalogoMapeoLegadoModel;
