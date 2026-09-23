const getIncidenciaModel = require('../models/incidencia');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getTurnoModel = require('../models/turno');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getVacacionSaldoModel = require('../models/vacacionSaldo');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { ensureTiposIncidenciaForTenant } = require('../services/tiposIncidenciaService');
const { recalcularSaldoEmpleado, calcularDiasSolicitud } = require('../services/vacacionesService');
const { parseOptionalObjectId, trimString, parseDate, toDateInputValue } = require('../libs/formHelpers');
const { startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { ESTATUS_INCIDENCIA } = require('../config/incidenciasCatalog');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { getAsignacionActiva } = require('../services/turnoResolverService');
const getPlantillaRotacionModel = require('../models/plantillaRotacion');

async function portalHome(req, res) {
  const empleado = req.empleado;
  const Incidencia = await getIncidenciaModel();
  const pendientes = await Incidencia.countDocuments({
    tenantId: req.session.tenantId,
    empleadoId: empleado._id,
    estatus: 'pendiente'
  });

  res.render('Portal/index', { empleado, pendientes, session: req.session });
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
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
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
      const VacacionSaldo = await getVacacionSaldoModel();
      const anio = new Date(fechaInicio).getFullYear();
      let saldo = await VacacionSaldo.findOne({
        tenantId: req.session.tenantId,
        empleadoId: empleado._id,
        anio
      }).lean();
      if (!saldo) {
        saldo = await recalcularSaldoEmpleado(req.session.tenantId, empleado._id, anio);
      }
      if (saldo && dias > saldo.diasPendientes) {
        req.flash('error', `Solo tienes ${saldo.diasPendientes} día(s) de vacaciones disponibles`);
        return res.redirect('/portal/solicitudes/nueva');
      }
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
  const empleado = req.empleado;
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const VacacionSaldo = await getVacacionSaldoModel();

  let saldo = await VacacionSaldo.findOne({
    tenantId: req.session.tenantId,
    empleadoId: empleado._id,
    anio
  }).lean();

  if (!saldo) {
    saldo = await recalcularSaldoEmpleado(req.session.tenantId, empleado._id, anio);
  }

  const Incidencia = await getIncidenciaModel();
  const solicitudesVac = await Incidencia.find({
    tenantId: req.session.tenantId,
    empleadoId: empleado._id,
    codigo: 'VAC'
  })
    .sort({ fechaInicio: -1 })
    .lean();

  res.render('Portal/vacaciones', { empleado, saldo, anio, solicitudesVac, session: req.session });
}

module.exports = {
  portalHome,
  portalAsistencia,
  portalSolicitudes,
  portalNuevaSolicitud,
  portalCrearSolicitud,
  portalVacaciones
};
