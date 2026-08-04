'use strict';

const getNominaAuditoriaModel = require('../../models/nominaAuditoria');

async function registrarAuditoriaNomina({
  tenantId,
  accion,
  entidad = 'periodo',
  entidadId = '',
  periodoId = null,
  userId = '',
  userLabel = '',
  mensaje = '',
  detalle = {},
  ip = '',
  userAgent = ''
}) {
  if (!tenantId || !accion) return null;
  try {
    const NominaAuditoria = await getNominaAuditoriaModel();
    return NominaAuditoria.create({
      tenantId,
      accion: String(accion).toUpperCase(),
      entidad,
      entidadId: entidadId ? String(entidadId) : periodoId ? String(periodoId) : '',
      periodoId: periodoId || null,
      userId: userId || '',
      userLabel: userLabel || '',
      mensaje: mensaje || '',
      detalle: detalle || {},
      ip: ip || '',
      userAgent: userAgent || ''
    });
  } catch (err) {
    console.error('[nominaAuditoria]', err.message);
    return null;
  }
}

async function listAuditoriaPeriodo(tenantId, periodoId, limit = 40) {
  const NominaAuditoria = await getNominaAuditoriaModel();
  return NominaAuditoria.find({ tenantId, periodoId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = { registrarAuditoriaNomina, listAuditoriaPeriodo };
