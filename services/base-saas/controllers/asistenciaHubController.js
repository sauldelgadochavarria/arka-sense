'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { resolveAsistenciaScope } = require('../libs/portalSession');
const {
  listPendientes,
  countPendientes,
  decidirAutorizacion,
  solicitarCambioTurno,
  resumenEquipoHoy
} = require('../services/asistenciaAutorizacionService');
const { listIntentos } = require('../services/attendanceAttemptService');
const { ESQUEMA_JORNADA_DEFAULTS } = require('../libs/esquemaJornada');

function sessionActor(req) {
  return {
    userId: req.session.userid || req.session.userId || '',
    userLabel: req.session.user || req.session.email || req.session.username || ''
  };
}

async function showHub(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const scope = await resolveAsistenciaScope(req);
  const fechaStr = trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());

  const Empleado = await getEmpleadoModel();
  const DailyAttendance = await getDailyAttendanceModel();

  let pendientes = [];
  let pendientesCount = 0;
  let equipoResumen = { presentes: 0, retardos: 0, faltas: 0, incompletos: 0, total: 0 };
  let alertasHoy = { fueraZona: 0, excede12: 0, intentosRechazados: 0 };
  let diariosHoy = [];

  if (empresa && !error) {
    const pendienteOpts = scope.onlyEquipo
      ? {
          equipoIds: scope.equipoIds,
          supervisorId: scope.empleadoId || undefined,
          limit: 15
        }
      : { limit: 15 };
    pendientes = await listPendientes(req.session.tenantId, pendienteOpts);
    pendientesCount = await countPendientes(
      req.session.tenantId,
      scope.onlyEquipo
        ? { equipoIds: scope.equipoIds, supervisorId: scope.empleadoId || undefined }
        : {}
    );
    if (scope.onlyEquipo) {
      equipoResumen = await resumenEquipoHoy(req.session.tenantId, scope.equipoIds, fecha);
    }

    const dailyFilter = {
      tenantId: req.session.tenantId,
      fecha: { $gte: fecha, $lte: endOfDay(fecha) }
    };
    if (scope.onlyEquipo && scope.equipoIds.length) {
      dailyFilter.empleadoId = { $in: scope.equipoIds };
    }
    diariosHoy = await DailyAttendance.find(dailyFilter).lean();
    alertasHoy.excede12 = diariosHoy.filter((d) => d.excedeLimiteDiario).length;

    const intentos = await listIntentos(req.session.tenantId, {
      fechaDesde: fecha,
      fechaHasta: endOfDay(fecha),
      limit: 200
    });
    const intentosFiltrados =
      scope.onlyEquipo && scope.equipoIds.length
        ? intentos.filter((i) => scope.equipoIds.includes(String(i.empleadoId)))
        : intentos;
    alertasHoy.intentosRechazados = intentosFiltrados.filter((i) => i.resultado === 'rechazado').length;
    alertasHoy.fueraZona = intentosFiltrados.filter(
      (i) => i.geocerca?.fueraDeZona || i.etapa === 'geo_check'
    ).length;
  }

  const empIds = [...new Set(pendientes.map((p) => String(p.empleadoId)))];
  const empleadosPend =
    empIds.length && empresa
      ? await Empleado.find({ _id: { $in: empIds }, tenantId: req.session.tenantId })
          .select('firstName lastName numEmpleado')
          .lean()
      : [];
  const empMap = new Map(
    empleadosPend.map((e) => [
      String(e._id),
      `${e.firstName} ${e.lastName} (${e.numEmpleado})`
    ])
  );

  res.render('Asistencia/hub', {
    empresa,
    error: error || null,
    session: req.session,
    scope,
    fecha: fechaStr,
    pendientes,
    pendientesCount,
    empMap,
    equipoResumen,
    alertasHoy,
    maxOrdinarias: ESQUEMA_JORNADA_DEFAULTS.maxHorasOrdinariasSemana,
    formatTimeHHMM,
    pasoActual: 0
  });
}

