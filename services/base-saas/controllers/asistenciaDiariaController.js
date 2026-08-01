const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { recalculateDayForTenant } = require('../services/attendanceProcessingService');

function defaultFechaQuery(req) {
  return trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
}

async function listDiaria(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const fechaStr = defaultFechaQuery(req);
  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());

  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const DailyAttendance = await getDailyAttendanceModel();

  const [empleados, turnos, resumenes] = empresa
    ? await Promise.all([
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
        Turno.find({ tenantId: req.session.tenantId }).lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) }
        }).lean()
      ])
    : [[], [], []];

  const turnoMap = new Map(turnos.map((t) => [String(t._id), t.nombre]));
  const resumenMap = new Map(resumenes.map((r) => [String(r.empleadoId), r]));

  const filas = empleados.map((empleado) => {
    const resumen = resumenMap.get(String(empleado._id)) || null;
    return { empleado, resumen };
  });

  const stats = {
    total: filas.length,
    presentes: resumenes.filter((r) => r.estatus === 'presente').length,
    retardos: resumenes.filter((r) => r.estatus === 'retardo').length,
    faltas: resumenes.filter((r) => r.estatus === 'falta').length,
    incompletos: resumenes.filter((r) => r.estatus === 'incompleto').length,
    registroParcial: resumenes.filter((r) => r.estatus === 'registro_parcial').length,
    fueraDeRango: resumenes.filter((r) => r.estatus === 'fuera_de_rango').length,
    descanso: resumenes.filter((r) => r.estatus === 'descanso').length
  };

  res.render('Asistencia/diaria', {
    filas,
    fecha: fechaStr,
    stats,
    turnoMap,
    estatusLabels: ESTATUS_DIARIO,
    formatTimeHHMM,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function reprocesarDiaria(req, res) {
  try {
    const fechaStr = defaultFechaQuery(req);
    const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());
    await recalculateDayForTenant(req.session.tenantId, fecha);
    req.flash('success', 'Asistencia del día reprocesada para todos los empleados activos');
    res.redirect(`/asistencia-diaria?fecha=${fechaStr}`);
  } catch (err) {
    console.error('[asistencia-diaria]', err);
    req.flash('error', 'Error al reprocesar la asistencia');
    res.redirect(`/asistencia-diaria?fecha=${defaultFechaQuery(req)}`);
  }
}

module.exports = { listDiaria, reprocesarDiaria };
