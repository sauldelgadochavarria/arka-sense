const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_CENTROS_COSTO } = require('../config/constants');

const centroCostoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    codigoLegado: { type: Number, default: null },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    codigoExterno: { type: String, trim: true, default: '' },
    cuentaContableExterna: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_CENTROS_COSTO }
);

centroCostoSchema.index({ tenantId: 1, codigo: 1 }, { unique: true });
centroCostoSchema.index(
  { tenantId: 1, codigoLegado: 1 },
  { unique: true, partialFilterExpression: { codigoLegado: { $type: 'number' } } }
);

async function getCentroCostoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.CentroCosto ||
    conn.model('CentroCosto', centroCostoSchema, COLLECTION_CENTROS_COSTO)
  );
}

module.exports = getCentroCostoModel;
