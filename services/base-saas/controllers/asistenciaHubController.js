'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDepartamentoModel = require('../models/departamento');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { requireEmpresaForTenant, scopeEmpleadosFromReq, scopeDepartamentoFilter, scopeTurnoFilter, sessionSubsidiariaId } = require('../libs/tenantScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, formatTimeHHMM } = require('../libs/timeHelpers');
const { contextoFecha, zonaDeSubsidiariaId } = require('../services/zonaHorariaService');
const { resolveAsistenciaScope } = require('../libs/portalSession');
const {
  listPendientes,
  listRegistroYAutorizaciones,
  countPendientes,
  decidirAutorizacion,
  autorizarDia,
  autorizarDias,
  clasificarAutorizacion,
  heMinimosDe,
  solicitarCambioTurno,
  resumenEquipoHoy
} = require('../services/asistenciaAutorizacionService');
const { contarEnRango } = require('../services/attendanceAttemptService');
const { resolverRangoAsistencia } = require('../libs/rangoAsistencia');
const { completarDescansosRango } = require('../services/attendanceProcessingService');
const { ESQUEMA_JORNADA_DEFAULTS } = require('../libs/esquemaJornada');
const { ESTATUS_DIARIO } = require('../config/asistencia');

function sessionActor(req) {
  return {
    userId: req.session.userid || req.session.userId || '',
    userLabel: req.session.user || req.session.email || req.session.username || ''
  };
}

function filtrosAutorizacion(src) {
  const body = src || {};
  let fechaDesde = trimString(body.fechaDesde);
  let fechaHasta = trimString(body.fechaHasta);
  if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
    const swap = fechaDesde;
    fechaDesde = fechaHasta;
    fechaHasta = swap;
  }
  return {
    fechaDesde,
    fechaHasta,
    departamentoId: parseOptionalObjectId(body.departamentoId) || ''
  };
}

function idsParaConsulta(idsSub, scope) {
  if (!scope.onlyEquipo) return idsSub;
  const equipo = new Set((scope.equipoIds || []).map(String));
  if (!idsSub) return [...equipo];
  return idsSub.filter((id) => equipo.has(String(id)));
}

function redirectAutorizaciones(req, extra) {
  const f = filtrosAutorizacion(req.body && (req.body.fechaDesde || req.body.fechaHasta || req.body.departamentoId) ? req.body : req.query);
  const q = new URLSearchParams();
  if (f.fechaDesde) q.set('fechaDesde', f.fechaDesde);
  if (f.fechaHasta) q.set('fechaHasta', f.fechaHasta);
  if (f.departamentoId) q.set('departamentoId', String(f.departamentoId));
  const s = q.toString();
  return `/asistencia-autorizaciones${s ? `?${s}` : ''}${extra || ''}`;
}

async function idsEmpleadosSesion(req, empresa) {
  if (!sessionSubsidiariaId(req) || !empresa) return null;
  const Empleado = await getEmpleadoModel();
  const q = scopeEmpleadosFromReq(req, empresa, { soloActivos: false });
  if (!q) return null;
  const rows = await Empleado.find(q).select('_id').lean();
  return rows.map((e) => e._id);
}

