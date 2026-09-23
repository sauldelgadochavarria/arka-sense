'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ASISTENCIA_AUTORIZACIONES } = require('../config/constants');

const TIPOS = ['retardo', 'cambio_turno', 'fuera_zona', 'horas_extra', 'otro'];
const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'cancelada'];

/**
 * Solicitud / pendiente de autorización operativa (supervisor o RRHH).
 * Append-friendly: al decidir se actualiza estado + bitácora en asistencia_auditoria.
 */
const asistenciaAutorizacionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      required: true,
      index: true
    },
    /** Supervisor sugerido (empleado.supervisorId al crear). */
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      default: null,
      index: true
    },
    tipo: { type: String, enum: TIPOS, required: true, index: true },
    estado: { type: String, enum: ESTADOS, default: 'pendiente', index: true },
    fecha: { type: Date, required: true, index: true },
    dailyAttendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DailyAttendance',
      default: null
    },
    marcacionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceRecord',
      default: null
    },
    minutosRetardo: { type: Number, default: 0 },
    minutosHE: { type: Number, default: 0 },
    fueraDeZona: { type: Boolean, default: false },
    /** Para cambio de turno: turno propuesto o descanso. */
    turnoPropuestoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Turno',
      default: null
    },
    esDescansoPropuesto: { type: Boolean, default: false },
    motivoSolicitud: { type: String, default: '' },
    motivoDecision: { type: String, default: '' },
    solicitadoPorUserId: { type: String, default: '' },
    decididoPorUserId: { type: String, default: '' },
    decididoPorEmpleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      default: null
    },
    decididoEn: { type: Date, default: null },
    detalle: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: COLLECTION_ASISTENCIA_AUTORIZACIONES }
);

asistenciaAutorizacionSchema.index(
  { tenantId: 1, empleadoId: 1, fecha: 1, tipo: 1 },
  { unique: true }
);
asistenciaAutorizacionSchema.index({ tenantId: 1, estado: 1, supervisorId: 1, createdAt: -1 });

async function getAsistenciaAutorizacionModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AsistenciaAutorizacion ||
    conn.model(
      'AsistenciaAutorizacion',
      asistenciaAutorizacionSchema,
      COLLECTION_ASISTENCIA_AUTORIZACIONES
    )
  );
}

module.exports = getAsistenciaAutorizacionModel;
module.exports.TIPOS_AUTORIZACION_ASISTENCIA = TIPOS;
module.exports.ESTADOS_AUTORIZACION_ASISTENCIA = ESTADOS;
