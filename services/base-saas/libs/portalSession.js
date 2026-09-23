'use strict';

const getEmpleadoModel = require('../models/empleado');

async function loadEmpleadoFromSession(req) {
  const empleadoId = req.session?.empleadoId;
  if (!empleadoId) return null;
  const Empleado = await getEmpleadoModel();
  return Empleado.findOne({
    _id: empleadoId,
    tenantId: req.session.tenantId,
    estatus: 'activo',
    activo: true
  }).lean();
}

function userIsSupervisorOrAdmin(req) {
  const roles = req.session?.roles || [];
  return roles.some(
    (r) =>
      r.esAdmin ||
      r.esAdminSistema ||
      r.nombre === 'Supervisor' ||
      r.nombre === 'RRHH' ||
      r.nombre === 'Admin Completo'
  );
}

async function getEquipoEmpleadoIds(tenantId, supervisorEmpleadoId) {
  if (!supervisorEmpleadoId) return [];
  const Empleado = await getEmpleadoModel();
  const equipo = await Empleado.find({
    tenantId,
    supervisorId: supervisorEmpleadoId,
    estatus: 'activo'
  })
    .select('_id')
    .lean();
  return equipo.map((e) => String(e._id));
}

/**
 * Contexto de alcance para pantallas de asistencia.
 * - RRHH/Admin: ve todo
 * - Supervisor con equipo: ve su equipo (+ pendientes asignados)
 */
async function resolveAsistenciaScope(req) {
  const isAdmin = userIsSupervisorOrAdmin(req);
  const roles = req.session?.roles || [];
  const isSupervisorRole = roles.some((r) => r.nombre === 'Supervisor');
  const empleadoId = req.session?.empleadoId || null;
  const equipoIds = empleadoId
    ? await getEquipoEmpleadoIds(req.session.tenantId, empleadoId)
    : [];
  const hasEquipo = equipoIds.length > 0;
  const scopeAll = isAdmin && !isSupervisorRole ? true : isAdmin && !hasEquipo;
  // Admin con equipo puede ver todo; supervisor puro solo equipo
  const onlyEquipo = hasEquipo && (!isAdmin || isSupervisorRole);

  return {
    isAdmin,
    isSupervisorRole,
    hasEquipo,
    onlyEquipo,
    scopeAll: !onlyEquipo,
    empleadoId,
    equipoIds,
    mode: onlyEquipo ? 'supervisor' : 'rrhh'
  };
}

module.exports = {
  loadEmpleadoFromSession,
  userIsSupervisorOrAdmin,
  getEquipoEmpleadoIds,
  resolveAsistenciaScope
};
