const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ASIGNACIONES_ROTACION } = require('../config/constants');

const asignacionRotacionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    plantillaRotacionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlantillaRotacion',
      required: true
    },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true },
    fechaAncla: { type: Date, required: true },
    notas: { type: String, trim: true, default: '' },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_ASIGNACIONES_ROTACION }
);

asignacionRotacionSchema.index({ tenantId: 1, empleadoId: 1 }, { unique: true });

async function getAsignacionRotacionModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AsignacionRotacion ||
    conn.model('AsignacionRotacion', asignacionRotacionSchema, COLLECTION_ASIGNACIONES_ROTACION)
  );
}

module.exports = getAsignacionRotacionModel;
