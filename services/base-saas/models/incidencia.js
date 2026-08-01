const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_INCIDENCIAS } = require('../config/constants');

const incidenciaSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Empleado', required: true, index: true },
    tipoIncidenciaId: { type: mongoose.Schema.Types.ObjectId, ref: 'TipoIncidencia' },
    codigo: { type: String, required: true, trim: true, uppercase: true },
    fechaInicio: { type: Date, required: true, index: true },
    fechaFin: { type: Date, required: true },
    diasAfectados: { type: Number, default: 1, min: 0 },
    minutosAfectados: { type: Number, default: 0, min: 0 },
    motivo: { type: String, default: '' },
    documentoReferencia: { type: String, default: '' },
    origen: {
      type: String,
      enum: ['solicitud_empleado', 'manual_rrhh', 'automatica'],
      default: 'solicitud_empleado'
    },
    estatus: {
      type: String,
      enum: ['pendiente', 'aprobada', 'rechazada', 'cancelada'],
      default: 'pendiente',
      index: true
    },
    solicitadoPorUserId: { type: String, default: '' },
    resueltoPorUserId: { type: String, default: '' },
    notasResolucion: { type: String, default: '' },
    fechaResolucion: { type: Date },
    dailyAttendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyAttendance' }
  },
  { timestamps: true, collection: COLLECTION_INCIDENCIAS }
);

incidenciaSchema.index({ tenantId: 1, empleadoId: 1, fechaInicio: 1, codigo: 1 });

async function getIncidenciaModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return conn.models.Incidencia || conn.model('Incidencia', incidenciaSchema, COLLECTION_INCIDENCIAS);
}

module.exports = getIncidenciaModel;
