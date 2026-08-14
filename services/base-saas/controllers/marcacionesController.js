'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, formatTimeHHMM } = require('../libs/timeHelpers');
const { TIPOS_MARCACION, METODOS_REGISTRO } = require('../config/asistencia');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');
const {
  snapshotMarcacion,
  registrarAuditoriaAsistencia,
  listAuditoriaAsistencia
} = require('../services/asistenciaAuditoriaService');

function defaultFechaQuery(req) {
  return trimString(req.query.fecha) || new Date().toISOString().slice(0, 10);
}

function sessionActor(req) {
  const userId = req.session.userid || req.session.userId || '';
  const userLabel =
    req.session.user || req.session.email || req.session.username || '';
  return { userId, userLabel };
}

function auditMeta(req) {
  return {
    ...sessionActor(req),
    ip: req.ip || '',
    userAgent: req.get('user-agent') || ''
  };
}

async function listMarcaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const fechaStr = defaultFechaQuery(req);
  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());
  const verAnuladas = trimString(req.query.anuladas) === '1';

  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const getDailyAttendanceModel = require('../models/dailyAttendance');
  const DailyAttendance = await getDailyAttendanceModel();
  const { ESTATUS_DIARIO } = require('../config/asistencia');

  const marcFilter = {
    tenantId: req.session.tenantId,
    fecha: { $gte: fecha, $lte: endOfDay(fecha) }
  };
  if (!verAnuladas) {
    marcFilter.$or = [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }];
  }

  const [empleados, turnos, marcaciones, diarios, bitacora] = empresa
    ? await Promise.all([
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
        Turno.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean(),
        AttendanceRecord.find(marcFilter).sort({ timestamp: -1 }).lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) }
        }).lean(),
        listAuditoriaAsistencia(req.session.tenantId, {
          fechaDesde: fecha,
          fechaHasta: endOfDay(fecha),
          limit: 40
        })
      ])
    : [[], [], [], [], []];

  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`]));
  const dailyMap = new Map(diarios.map((d) => [String(d.empleadoId), d]));

  res.render('Asistencia/marcaciones', {
    marcaciones,
    empleados,
    turnos,
    empMap,
    dailyMap,
    bitacora,
    verAnuladas,
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
    const empleado = await Empleado.findOne({
      _id: empleadoId,
      tenantId: req.session.tenantId,
      estatus: 'activo'
    }).lean();
    if (!empleado) {
      req.flash('error', 'Empleado no encontrado o inactivo');
      return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
    }

    const fecha = startOfDay(timestamp);
    const AttendanceRecord = await getAttendanceRecordModel();
    const actor = sessionActor(req);

    const created = await AttendanceRecord.create({
      tenantId: req.session.tenantId,
      empleadoId,
      turnoId: empleado.turnoId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fecha,
      timestamp,
      timestampOriginal: timestamp,
      tipoMarcacion,
      metodo: trimString(req.body.metodo) || 'manual',
      registradoPorUserId: actor.userId,
      notas: trimString(req.body.notas),
      procesado: false,
      origen: 'original',
      estado: 'activa'
    });

    await registrarAuditoriaAsistencia({
      tenantId: req.session.tenantId,
      accion: 'MARCACION_CREAR',
      entidadId: created._id,
      empleadoId,
      fechaJornada: fecha,
      ...auditMeta(req),
      mensaje: `Marcación ${tipoMarcacion} registrada`,
      despues: snapshotMarcacion(created.toObject ? created.toObject() : created)
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

/** Ajuste con motivo: conserva timestampOriginal y deja bitácora. */
async function ajustarMarcacion(req, res) {
  const fechaRedirect = defaultFechaQuery(req);
  try {
    const { error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-marcaciones');
    }

    const id = parseOptionalObjectId(req.params.id);
    const motivo = trimString(req.body.motivo);
    const timestamp = parseDateTimeLocal(req.body.timestamp);
    const tipoMarcacion = trimString(req.body.tipoMarcacion);

    if (!id || !motivo) {
      req.flash('error', 'El ajuste requiere motivo obligatorio');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }

    const AttendanceRecord = await getAttendanceRecordModel();
    const doc = await AttendanceRecord.findOne({ _id: id, tenantId: req.session.tenantId });
    if (!doc) {
      req.flash('error', 'Marcación no encontrada');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }
    if (doc.estado === 'anulada') {
      req.flash('error', 'No se puede ajustar una marcación anulada');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }

    const antes = snapshotMarcacion(doc.toObject());
    const actor = sessionActor(req);

    if (timestamp) {
      doc.timestamp = timestamp;
      doc.fecha = startOfDay(timestamp);
    }
    if (tipoMarcacion) doc.tipoMarcacion = tipoMarcacion;
    if (!doc.timestampOriginal) doc.timestampOriginal = antes.timestamp || doc.timestamp;
    doc.origen = 'ajuste';
    doc.motivoAjuste = motivo;
    doc.ajustadoPorUserId = actor.userId;
    doc.ajustadoEn = new Date();
    doc.notas = trimString(req.body.notas) || doc.notas;
    doc.procesado = false;
    await doc.save();

    await registrarAuditoriaAsistencia({
      tenantId: req.session.tenantId,
      accion: 'MARCACION_AJUSTAR',
      entidadId: doc._id,
      empleadoId: doc.empleadoId,
      fechaJornada: doc.fecha,
      ...auditMeta(req),
      mensaje: `Ajuste de marcación ${doc.tipoMarcacion}`,
      motivo,
      antes,
      despues: snapshotMarcacion(doc.toObject())
    });

    await recalculateDailyAttendance(req.session.tenantId, doc.empleadoId, doc.fecha);
    if (antes.fecha && String(antes.fecha) !== String(doc.fecha)) {
      await recalculateDailyAttendance(req.session.tenantId, doc.empleadoId, antes.fecha);
    }

    req.flash('success', 'Marcación ajustada. Quedó registrado el motivo en bitácora.');
    res.redirect(`/asistencia-marcaciones?fecha=${doc.fecha.toISOString().slice(0, 10)}`);
  } catch (err) {
    console.error('[marcaciones.ajustar]', err);
    req.flash('error', 'Error al ajustar marcación');
    res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
  }
}

/** Anulación lógica: no se borra el documento. */
async function anularMarcacion(req, res) {
  const fechaRedirect = defaultFechaQuery(req);
  try {
    const { error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/asistencia-marcaciones');
    }

    const id = parseOptionalObjectId(req.params.id);
    const motivo = trimString(req.body.motivo);
    if (!id || !motivo) {
      req.flash('error', 'La anulación requiere motivo obligatorio');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }

    const AttendanceRecord = await getAttendanceRecordModel();
    const doc = await AttendanceRecord.findOne({ _id: id, tenantId: req.session.tenantId });
    if (!doc) {
      req.flash('error', 'Marcación no encontrada');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }
    if (doc.estado === 'anulada') {
      req.flash('error', 'La marcación ya estaba anulada');
      return res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
    }

    const antes = snapshotMarcacion(doc.toObject());
    const actor = sessionActor(req);
    doc.estado = 'anulada';
    doc.motivoAnulacion = motivo;
    doc.anuladoPorUserId = actor.userId;
    doc.anuladoEn = new Date();
    doc.procesado = false;
    await doc.save();

    await registrarAuditoriaAsistencia({
      tenantId: req.session.tenantId,
      accion: 'MARCACION_ANULAR',
      entidadId: doc._id,
      empleadoId: doc.empleadoId,
      fechaJornada: doc.fecha,
      ...auditMeta(req),
      mensaje: `Anulación de marcación ${doc.tipoMarcacion}`,
      motivo,
      antes,
      despues: snapshotMarcacion(doc.toObject())
    });

    await recalculateDailyAttendance(req.session.tenantId, doc.empleadoId, doc.fecha);
    req.flash('success', 'Marcación anulada (conservada en historial). No se eliminó el registro.');
    res.redirect(`/asistencia-marcaciones?fecha=${doc.fecha.toISOString().slice(0, 10)}`);
  } catch (err) {
    console.error('[marcaciones.anular]', err);
    req.flash('error', 'Error al anular marcación');
    res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
  }
}

/** Política: borrado físico bloqueado. */
async function borrarMarcacionBloqueado(req, res) {
  const fechaRedirect = defaultFechaQuery(req);
  const id = parseOptionalObjectId(req.params.id);
  await registrarAuditoriaAsistencia({
    tenantId: req.session.tenantId,
    accion: 'MARCACION_BORRAR_BLOQUEADO',
    entidadId: id || '',
    ...auditMeta(req),
    mensaje: 'Intento de borrado físico de marcación bloqueado',
    detalle: { path: req.path }
  });
  req.flash(
    'error',
    'No se permite borrar marcaciones. Usa “Anular” con motivo para conservar evidencia (REJL).'
  );
  res.redirect(`/asistencia-marcaciones?fecha=${fechaRedirect}`);
}

module.exports = {
  listMarcaciones,
  createMarcacion,
  ajustarMarcacion,
  anularMarcacion,
  borrarMarcacionBloqueado
};
