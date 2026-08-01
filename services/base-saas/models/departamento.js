const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_DEPARTAMENTOS } = require('../config/constants');

const departamentoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, default: '' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Departamento', default: null },
    codigoLegado: { type: Number, default: null },
    codigoExterno: { type: String, trim: true, default: '' },
    cuentaContableExterna: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_DEPARTAMENTOS }
);

departamentoSchema.index({ tenantId: 1, nombre: 1 }, { unique: true });
departamentoSchema.index(
  { tenantId: 1, codigoLegado: 1 },
  { unique: true, partialFilterExpression: { codigoLegado: { $type: 'number' } } }
);

async function getDepartamentoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Departamento || conn.model('Departamento', departamentoSchema, COLLECTION_DEPARTAMENTOS);
}

module.exports = getDepartamentoModel;
