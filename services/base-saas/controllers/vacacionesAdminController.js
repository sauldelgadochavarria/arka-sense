'use strict';

const getEmpleadoModel = require('../models/empleado');
const getVacacionSolicitudModel = require('../models/vacacionSolicitud');
const { requireEmpresaForTenant, scopeEmpleadosFromReq } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');
const { resolverSolicitud } = require('../services/vacacionesService');

/**
 * Bandeja RRHH: todas las solicitudes pendientes del alcance empresa/subsidiaria.
 */
async function listSolicitudesRrhh(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const status = trimString(req.query.status) || 'PENDING';
  const VacacionSolicitud = await getVacacionSolicitudModel();
  const Empleado = await getEmpleadoModel();

  const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: true }) || {
    tenantId: req.session.tenantId,
    estatus: 'activo'
  };
  const empleados = empresa ? await Empleado.find(empQ).select('_id firstName lastName numEmpleado supervisorId').lean() : [];
  const empIds = empleados.map((e) => e._id);
  const empMap = new Map(
    empleados.map((e) => [
      String(e._id),
      `${e.firstName || ''} ${e.lastName || ''} (${e.numEmpleado || ''})`.trim()
    ])
  );

  const filter = {
    tenantId: req.session.tenantId,
    empleadoId: { $in: empIds }
  };
  if (status !== 'todos') filter.status = status;

  const rows = empresa
    ? await VacacionSolicitud.find(filter).sort({ createdAt: -1 }).limit(200).lean()
    : [];

  res.render('Incidencias/vacaciones-solicitudes', {
    rows,
    empMap,
    status,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function resolverSolicitudRrhh(req, res) {
  try {
    const status = String(req.body.status || '').toUpperCase();
    await resolverSolicitud({
      tenantId: req.session.tenantId,
      solicitudId: req.params.id,
      status,
      userId: req.session.userid || '',
      motivoRechazo: trimString(req.body.motivoRechazo),
      actorEmpleadoId: null,
      allowRrhh: true
    });
    req.flash('success', status === 'APPROVED' ? 'Vacaciones aprobadas (RRHH)' : 'Solicitud rechazada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo resolver');
  }
  res.redirect('/incidencias/vacaciones/solicitudes');
}

module.exports = { listSolicitudesRrhh, resolverSolicitudRrhh };
