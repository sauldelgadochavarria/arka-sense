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

module.exports = { loadEmpleadoFromSession, userIsSupervisorOrAdmin, getEquipoEmpleadoIds };
