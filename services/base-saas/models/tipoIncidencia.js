const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TIPOS_INCIDENCIA } = require('../config/constants');

const tipoIncidenciaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    clave: { type: String, required: true, trim: true, uppercase: true },
    nombre: { type: String, required: true, trim: true },
    afectaPago: { type: Boolean, default: false },
    requiereAprobacion: { type: Boolean, default: true },
    requiereDocumento: { type: Boolean, default: false },
    esAutomatica: { type: Boolean, default: false },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_TIPOS_INCIDENCIA }
);

tipoIncidenciaSchema.index({ tenantId: 1, clave: 1 }, { unique: true });

async function getTipoIncidenciaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.TipoIncidencia ||
    conn.model('TipoIncidencia', tipoIncidenciaSchema, COLLECTION_TIPOS_INCIDENCIA)
  );
}

module.exports = getTipoIncidenciaModel;
