'use strict';

const getAttendanceAttemptModel = require('../models/attendanceAttempt');
const { startOfDay } = require('../libs/timeHelpers');

/**
 * Append-only: registra evidencia de intento (bio / geo / punch).
 * Nunca actualiza ni borra documentos existentes.
 */
async function registrarIntento(payload = {}) {
  try {
    const AttendanceAttempt = await getAttendanceAttemptModel();
    const at = payload.at ? new Date(payload.at) : new Date();
    const doc = await AttendanceAttempt.create({
      tenantId: payload.tenantId,
      empleadoId: payload.empleadoId,
      userId: payload.userId || '',
      etapa: payload.etapa || 'otro',
      resultado: payload.resultado || 'error',
      tipoMarcacion: payload.tipoMarcacion || '',
      mensaje: payload.mensaje || '',
      reasonCode: payload.reasonCode || '',
      marcacionId: payload.marcacionId || null,
      challengeId: payload.challengeId || payload.biometria?.challengeId || '',
      fechaJornada: payload.fechaJornada || startOfDay(at),
      biometria: payload.biometria || {},
      ubicacion: payload.ubicacion || {},
      geocerca: payload.geocerca || {},
      dispositivo: payload.dispositivo || {},
      detalle: payload.detalle || {},
      ip: payload.ip || '',
      userAgent: payload.userAgent || ''
    });
    return doc;
  } catch (err) {
    console.error('[attendanceAttempt]', err.message);
    return null;
  }
}

async function listIntentos(tenantId, opts = {}) {
  const AttendanceAttempt = await getAttendanceAttemptModel();
  const q = { tenantId };
  if (opts.empleadoId) q.empleadoId = opts.empleadoId;
  if (opts.marcacionId) q.marcacionId = opts.marcacionId;
  if (opts.resultado) q.resultado = opts.resultado;
  if (opts.etapa) q.etapa = opts.etapa;
  if (opts.fechaDesde || opts.fechaHasta) {
    q.createdAt = {};
    if (opts.fechaDesde) q.createdAt.$gte = opts.fechaDesde;
    if (opts.fechaHasta) q.createdAt.$lte = opts.fechaHasta;
  }
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 100));
  return AttendanceAttempt.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

async function listIntentosDeMarcacion(tenantId, marcacion, { windowMinutes = 180 } = {}) {
  const AttendanceAttempt = await getAttendanceAttemptModel();
  const empleadoId = marcacion.empleadoId;
  const ts = marcacion.timestamp ? new Date(marcacion.timestamp) : new Date();
  const from = new Date(ts.getTime() - windowMinutes * 60 * 1000);
  const to = new Date(ts.getTime() + 15 * 60 * 1000);
  const or = [];
  if (marcacion._id) or.push({ marcacionId: marcacion._id });
  if (marcacion.attemptId) or.push({ _id: marcacion.attemptId });
  or.push({
    empleadoId,
    createdAt: { $gte: from, $lte: to }
  });
  return AttendanceAttempt.find({ tenantId, $or: or }).sort({ createdAt: 1 }).lean();
}

module.exports = {
  registrarIntento,
  listIntentos,
  listIntentosDeMarcacion
};
