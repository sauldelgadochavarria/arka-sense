'use strict';

const getAsistenciaAuditoriaModel = require('../models/asistenciaAuditoria');

function snapshotMarcacion(doc) {
  if (!doc) return null;
  return {
    _id: doc._id ? String(doc._id) : '',
    empleadoId: doc.empleadoId ? String(doc.empleadoId) : '',
    fecha: doc.fecha || null,
    timestamp: doc.timestamp || null,
    timestampOriginal: doc.timestampOriginal || null,
    tipoMarcacion: doc.tipoMarcacion || '',
    metodo: doc.metodo || '',
    estado: doc.estado || 'activa',
    origen: doc.origen || 'original',
    notas: doc.notas || '',
    motivoAjuste: doc.motivoAjuste || '',
    motivoAnulacion: doc.motivoAnulacion || ''
  };
}

async function registrarAuditoriaAsistencia({
  tenantId,
  accion,
  entidad = 'marcacion',
  entidadId = '',
  empleadoId = null,
  fechaJornada = null,
  userId = '',
  userLabel = '',
  mensaje = '',
  motivo = '',
  antes = null,
  despues = null,
  detalle = {},
  ip = '',
  userAgent = ''
}) {
  if (!tenantId || !accion) return null;
  try {
    const AsistenciaAuditoria = await getAsistenciaAuditoriaModel();
    return AsistenciaAuditoria.create({
      tenantId,
      accion: String(accion).toUpperCase(),
      entidad,
      entidadId: entidadId ? String(entidadId) : '',
      empleadoId: empleadoId || null,
      fechaJornada: fechaJornada || null,
      userId: userId || '',
      userLabel: userLabel || '',
      mensaje: mensaje || '',
      motivo: motivo || '',
      antes: antes || null,
      despues: despues || null,
      detalle: detalle || {},
      ip: ip || '',
      userAgent: userAgent || ''
    });
  } catch (err) {
    console.error('[asistenciaAuditoria]', err.message);
    return null;
  }
}

async function listAuditoriaAsistencia(tenantId, { empleadoId, fechaDesde, fechaHasta, limit = 80 } = {}) {
  const AsistenciaAuditoria = await getAsistenciaAuditoriaModel();
  const q = { tenantId };
  if (empleadoId) q.empleadoId = empleadoId;
  if (fechaDesde || fechaHasta) {
    q.createdAt = {};
    if (fechaDesde) q.createdAt.$gte = fechaDesde;
    if (fechaHasta) q.createdAt.$lte = fechaHasta;
  }
  return AsistenciaAuditoria.find(q).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  snapshotMarcacion,
  registrarAuditoriaAsistencia,
  listAuditoriaAsistencia
};
