const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_GRUPOS_DISPOSITIVOS } = require('../config/constants');

const grupoDispositivosSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    subsidiariaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subsidiaria' },
    dispositivoIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BiometricDevice' }],
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_GRUPOS_DISPOSITIVOS }
);

grupoDispositivosSchema.index({ tenantId: 1, nombre: 1 }, { unique: true });

async function getGrupoDispositivosModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.GrupoDispositivos ||
    conn.model('GrupoDispositivos', grupoDispositivosSchema, COLLECTION_GRUPOS_DISPOSITIVOS)
  );
}

module.exports = getGrupoDispositivosModel;
