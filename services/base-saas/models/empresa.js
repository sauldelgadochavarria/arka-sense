const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const empresaSchema = new mongoose.Schema(
  {
    razonSocial: { type: String, required: true, trim: true },
    nombreComercial: { type: String, trim: true },
    rfc: { type: String, trim: true, uppercase: true, default: '' },
    domicilioFiscal: { type: String, trim: true, default: '' },
    ciudad: { type: String, trim: true, default: '' },
    estado: { type: String, trim: true, default: '' },
    codigoPostal: { type: String, trim: true, default: '' },
    giro: { type: String, trim: true, default: '' },
    telefono: { type: String, trim: true, default: '' },
    tenantId: { type: String, trim: true },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'empresas' }
);

empresaSchema.index({ tenantId: 1 }, { unique: true, sparse: true });

async function getEmpresaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Empresa || conn.model('Empresa', empresaSchema, 'empresas');
}

module.exports = getEmpresaModel;
