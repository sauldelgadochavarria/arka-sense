const getIncidenciaModel = require('../models/incidencia');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getTurnoModel = require('../models/turno');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { ensureTiposIncidenciaForTenant } = require('../services/tiposIncidenciaService');
const {
  calcularDiasSolicitud,
  crearSolicitudVacaciones,
  cancelarSolicitud,
  resolverSolicitud,
  listSolicitudesEmpleado,
  listPendientesSupervisor,
  obtenerSaldoDisponible
} = require('../services/vacacionesService');
const { contarDiasVacaciones } = require('../services/calendarioLaboralService');
const { parseOptionalObjectId, trimString, parseDate, toDateInputValue } = require('../libs/formHelpers');
const { startOfDay, endOfDay, formatTimeHHMM, DEFAULT_TZ } = require('../libs/timeHelpers');
const { ESTATUS_INCIDENCIA } = require('../config/incidenciasCatalog');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { getAsignacionActiva } = require('../services/turnoResolverService');
const getPlantillaRotacionModel = require('../models/plantillaRotacion');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { buildEmpleadoCapabilities } = require('../services/portalCapabilitiesService');
const VAC_STATUS_LABEL = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Cancelada'
};

async function portalHome(req, res) {
  const empleado = req.empleado;
  const flags = res.locals.featureFlags || req.session.featureFlags || {};
  const Incidencia = await getIncidenciaModel();
  const pendientes = await Incidencia.countDocuments({
    tenantId: req.session.tenantId,
    empleadoId: empleado._id,
    estatus: 'pendiente'
  });

  const capabilities = await buildEmpleadoCapabilities({
    tenantId: req.session.tenantId,
    empleado,
    featureFlags: flags
  });
  res.locals.capabilities = capabilities;
  req.session.capabilities = capabilities;

  res.render('Portal/index', {
    empleado,
    pendientes,
    vacPendientesEquipo: capabilities.pendientesAprobacionVacaciones,
    capabilities,
    featureFlags: flags,
    session: req.session
  });
}