async function listAutorizaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const scope = await resolveAsistenciaScope(req);
  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();

  let pendientes = [];
  if (empresa && !error) {
    pendientes = await listPendientes(
      req.session.tenantId,
      scope.onlyEquipo
        ? {
            equipoIds: scope.equipoIds,
            supervisorId: scope.empleadoId || undefined,
            limit: 100
          }
        : { limit: 100 }
    );
  }

  const empIds = [...new Set(pendientes.map((p) => String(p.empleadoId)))];
  const empleados = empIds.length
    ? await Empleado.find({ _id: { $in: empIds } })
        .select('firstName lastName numEmpleado')
        .lean()
    : [];
  const empMap = new Map(
    empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`])
  );

  const turnos = empresa
    ? await Turno.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean()
    : [];
  const equipo =
    scope.hasEquipo && scope.empleadoId
      ? await Empleado.find({
          tenantId: req.session.tenantId,
          supervisorId: scope.empleadoId,
          estatus: 'activo'
        })
          .sort({ lastName: 1 })
          .lean()
      : scope.scopeAll
        ? await Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' })
            .sort({ lastName: 1 })
            .limit(200)
            .lean()
        : [];

  res.render('Asistencia/autorizaciones', {
    empresa,
    error: error || null,
    session: req.session,
    scope,
    pendientes,
    empMap,
    turnos,
    equipo,
    formatTimeHHMM,
    pasoActual: 2
  });
}

async function decidirAction(req, res) {
  try {
    const scope = await resolveAsistenciaScope(req);
    const id = parseOptionalObjectId(req.params.id);
    const aprobar = trimString(req.body.decision) === 'aprobar';
    const motivo = trimString(req.body.motivoDecision);
    if (!id) {
      req.flash('error', 'Solicitud no encontrada');
      return res.redirect('/asistencia-autorizaciones');
    }

    const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
    const actor = sessionActor(req);

    // Seguridad básica: supervisor solo su equipo o asignados a él
    if (scope.onlyEquipo) {
      const getAsistenciaAutorizacionModel = require('../models/asistenciaAutorizacion');
      const Aut = await getAsistenciaAutorizacionModel();
      const doc = await Aut.findOne({ _id: id, tenantId: req.session.tenantId }).lean();
      if (!doc) {
        req.flash('error', 'Solicitud no encontrada');
        return res.redirect('/asistencia-autorizaciones');
      }
      const inEquipo = scope.equipoIds.includes(String(doc.empleadoId));
      const assignedToMe = String(doc.supervisorId || '') === String(scope.empleadoId || '');
      if (!inEquipo && !assignedToMe) {
        req.flash('error', 'No puedes decidir sobre colaboradores fuera de tu equipo');
        return res.redirect('/asistencia-autorizaciones');
      }
    }

    await decidirAutorizacion({
      tenantId: req.session.tenantId,
      id,
      aprobar,
      motivoDecision: motivo,
      userId: actor.userId,
      decididoPorEmpleadoId: scope.empleadoId,
      empresaId: empresa?._id || null
    });

    req.flash('success', aprobar ? 'Autorización aprobada' : 'Solicitud rechazada');
    res.redirect('/asistencia-autorizaciones');
  } catch (err) {
    console.error('[asistencia.decidir]', err);
    req.flash(
      'error',
      err.message === 'NOT_PENDING'
        ? 'La solicitud ya fue decidida'
        : err.message === 'NOT_FOUND'
          ? 'Solicitud no encontrada'
          : 'Error al registrar decisión'
    );
    res.redirect('/asistencia-autorizaciones');
  }
}

async function solicitarCambioTurnoAction(req, res) {
  try {
    const scope = await resolveAsistenciaScope(req);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const fecha = parseDateTimeLocal(`${trimString(req.body.fecha)}T12:00`);
    const turnoPropuestoId = parseOptionalObjectId(req.body.turnoPropuestoId);
    const esDescanso = trimString(req.body.esDescanso) === '1';
    const motivo = trimString(req.body.motivo);

    if (!empleadoId || !fecha) {
      req.flash('error', 'Empleado y fecha son obligatorios');
      return res.redirect('/asistencia-autorizaciones');
    }
    if (scope.onlyEquipo && !scope.equipoIds.includes(String(empleadoId))) {
      req.flash('error', 'Solo puedes solicitar cambios para tu equipo');
      return res.redirect('/asistencia-autorizaciones');
    }

    const actor = sessionActor(req);
    await solicitarCambioTurno({
      tenantId: req.session.tenantId,
      empleadoId,
      fecha,
      turnoPropuestoId: esDescanso ? null : turnoPropuestoId,
      esDescansoPropuesto: esDescanso,
      motivo,
      userId: actor.userId,
      supervisorId: scope.empleadoId
    });

    req.flash('success', 'Solicitud de cambio de turno registrada (pendiente)');
    res.redirect('/asistencia-autorizaciones');
  } catch (err) {
    console.error('[asistencia.cambioTurno]', err);
    req.flash('error', 'No se pudo registrar la solicitud');
    res.redirect('/asistencia-autorizaciones');
  }
}

module.exports = {
  showHub,
  listAutorizaciones,
  decidirAction,
  solicitarCambioTurnoAction
};
