const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_TURNOS } = require('../config/constants');

const turnoSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empresaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empresa', required: true },
    nombre: { type: String, required: true, trim: true },
    tipo: {
      type: String,
      enum: ['fijo', 'flexible', 'nocturno', 'remoto', 'por_horas'],
      default: 'fijo'
    },
    diasLaborables: { type: [Number], default: [1, 2, 3, 4, 5] },
    horaEntrada: { type: String, required: true, trim: true },
    horaSalida: { type: String, required: true, trim: true },
    toleranciaEntradaMin: { type: Number, default: 10, min: 0 },
    toleranciaSalidaMin: { type: Number, default: 5, min: 0 },
    modoTolerancia: { type: String, enum: ['normal', 'concorte'], default: 'normal' },
    holguraAntesMin: { type: Number, default: 180, min: 0 },
    holguraDespuesMin: { type: Number, default: 180, min: 0 },
    tiempoComidaMin: { type: Number, default: 60, min: 0 },
    comidaChecada: { type: Boolean, default: false },
    noRegistrarComida: { type: Boolean, default: true },
    horasJornada: { type: Number, default: 8, min: 0 },
    inicioHEOrdinariaMin: { type: Number, default: 0, min: 0 },
    inicioHEDobleMin: { type: Number, default: null, min: 0 },
    inicioHETripleMin: { type: Number, default: null, min: 0 },
    descansaSabado: { type: Boolean, default: true },
    descansaDomingo: { type: Boolean, default: true },
    color: { type: String, default: '#2563eb', trim: true },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true, collection: COLLECTION_TURNOS }
);

turnoSchema.index({ tenantId: 1, nombre: 1 }, { unique: true });

async function getTurnoModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Turno || conn.model('Turno', turnoSchema, COLLECTION_TURNOS);
}

module.exports = getTurnoModel;
