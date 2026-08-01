const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_PLANTILLAS_ROTACION } = require('../config/constants');

const slotSchema = new mongoose.Schema(
  {
    semanaIndex: { type: Number, required: true, min: 0 },
    diaSemana: { type: Number, required: true, min: 0, max: 6 },
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null },
    esDescanso: { type: Boolean, default: false }
  },
  { _id: false }
);

const cicloSlotSchema = new mongoose.Schema(
  {
    turnoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null },
    esDescanso: { type: Boolean, default: false }
  },
  { _id: false }
);

const plantillaRotacionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true, default: '' },
    tipo: {
      type: String,
      enum: ['fijo', 'secuencia', 'matriz'],
      default: 'matriz',
      index: true
    },
    turnoFijoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turno', default: null },
    cicloSlots: { type: [cicloSlotSchema], default: [] },
    numSemanas: { type: Number, min: 1, max: 12, default: 2 },
    slots: { type: [slotSchema], default: [] },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_PLANTILLAS_ROTACION }
);

plantillaRotacionSchema.index({ tenantId: 1, nombre: 1 }, { unique: true });

async function getPlantillaRotacionModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.PlantillaRotacion ||
    conn.model('PlantillaRotacion', plantillaRotacionSchema, COLLECTION_PLANTILLAS_ROTACION)
  );
}

module.exports = getPlantillaRotacionModel;