async function portalAsistencia(req, res) {
  const empleado = req.empleado;
  const mes = trimString(req.query.mes) || new Date().toISOString().slice(0, 7);
  const diaSel = trimString(req.query.dia) || '';
  const [year, month] = mes.split('-').map(Number);
  const desde = new Date(year, month - 1, 1);
  const hasta = endOfDay(new Date(year, month, 0));

  const DailyAttendance = await getDailyAttendanceModel();
  const Turno = await getTurnoModel();
  const getAttendanceRecordModel = require('../models/attendanceRecord');
  const getAsistenciaAutorizacionModel = require('../models/asistenciaAutorizacion');
  const AttendanceRecord = await getAttendanceRecordModel();
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const { TIPOS_MARCACION, METODOS_REGISTRO } = require('../config/asistencia');

  const [resumenes, turno, asignacionRotacion, marcaciones, autorizaciones] = await Promise.all([
    DailyAttendance.find({
      tenantId: req.session.tenantId,
      empleadoId: empleado._id,
      fecha: { $gte: desde, $lte: hasta }
    })
      .sort({ fecha: 1 })
      .lean(),
    empleado.turnoId ? Turno.findById(empleado.turnoId).lean() : null,
    getAsignacionActiva(req.session.tenantId, empleado._id),
    AttendanceRecord.find({
      tenantId: req.session.tenantId,
      empleadoId: empleado._id,
      fecha: { $gte: desde, $lte: hasta },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .sort({ timestamp: 1 })
      .lean(),
    AsistenciaAutorizacion.find({
      tenantId: req.session.tenantId,
      empleadoId: empleado._id,
      fecha: { $gte: desde, $lte: hasta }
    })
      .sort({ fecha: -1, createdAt: -1 })
      .lean()
  ]);

  let rotacionLabel = null;
  if (asignacionRotacion) {
    const PlantillaRotacion = await getPlantillaRotacionModel();
    const plantilla = await PlantillaRotacion.findById(asignacionRotacion.plantillaRotacionId).lean();
    if (plantilla) {
      rotacionLabel = `${plantilla.nombre} (ancla ${new Date(asignacionRotacion.fechaAncla).toLocaleDateString('es-MX')})`;
    }
  }

  const authByFecha = new Map();
  for (const a of autorizaciones) {
    const k = startOfDay(a.fecha).toISOString().slice(0, 10);
    if (!authByFecha.has(k)) authByFecha.set(k, []);
    authByFecha.get(k).push(a);
  }

  const marcByFecha = new Map();
  for (const m of marcaciones) {
    const k = startOfDay(m.fecha).toISOString().slice(0, 10);
    if (!marcByFecha.has(k)) marcByFecha.set(k, []);
    marcByFecha.get(k).push(m);
  }

  const comidaChecada = Boolean(turno?.comidaChecada);
  const mostrarComida =
    comidaChecada || resumenes.some((r) => r.salidaComida || r.regresoComida);

  const tipoMarcacionLabel = Object.fromEntries(TIPOS_MARCACION.map((t) => [t.value, t.label]));
  const metodoLabel = Object.fromEntries(METODOS_REGISTRO.map((t) => [t.value, t.label]));
  const authEstadoLabel = {
    pendiente: 'Pendiente',
    aprobada: 'Aprobada',
    rechazada: 'Rechazada',
    cancelada: 'Cancelada'
  };
  const authTipoLabel = {
    retardo: 'Retardo',
    cambio_turno: 'Cambio de turno',
    fuera_zona: 'Fuera de zona',
    horas_extra: 'Horas extra',
    otro: 'Otro'
  };

  let diaDetalle = null;
  if (diaSel) {
    const diaDate = startOfDay(parseDate(diaSel) || new Date(`${diaSel}T12:00`));
    const ymd = diaDate.toISOString().slice(0, 10);
    diaDetalle = {
      ymd,
      label: diaDate.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      resumen: resumenes.find((r) => startOfDay(r.fecha).toISOString().slice(0, 10) === ymd) || null,
      marcaciones: marcByFecha.get(ymd) || [],
      autorizaciones: authByFecha.get(ymd) || []
    };
  }

  const stats = {
    presentes: resumenes.filter((r) => r.estatus === 'presente').length,
    retardos: resumenes.filter((r) => r.estatus === 'retardo').length,
    faltas: resumenes.filter((r) => r.estatus === 'falta').length,
    authPendientes: autorizaciones.filter((a) => a.estado === 'pendiente').length,
    authDecididas: autorizaciones.filter((a) => a.estado === 'aprobada' || a.estado === 'rechazada')
      .length
  };

  res.render('Portal/asistencia', {
    empleado,
    resumenes,
    turno,
    rotacionLabel,
    mes,
    diaSel,
    diaDetalle,
    authByFecha,
    mostrarComida,
    comidaChecada,
    autorizaciones,
    stats,
    tipoMarcacionLabel,
    metodoLabel,
    authEstadoLabel,
    authTipoLabel,
    formatTimeHHMM,
    estatusLabels: ESTATUS_DIARIO,
    session: req.session
  });
}

async function portalSolicitudes(req, res) {
  const empleado = req.empleado;
  const Incidencia = await getIncidenciaModel();
  const solicitudes = await Incidencia.find({
    tenantId: req.session.tenantId,
    empleadoId: empleado._id,
    origen: { $in: ['solicitud_empleado', 'automatica'] }
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.render('Portal/solicitudes', {
    empleado,
    solicitudes,
    estatusLabels: Object.fromEntries(ESTATUS_INCIDENCIA.map((e) => [e.value, e.label])),
    session: req.session
  });
}

async function portalNuevaSolicitud(req, res) {
  const { empresa } = await requireEmpresaForTenant(req);
  const tipos = empresa
    ? (await ensureTiposIncidenciaForTenant(req.session.tenantId, empresa._id)).filter(
        (t) => !t.esAutomatica && (t.requiereAprobacion || t.clave === 'FR')
      )
    : [];

  const fechaSugerida = trimString(req.query.fecha) || '';
  const tipoSugerido = trimString(req.query.tipo) || '';

  res.render('Portal/nueva-solicitud', {
    empleado: req.empleado,
    tipos,
    fechaSugerida,
    tipoSugerido,
    toDateInputValue,
    session: req.session
  });
}

async function portalCrearSolicitud(req, res) {
  try {
    const empleado = req.empleado;
    const tipoId = parseOptionalObjectId(req.body.tipoIncidenciaId);
    const fechaInicio = parseDate(req.body.fechaInicio);
    const fechaFin = parseDate(req.body.fechaFin) || fechaInicio;

    if (!tipoId || !fechaInicio) {
      req.flash('error', 'Tipo y fecha inicio son obligatorios');
      return res.redirect('/portal/solicitudes/nueva');
    }

    const TipoIncidencia = await getTipoIncidenciaModel();
    const tipo = await TipoIncidencia.findOne({ _id: tipoId, tenantId: req.session.tenantId }).lean();
    if (!tipo) {
      req.flash('error', 'Tipo de incidencia no válido');
      return res.redirect('/portal/solicitudes/nueva');
    }

    const dias = calcularDiasSolicitud(fechaInicio, fechaFin);

    if (tipo.clave === 'VAC') {
      // Flujo unificado: VacacionSolicitud + saldo congelado
      await crearSolicitudVacaciones({
        tenantId: req.session.tenantId,
        empleado,
        fechaInicio,
        fechaFin,
        motivo: trimString(req.body.motivo),
        userId: req.session.userid || ''
      });
      req.flash('success', 'Solicitud de vacaciones enviada (saldo reservado).');
      return res.redirect('/portal/vacaciones');
    }

    const Incidencia = await getIncidenciaModel();
    await Incidencia.create({
      tenantId: req.session.tenantId,
      empleadoId: empleado._id,
      tipoIncidenciaId: tipo._id,
      codigo: tipo.clave,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: startOfDay(fechaFin),
      diasAfectados: dias,
      motivo: trimString(req.body.motivo),
      documentoReferencia: trimString(req.body.documentoReferencia),
      origen: 'solicitud_empleado',
      estatus: 'pendiente',
      solicitadoPorUserId: req.session.userid || ''
    });

    req.flash('success', 'Solicitud enviada. Tu supervisor o RRHH la revisará.');
    res.redirect('/portal/solicitudes');
  } catch (err) {
    console.error('[portal]', err);
    req.flash('error', 'Error al enviar solicitud');
    res.redirect('/portal/solicitudes/nueva');
  }
}

async function portalVacaciones(req, res) {
  const flags = res.locals.featureFlags || req.session.featureFlags || {};
  if (!tenantHasFeature(flags, 'vacaciones')) {
    req.flash('error', 'El módulo de vacaciones no está activo para tu subsidiaria.');
    return res.redirect('/portal');
  }

  const empleado = req.empleado;
  const anio = Number(req.query.anio) || new Date().getFullYear();
  let saldo = await obtenerSaldoDisponible(req.session.tenantId, empleado._id, anio);
  const solicitudesVac = await listSolicitudesEmpleado(req.session.tenantId, empleado._id);

  res.render('Portal/vacaciones', {
    empleado,
    saldo,
    anio,
    solicitudesVac,
    vacStatusLabel: VAC_STATUS_LABEL,
    toDateInputValue,
    session: req.session
  });
}

async function portalSolicitarVacaciones(req, res) {
  const flags = res.locals.featureFlags || req.session.featureFlags || {};
  if (!tenantHasFeature(flags, 'vacaciones')) {
    req.flash('error', 'Vacaciones no disponibles');
    return res.redirect('/portal');
  }
  try {
    const fechaInicio = parseDate(req.body.fechaInicio);
    const fechaFin = parseDate(req.body.fechaFin) || fechaInicio;
    await crearSolicitudVacaciones({
      tenantId: req.session.tenantId,
      empleado: req.empleado,
      fechaInicio,
      fechaFin,
      motivo: trimString(req.body.motivo),
      userId: req.session.userid || ''
    });
    req.flash('success', 'Solicitud de vacaciones enviada. El saldo queda reservado hasta la resolución.');
    res.redirect('/portal/vacaciones');
  } catch (err) {
    console.error('[portal vacaciones]', err);
    req.flash('error', err.message || 'No se pudo solicitar');
    res.redirect('/portal/vacaciones');
  }
}

async function portalCancelarVacacion(req, res) {
  try {
    await cancelarSolicitud({
      tenantId: req.session.tenantId,
      empleadoId: req.empleado._id,
      solicitudId: req.params.id,
      userId: req.session.userid || ''
    });
    req.flash('success', 'Solicitud cancelada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo cancelar');
  }
  res.redirect('/portal/vacaciones');
}

async function portalPreviewDiasVacacion(req, res) {
  try {
    const fechaInicio = parseDate(req.query.inicio || req.query.fechaInicio);
    const fechaFin = parseDate(req.query.fin || req.query.fechaFin) || fechaInicio;
    if (!fechaInicio) return res.json({ ok: false, error: 'Fechas requeridas' });
    const emp = req.empleado;
    const { dias, detalle } = await contarDiasVacaciones({
      tenantId: req.session.tenantId,
      empresaId: emp.empresaId || null,
      subsidiariaId: emp.subsidiariaId || null,
      fechaInicio,
      fechaFin,
      timeZone: DEFAULT_TZ
    });
    return res.json({ ok: true, dias, detalle });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
}

async function portalAprobacionesVacaciones(req, res) {
  const flags = res.locals.featureFlags || req.session.featureFlags || {};
  if (!tenantHasFeature(flags, 'vacaciones')) {
    req.flash('error', 'Vacaciones no disponibles');
    return res.redirect('/portal');
  }
  const caps =
    res.locals.capabilities ||
    (await buildEmpleadoCapabilities({
      tenantId: req.session.tenantId,
      empleado: req.empleado,
      featureFlags: flags
    }));
  if (!caps.esSupervisor) {
    req.flash('error', 'No tienes subordinados asignados. RRHH debe marcar tu equipo con supervisor.');
    return res.redirect('/portal');
  }
  const pendientes = await listPendientesSupervisor(req.session.tenantId, req.empleado._id);
  const Empleado = await getEmpleadoModel();
  const ids = pendientes.map((p) => p.empleadoId);
  const emps = ids.length
    ? await Empleado.find({ _id: { $in: ids } })
        .select('firstName lastName numEmpleado')
        .lean()
    : [];
  const empMap = new Map(emps.map((e) => [String(e._id), e]));

  res.render('Portal/aprobaciones-vacaciones', {
    empleado: req.empleado,
    pendientes,
    empMap,
    vacStatusLabel: VAC_STATUS_LABEL,
    session: req.session
  });
}

async function portalResolverVacacion(req, res) {
  try {
    const status = String(req.body.status || '').toUpperCase();
    await resolverSolicitud({
      tenantId: req.session.tenantId,
      solicitudId: req.params.id,
      status,
      userId: req.session.userid || '',
      motivoRechazo: trimString(req.body.motivoRechazo),
      actorEmpleadoId: req.empleado._id,
      allowRrhh: false
    });
    req.flash('success', status === 'APPROVED' ? 'Vacaciones aprobadas' : 'Solicitud rechazada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo resolver');
  }
  res.redirect('/portal/aprobaciones-vacaciones');
}

async function portalRecibos(req, res) {
  const flags = res.locals.featureFlags || req.session.featureFlags || {};
  if (!tenantHasFeature(flags, 'recibos')) {
    req.flash('error', 'La consulta de recibos no está activa para tu subsidiaria.');
    return res.redirect('/portal');
  }
  const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
  const Historico = await getNominaHistoricoReciboModel();
  const rows = await Historico.find({
    tenantId: req.session.tenantId,
    empleadoId: req.empleado._id
  })
    .sort({ anio: -1, mes: -1, createdAt: -1 })
    .limit(36)
    .select('anio mes periodo totalPercepciones totalDeducciones netoPagar origen fechaCierre')
    .lean();

  const recibos = rows.map((r) => ({
    ...r,
    periodoLabel:
      r.periodo?.numeroPeriodo != null
        ? `${r.anio}-${String(r.mes).padStart(2, '0')} · P${r.periodo.numeroPeriodo}`
        : `${r.anio}-${String(r.mes).padStart(2, '0')}`,
    neto: r.netoPagar
  }));

  res.render('Portal/recibos', {
    empleado: req.empleado,
    recibos,
    session: req.session
  });
}

module.exports = {
  portalHome,
  portalAsistencia,
  portalSolicitudes,
  portalNuevaSolicitud,
  portalCrearSolicitud,
  portalVacaciones,
  portalSolicitarVacaciones,
  portalCancelarVacacion,
  portalPreviewDiasVacacion,
  portalAprobacionesVacaciones,
  portalResolverVacacion,
  portalRecibos
};
