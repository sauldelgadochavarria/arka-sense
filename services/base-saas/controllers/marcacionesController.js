const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { TIPOS_MARCACION, METODOS_REGISTRO } = require('../config/asistencia');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');

function defaultFechaQuery(req) {
  return trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
}

async function listMarcaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const fechaStr = defaultFechaQuery(req);
  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());

  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const getDailyAttendanceModel = require('../models/dailyAttendance');
  const DailyAttendance = await getDailyAttendanceModel();
  const { ESTATUS_DIARIO } = require('../config/asistencia');

  const [empleados, turnos, marcaciones, diarios] = empresa
    ? await Promise.all([
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
        Turno.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean(),
        AttendanceRecord.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) }
        })
          .sort({ timestamp: -1 })
          .lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) }
        }).lean()
      ])
    : [[], [], [], []];

  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`]));
  const dailyMap = new Map(diarios.map((d) => [String(d.empleadoId), d]));

  res.render('Asistencia/marcaciones', {
    marcaciones,
    empleados,
    turnos,
    empMap,
    dailyMap,
    estatusDiarioLabels: ESTATUS_DIARIO,
    fecha: fechaStr,
    tiposMarcacion: TIPOS_MARCACION,
    metodosRegistro: METODOS_REGISTRO,
    formatTimeHHMM,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createMarcacion(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-marcaciones');
    }

    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const timestamp = parseDateTimeLocal(req.body.timestamp);
    const tipoMarcacion = trimString(req.body.tipoMarcacion);

    if (!empleadoId || !timestamp || !tipoMarcacion) {
      req.flash('error', 'Empleado, fecha/hora y tipo de marcación son obligatorios');
      return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
    }

    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({ _id: empleadoId, tenantId: req.session.tenantId, estatus: 'activo' }).lean();
    if (!empleado) {
      req.flash('error', 'Empleado no encontrado o inactivo');
      return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
    }

    const fecha = startOfDay(timestamp);
    const AttendanceRecord = await getAttendanceRecordModel();

    await AttendanceRecord.create({
      tenantId: req.session.tenantId,
      empleadoId,
      turnoId: empleado.turnoId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fecha,
      timestamp,
      tipoMarcacion,
      metodo: trimString(req.body.metodo) || 'manual',
      registradoPorUserId: req.session.userid || '',
      notas: trimString(req.body.notas),
      procesado: false
    });

    const daily = await recalculateDailyAttendance(req.session.tenantId, empleadoId, fecha);
    const { ESTATUS_DIARIO } = require('../config/asistencia');
    const estatusTxt = daily?.estatus
      ? ESTATUS_DIARIO[daily.estatus] || daily.estatus
      : 'sin resumen';

    let hint = '';
    if (daily?.estatus === 'incompleto') {
      hint = ' Falta registrar la salida (y comida si aplica) para que cuente como presente.';
    } else if (daily?.estatus === 'registro_parcial') {
      hint = ' Registro parcial: completa las checadas o resuelve la incidencia RP en pendientes.';
    } else if (daily?.estatus === 'fuera_de_rango') {
      hint = ' Fuera de rango: revisa incidencias FR pendientes.';
    } else if (!empleado.turnoId && daily?.estatus !== 'descanso') {
      hint = ' El empleado no tiene turno asignado; asígnalo para calificar bien la asistencia.';
    }

    req.flash(
      'success',
      `Marcación registrada. Asistencia del día: ${estatusTxt}.${hint} Ver en Asistencia diaria.`
    );
    res.redirect(`/asistencia-marcaciones?fecha=${fecha.toISOString().slice(0, 10)}`);
  } catch (err) {
    console.error('[marcaciones]', err);
    req.flash('error', 'Error al registrar marcación');
    res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
  }
}

module.exports = { listMarcaciones, createMarcacion };
