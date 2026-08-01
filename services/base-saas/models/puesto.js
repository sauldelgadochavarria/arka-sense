const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PUESTOS } = require('../config/constants');

const puestoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    nivel: { type: String, default: '' },
    descripcion: { type: String, default: '' },
    codigoLegado: { type: Number, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_PUESTOS }
);

puestoSchema.index({ tenantId: 1, nombre: 1 }, { unique: true });
puestoSchema.index(
  { tenantId: 1, codigoLegado: 1 },
  { unique: true, partialFilterExpression: { codigoLegado: { $type: 'number' } } }
);

async function getPuestoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Puesto || conn.model('Puesto', puestoSchema, COLLECTION_PUESTOS);
}

module.exports = getPuestoModel;
