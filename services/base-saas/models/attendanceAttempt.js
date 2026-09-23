'use strict';

const mongoose = require('mongoose');
const { getFixedMongooseConnection, FIXED_CONNECTIONS } = require('../services/cachingService');
const { COLLECTION_ATTENDANCE_ATTEMPTS } = require('../config/constants');

/**
 * Intento de checado / verificación (append-only).
 * Evidencia FT/REJL: no se edita ni se borra en operación normal.
 */
const RESULTADOS = ['aceptado', 'aceptado_con_observacion', 'rechazado', 'error'];
const ETAPAS = [
  'bio_verify',
  'geo_check',
  'punch',
  'punch_duplicate',
  'punch_fake_gps',
  'otro'
];

const attendanceAttemptSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true, index: true },
    empleadoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Empleado',
      required: true,
      index: true
    },
    userId: { type: String, default: '', trim: true, index: true },
    etapa: { type: String, enum: ETAPAS, required: true, index: true },
    resultado: { type: String, enum: RESULTADOS, required: true, index: true },
    tipoMarcacion: { type: String, default: '' },
    mensaje: { type: String, default: '' },
    reasonCode: { type: String, default: '' },
    /** Marcación efectiva creada (si hubo). */
    marcacionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceRecord',
      default: null,
      index: true
    },
    challengeId: { type: String, default: '' },
    fechaJornada: { type: Date, default: null, index: true },
    biometria: {
      ok: { type: Boolean, default: null },
      score: { type: Number, default: null },
      distance: { type: Number, default: null },
      threshold: { type: Number, default: null },
      challengeId: { type: String, default: '' },
      usedFlip: { type: Boolean, default: false }
    },
    ubicacion: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      accuracyMeters: { type: Number, default: null },
      isMocked: { type: Boolean, default: false }
    },
    geocerca: {
      politica: { type: String, default: '' },
      fueraDeZona: { type: Boolean, default: false },
      allowed: { type: Boolean, default: null },
      siteNombre: { type: String, default: '' },
      distanceMeters: { type: Number, default: null },
      radioMetros: { type: Number, default: null },
      skipped: { type: Boolean, default: false }
    },
    dispositivo: {
      plataforma: { type: String, default: '' },
      modelo: { type: String, default: '' },
      appVersion: { type: String, default: '' }
    },
    detalle: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' }
  },
  { timestamps: true, collection: COLLECTION_ATTENDANCE_ATTEMPTS }
);

attendanceAttemptSchema.index({ tenantId: 1, createdAt: -1 });
attendanceAttemptSchema.index({ tenantId: 1, empleadoId: 1, createdAt: -1 });
attendanceAttemptSchema.index({ tenantId: 1, fechaJornada: 1, resultado: 1 });

async function getAttendanceAttemptModel() {
  const conn = await getFixedMongooseConnection(FIXED_CONNECTIONS.CONFIG);
  return (
    conn.models.AttendanceAttempt ||
    conn.model('AttendanceAttempt', attendanceAttemptSchema, COLLECTION_ATTENDANCE_ATTEMPTS)
  );
}

module.exports = getAttendanceAttemptModel;
module.exports.ATTEMPT_RESULTADOS = RESULTADOS;
module.exports.ATTEMPT_ETAPAS = ETAPAS;