async function showHub(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const scope = await resolveAsistenciaScope(req);
  const rango = await resolverRangoAsistencia(req, empresa);

  const Empleado = await getEmpleadoModel();
  const DailyAttendance = await getDailyAttendanceModel();

  let pendientes = [];
  let pendientesCount = 0;
  let equipoResumen = { presentes: 0, retardos: 0, faltas: 0, incompletos: 0, total: 0 };
  let alertasHoy = { fueraZona: 0, excede12: 0, intentosRechazados: 0, excepciones: 0 };

  if (empresa && !error) {
    const idsSub = await idsEmpleadosSesion(req, empresa);
    const idsAlerta = idsParaConsulta(idsSub, scope);
    const pendienteOpts = scope.onlyEquipo
      ? {
          equipoIds: scope.equipoIds,
          supervisorId: scope.empleadoId || undefined,
          ...(idsSub ? { empleadoIds: idsSub } : {}),
          limit: 15
        }
      : { ...(idsSub ? { empleadoIds: idsSub } : {}), limit: 15 };
    pendientes = await listPendientes(req.session.tenantId, pendienteOpts);
    pendientesCount = await countPendientes(
      req.session.tenantId,
      scope.onlyEquipo
        ? {
            equipoIds: scope.equipoIds,
            supervisorId: scope.empleadoId || undefined,
            ...(idsSub ? { empleadoIds: idsSub } : {})
          }
        : idsSub
          ? { empleadoIds: idsSub }
          : {}
    );
    if (scope.onlyEquipo) {
      equipoResumen = await resumenEquipoHoy(
        req.session.tenantId,
        scope.equipoIds,
        rango.desdeUtc,
        rango.hastaUtc
      );
    }

    const dailyFilter = {
      tenantId: req.session.tenantId,
      fecha: { $gte: rango.desdeUtc, $lte: rango.hastaUtc }
    };
    if (Array.isArray(idsAlerta)) dailyFilter.empleadoId = { $in: idsAlerta };
    const [excede12, excepciones, intentos] = await Promise.all([
      DailyAttendance.countDocuments({ ...dailyFilter, excedeLimiteDiario: true }),
      DailyAttendance.countDocuments({
        ...dailyFilter,
        estatus: { $in: ['retardo', 'falta', 'incompleto', 'fuera_de_rango', 'registro_parcial'] }
      }),
      contarEnRango(req.session.tenantId, {
        empleadoIds: idsAlerta || undefined,
        desde: rango.desdeUtc,
        hasta: rango.hastaUtc
      })
    ]);
    alertasHoy.excede12 = excede12;
    alertasHoy.excepciones = excepciones;
    alertasHoy.intentosRechazados = intentos.rechazados;
    alertasHoy.fueraZona = intentos.fueraZona;
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
    fecha: rango.fechaHasta,
    rango,
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
  const { empresa, error } = await requireEmpresaForTenant(req);
  const scope = await resolveAsistenciaScope(req);
  const Empleado = await getEmpleadoModel();
  const filtrosDep = filtrosAutorizacion(req.query);
  const rango = await resolverRangoAsistencia(req, empresa);
  const filtros = {
    fechaDesde: rango.fechaDesde,
    fechaHasta: rango.fechaHasta,
    departamentoId: filtrosDep.departamentoId
  };
  const desde = rango.desdeUtc;
  const hasta = rango.hastaUtc;
  const modoRango = true;

  const Departamento = await getDepartamentoModel();
  const deptoQ = scopeDepartamentoFilter(req, empresa, { activo: true });
  const departamentos = deptoQ
    ? await Departamento.find(deptoQ).sort({ nombre: 1 }).select('nombre').lean()
    : [];
  const deptoOk = filtros.departamentoId
    && departamentos.some((d) => String(d._id) === String(filtros.departamentoId));

  let filas = [];
  let topeRango = false;
  if (empresa && !error) {
    let idsSub = await idsEmpleadosSesion(req, empresa);
    if (deptoOk) {
      const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: false }) || {
        tenantId: req.session.tenantId
      };
      const delDepto = await Empleado.find({ ...empQ, departamentoId: filtros.departamentoId })
        .select('_id')
        .lean();
      const allow = new Set(delDepto.map((e) => String(e._id)));
      idsSub = (idsSub || delDepto.map((e) => e._id)).filter((id) => allow.has(String(id)));
    }
    const idsConsulta = idsParaConsulta(idsSub, scope);
    if (modoRango && Array.isArray(idsConsulta) && idsConsulta.length) {
      await completarDescansosRango(
        req.session.tenantId,
        idsConsulta,
        filtros.fechaDesde,
        filtros.fechaHasta
      );
    }
    if (modoRango) {
      filas = await listRegistroYAutorizaciones(req.session.tenantId, {
        empleadoIds: idsConsulta || [],
        desde,
        hasta,
        limit: 400
      });
      topeRango = filas.length >= 400;
    } else {
      const pendientes = await listPendientes(
        req.session.tenantId,
        scope.onlyEquipo
          ? {
              equipoIds: scope.equipoIds,
              supervisorId: scope.empleadoId || undefined,
              ...(idsSub ? { empleadoIds: idsSub } : {}),
              limit: 100
            }
          : { ...(idsSub ? { empleadoIds: idsSub } : {}), limit: 100 }
      );
      filas = pendientes.map((auth) => ({
        fecha: auth.fecha,
        empleadoId: auth.empleadoId,
        daily: null,
        auth
      }));
    }
  }

  const empIds = [...new Set(filas.map((p) => String(p.empleadoId)))];
  const empleados = empIds.length
    ? await Empleado.find({ _id: { $in: empIds } })
        .select('firstName lastName numEmpleado departamentoId')
        .lean()
    : [];
  const empMap = new Map(
    empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`])
  );
  const deptoNombre = new Map(departamentos.map((d) => [String(d._id), d.nombre]));
  const faltanDepto = [...new Set(
    empleados
      .map((e) => (e.departamentoId ? String(e.departamentoId) : ''))
      .filter((id) => id && !deptoNombre.has(id))
  )];
  if (faltanDepto.length) {
    const extra = await Departamento.find({ _id: { $in: faltanDepto } }).select('nombre').lean();
    extra.forEach((d) => deptoNombre.set(String(d._id), d.nombre));
  }
  const deptoPorEmp = new Map(
    empleados.map((e) => [String(e._id), e.departamentoId ? deptoNombre.get(String(e.departamentoId)) || '—' : '—'])
  );

  let heMinutosParaAutorizar = 15;
  const subId = sessionSubsidiariaId(req);
  if (subId) {
    const getSubsidiariaModel = require('../models/subsidiaria');
    const Subsidiaria = await getSubsidiariaModel();
    const sub = await Subsidiaria.findById(subId).select('heMinutosParaAutorizar').lean();
    heMinutosParaAutorizar = heMinimosDe(sub?.heMinutosParaAutorizar);
  }
  filas.forEach((fila) => {
    fila.clasificacion = clasificarAutorizacion(fila.daily, heMinutosParaAutorizar);
  });

  res.render('Asistencia/autorizaciones', {
    empresa,
    error: error || null,
    session: req.session,
    scope,
    filas,
    modoRango,
    topeRango,
    empMap,
    deptoPorEmp,
    departamentos,
    filtros,
    rango,
    estatusLabels: ESTATUS_DIARIO,
    heMinutosParaAutorizar,
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
      return res.redirect(redirectAutorizaciones(req));
    }

    const { empresa } = await requireEmpresaForTenant(req);
    const actor = sessionActor(req);

    // Seguridad básica: supervisor solo su equipo o asignados a él
    if (scope.onlyEquipo) {
      const getAsistenciaAutorizacionModel = require('../models/asistenciaAutorizacion');
      const Aut = await getAsistenciaAutorizacionModel();
      const doc = await Aut.findOne({ _id: id, tenantId: req.session.tenantId }).lean();
      if (!doc) {
        req.flash('error', 'Solicitud no encontrada');
        return res.redirect(redirectAutorizaciones(req));
      }
      const inEquipo = scope.equipoIds.includes(String(doc.empleadoId));
      const assignedToMe = String(doc.supervisorId || '') === String(scope.empleadoId || '');
      if (!inEquipo && !assignedToMe) {
        req.flash('error', 'No puedes decidir sobre colaboradores fuera de tu equipo');
        return res.redirect(redirectAutorizaciones(req));
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
    res.redirect(redirectAutorizaciones(req));
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
    res.redirect(redirectAutorizaciones(req));
  }
}

async function autorizarDiaAction(req, res) {
  try {
    const scope = await resolveAsistenciaScope(req);
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'No hay empresa vinculada');
      return res.redirect(redirectAutorizaciones(req));
    }
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const ymd = trimString(req.body.fecha);
    const aprobar = trimString(req.body.decision) === 'aprobar';
    const motivo = trimString(req.body.motivoDecision);
    if (!empleadoId || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      req.flash('error', 'Indica el colaborador y el día');
      return res.redirect(redirectAutorizaciones(req));
    }
    if (!motivo) {
      req.flash('error', 'El motivo es obligatorio');
      return res.redirect(redirectAutorizaciones(req));
    }

    const idsSub = await idsEmpleadosSesion(req, empresa);
    const idsConsulta = idsParaConsulta(idsSub, scope);
    if (Array.isArray(idsConsulta) && !idsConsulta.some((id) => String(id) === String(empleadoId))) {
      req.flash('error', 'No puedes decidir sobre colaboradores fuera de tu equipo');
      return res.redirect(redirectAutorizaciones(req));
    }

    const actor = sessionActor(req);
    await autorizarDia({
      tenantId: req.session.tenantId,
      empleadoId,
      fecha: new Date(`${ymd}T12:00:00.000Z`),
      aprobar,
      motivoDecision: motivo,
      userId: actor.userId,
      decididoPorEmpleadoId: scope.empleadoId,
      empresaId: empresa._id
    });
    req.flash('success', aprobar ? 'Día autorizado' : 'Día rechazado');
    return res.redirect(redirectAutorizaciones(req));
  } catch (err) {
    console.error('[asistencia.autorizarDia]', err);
    const msg = {
      NOT_PENDING: 'Ese día ya fue decidido',
      DIA_NOT_FOUND: 'No hay registro de ese día',
      DIA_NO_REQUIERE: 'Ese día no requiere autorización',
      NOT_FOUND: 'Solicitud no encontrada'
    }[err.message] || 'Error al registrar la decisión';
    req.flash('error', msg);
    return res.redirect(redirectAutorizaciones(req));
  }
}

async function autorizarMasivaAction(req, res) {
  try {
    const scope = await resolveAsistenciaScope(req);
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'No hay empresa vinculada');
      return res.redirect(redirectAutorizaciones(req));
    }
    const motivo = trimString(req.body.motivoDecision);
    if (!motivo) {
      req.flash('error', 'El motivo es obligatorio para la autorización masiva');
      return res.redirect(redirectAutorizaciones(req));
    }
    const aprobar = trimString(req.body.decision) === 'aprobar';
    const filtros = filtrosAutorizacion(req.body);
    const rango = await resolverRangoAsistencia(req, empresa);
    const desde = filtros.fechaDesde
      ? new Date(`${filtros.fechaDesde}T00:00:00.000Z`)
      : rango.desdeUtc;
    const hasta = filtros.fechaHasta
      ? new Date(`${filtros.fechaHasta}T23:59:59.999Z`)
      : rango.hastaUtc;
    const Departamento = await getDepartamentoModel();
    const deptoQ = scopeDepartamentoFilter(req, empresa, { activo: true });
    const departamentos = deptoQ
      ? await Departamento.find(deptoQ).select('_id').lean()
      : [];
    const deptoOk = filtros.departamentoId
      && departamentos.some((d) => String(d._id) === String(filtros.departamentoId));
    let idsSub = await idsEmpleadosSesion(req, empresa);
    if (deptoOk) {
      const Empleado = await getEmpleadoModel();
      const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: false }) || {
        tenantId: req.session.tenantId
      };
      const delDepto = await Empleado.find({ ...empQ, departamentoId: filtros.departamentoId })
        .select('_id')
        .lean();
      const allow = new Set(delDepto.map((e) => String(e._id)));
      idsSub = (idsSub || delDepto.map((e) => e._id)).filter((id) => allow.has(String(id)));
    }
    const idsConsulta = idsParaConsulta(idsSub, scope);
    const filas = await listRegistroYAutorizaciones(req.session.tenantId, {
      empleadoIds: idsConsulta || [],
      desde,
      hasta,
      limit: 400
    });
    const actor = sessionActor(req);
    const { hechas, omitidas } = await autorizarDias(req.session.tenantId, filas, {
      aprobar,
      motivoDecision: motivo,
      userId: actor.userId,
      decididoPorEmpleadoId: scope.empleadoId,
      empresaId: empresa._id
    });
    req.flash(
      'success',
      `${aprobar ? 'Autorizados' : 'Rechazados'} ${hechas} día(s). ${omitidas} no requerían decisión o ya estaban resueltos.`
    );
    return res.redirect(redirectAutorizaciones(req));
  } catch (err) {
    console.error('[asistencia.autorizarMasiva]', err);
    req.flash('error', 'No se pudo aplicar la autorización masiva');
    return res.redirect(redirectAutorizaciones(req));
  }
}

async function showExcepcionTurno(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const scope = await resolveAsistenciaScope(req);
  const empleadoId = parseOptionalObjectId(req.params.empleadoId);
  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: false }) || {
    tenantId: req.session.tenantId
  };
  const empleado = empleadoId
    ? await Empleado.findOne({ ...empQ, _id: empleadoId }).select('firstName lastName numEmpleado').lean()
    : null;
  if (!empleado || (scope.onlyEquipo && !(scope.equipoIds || []).includes(String(empleadoId)))) {
    req.flash('error', 'No puedes solicitar la excepción para este colaborador');
    return res.redirect('/asistencia-autorizaciones');
  }
  const turnoQ = scopeTurnoFilter(req, empresa, { activo: true });
  const turnos = turnoQ
    ? await Turno.find(turnoQ).sort({ nombre: 1 }).lean()
    : [];
  const ctx = await contextoFecha(null, sessionSubsidiariaId(req));
  res.render('Asistencia/excepcion-turno', {
    empresa,
    error: error || null,
    session: req.session,
    empleado,
    turnos,
    fechaDefault: ctx.ymd,
    pasoActual: 3
  });
}

async function solicitarCambioTurnoAction(req, res) {
  const empleadoId = parseOptionalObjectId(req.body.empleadoId);
  const volver = empleadoId
    ? `/asistencia-autorizaciones/cambio-turno/${empleadoId}`
    : '/asistencia-autorizaciones';
  try {
    const scope = await resolveAsistenciaScope(req);
    const zona = await zonaDeSubsidiariaId(sessionSubsidiariaId(req));
    const fecha = parseDateTimeLocal(`${trimString(req.body.fecha)}T12:00`, zona);
    const turnoPropuestoId = parseOptionalObjectId(req.body.turnoPropuestoId);
    const esDescanso = trimString(req.body.esDescanso) === '1';
    const motivo = trimString(req.body.motivo);

    if (!empleadoId || !fecha) {
      req.flash('error', 'Empleado y fecha son obligatorios');
      return res.redirect(volver);
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
    res.redirect(volver);
  } catch (err) {
    console.error('[asistencia.cambioTurno]', err);
    req.flash('error', 'No se pudo registrar la solicitud');
    res.redirect(volver);
  }
}

module.exports = {
  showHub,
  listAutorizaciones,
  showExcepcionTurno,
  decidirAction,
  autorizarDiaAction,
  autorizarMasivaAction,
  solicitarCambioTurnoAction
};
