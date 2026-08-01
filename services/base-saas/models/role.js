const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ROLES } = require('../config/constants');

const roleSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, unique: true, trim: true },
    descripcion: { type: String },
    esAdmin: { type: Boolean, default: false },
    adminAccesoConfig: { type: Boolean, default: false },
    puedeGestionarSubsidiarias: { type: Boolean, default: false },
    esAdminSistema: { type: Boolean, default: false },
    puedeVerReportes: { type: Boolean, default: false },
    puedeVerNomina: { type: Boolean, default: false },
    puedeGestionarNomina: { type: Boolean, default: false },
    activo: { type: Boolean, default: true },
    tenantFeatureKey: { type: String, trim: true, default: 'core' }
  },
  { timestamps: true, collection: COLLECTION_ROLES }
);

async function getRoleModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Rol || conn.model('Rol', roleSchema, COLLECTION_ROLES);
}

module.exports = getRoleModel;
