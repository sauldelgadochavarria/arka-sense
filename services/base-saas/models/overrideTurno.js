const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_OVERRIDES_TURNO } = require('../config/constants');

const overrideTurnoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    fecha: { type: Date, required: true, index: true },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null },
    esDescanso: { type: Boolean, default: false },
    motivo: { type: String, trim: true, default: '' },
    creadoPorUserId: { type: String, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_OVERRIDES_TURNO }
);

overrideTurnoSchema.index({ tenantId: 1, empleadoId: 1, fecha: 1 }, { unique: true });

async function getOverrideTurnoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.OverrideTurno ||
    conn.model('OverrideTurno', overrideTurnoSchema, COLLECTION_OVERRIDES_TURNO)
  );
}

module.exports = getOverrideTurnoModel;
