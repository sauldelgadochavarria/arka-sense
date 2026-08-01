const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');

const subsidiariaSchema = new mongoose.Schema(
  {
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    codigo: { type: String, required: true, unique: true, trim: true, uppercase: true },
    direccion: { type: String, default: '' },
    ciudad: { type: String, default: '' },
    estado: { type: String, default: '' },
    codigoPostal: { type: String, default: '' },
    lat: { type: Number },
    lng: { type: Number },
    geocercaRadioMetros: { type: Number, min: 0 },
    codigoLegado: { type: Number, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: 'subsidiarias' }
);

subsidiariaSchema.index(
  { empresaId: 1, codigoLegado: 1 },
  { unique: true, partialFilterExpression: { codigoLegado: { $type: 'number' } } }
);

async function getSubsidiariaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Subsidiaria || conn.model('Subsidiaria', subsidiariaSchema, 'subsidiarias');
}

module.exports = getSubsidiariaModel;
