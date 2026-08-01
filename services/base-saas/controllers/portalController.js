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
  const [year, month] = mes.split('-').map(Number);
  const desde = new Date(year, month - 1, 1);
  const hasta = endOfDay(new Date(year, month, 0));

  const DailyAttendance = await getDailyAttendanceModel();
  const Turno = await getTurnoModel();

  const [resumenes, turno, asignacionRotacion] = await Promise.all([
    DailyAttendance.find({
      tenantId: req.session.tenantId,
      empleadoId: empleado._id,
      fecha: { $gte: desde, $lte: hasta }
    })
      .sort({ fecha: 1 })
      .lean(),
    empleado.turnoId ? Turno.findById(empleado.turnoId).lean() : null,
    getAsignacionActiva(req.session.tenantId, empleado._id)
  ]);

  let rotacionLabel = null;
  if (asignacionRotacion) {
    const PlantillaRotacion = await getPlantillaRotacionModel();
    const plantilla = await PlantillaRotacion.findById(asignacionRotacion.plantillaRotacionId).lean();
    if (plantilla) {
      rotacionLabel = `${plantilla.nombre} (ancla ${new Date(asignacionRotacion.fechaAncla).toLocaleDateString('es-MX')})`;
    }
  }

  res.render('Portal/asistencia', {
    empleado,
    resumenes,
    turno,
    rotacionLabel,
    mes,
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
