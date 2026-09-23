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
const { listIntentos, listIntentosDeMarcacion } = require('../services/attendanceAttemptService');

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
  const empleadoFiltro = trimString(req.query.empleadoId) || '';
  const mostrarCaptura = trimString(req.query.nueva) === '1' || Boolean(empleadoFiltro);
  const empleadoPrefill = empleadoFiltro;
  const tipoPrefill = trimString(req.query.tipoMarcacion) || '';

  const Empleado = await getEmpleadoModel();
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
  if (empleadoFiltro) {
    const oid = parseOptionalObjectId(empleadoFiltro);
    if (oid) marcFilter.empleadoId = oid;
  }

  const [empleados, marcaciones, diarios, bitacora] = empresa
    ? await Promise.all([
        Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
        AttendanceRecord.find(marcFilter).sort({ timestamp: 1 }).lean(),
        DailyAttendance.find({
          tenantId: req.session.tenantId,
          fecha: { $gte: fecha, $lte: endOfDay(fecha) },
          ...(empleadoFiltro && parseOptionalObjectId(empleadoFiltro)
            ? { empleadoId: parseOptionalObjectId(empleadoFiltro) }
            : {})
        }).lean(),
        listAuditoriaAsistencia(req.session.tenantId, {
          ...(empleadoFiltro && parseOptionalObjectId(empleadoFiltro)
            ? { empleadoId: parseOptionalObjectId(empleadoFiltro) }
            : {}),
          fechaDesde: fecha,
          fechaHasta: endOfDay(fecha),
          limit: 60
        })
      ])
    : [[], [], [], []];

  const empMap = new Map(
    empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`])
  );
  const dailyMap = new Map(diarios.map((d) => [String(d.empleadoId), d]));

  // Contar checadas activas por empleado+tipo (detectar duplicados)
  const dupKeyCount = new Map();
  for (const m of marcaciones) {
    if (m.estado === 'anulada') continue;
    const k = `${m.empleadoId}|${m.tipoMarcacion}`;
    dupKeyCount.set(k, (dupKeyCount.get(k) || 0) + 1);
  }

  res.render('Asistencia/marcaciones', {
    marcaciones,
    empleados,
    empMap,
    dailyMap,
    bitacora,
    dupKeyCount,
    fecha: fechaStr,
    verAnuladas,
    empleadoFiltro,
    empleadoPrefill,
    tipoPrefill,
    mostrarCaptura,
    estatusDiarioLabels: ESTATUS_DIARIO,
    tiposMarcacion: TIPOS_MARCACION,
    metodosRegistro: METODOS_REGISTRO,
    formatTimeHHMM,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function showMarcacionDetalle(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const id = parseOptionalObjectId(req.params.id);
  if (!empresa || !id) {
    req.flash('error', error || 'Marcación no encontrada');
    return res.redirect('/asistencia-marcaciones');
  }

  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();
  const getDailyAttendanceModel = require('../models/dailyAttendance');
  const DailyAttendance = await getDailyAttendanceModel();
  const { ESTATUS_DIARIO } = require('../config/asistencia');

  const marcacion = await AttendanceRecord.findOne({
    _id: id,
    tenantId: req.session.tenantId
  }).lean();
  if (!marcacion) {
    req.flash('error', 'Marcación no encontrada');
    return res.redirect('/asistencia-marcaciones');
  }

  const [empleado, daily, intentos, bitacora] = await Promise.all([
    Empleado.findOne({ _id: marcacion.empleadoId, tenantId: req.session.tenantId }).lean(),
    DailyAttendance.findOne({
      tenantId: req.session.tenantId,
      empleadoId: marcacion.empleadoId,
      fecha: {
        $gte: startOfDay(marcacion.fecha),
        $lte: endOfDay(marcacion.fecha)
      }
    }).lean(),
    listIntentosDeMarcacion(req.session.tenantId, marcacion),
    listAuditoriaAsistencia(req.session.tenantId, {
      empleadoId: marcacion.empleadoId,
      fechaDesde: startOfDay(marcacion.fecha),
      fechaHasta: endOfDay(marcacion.fecha),
      limit: 40
    })
  ]);

  const fechaStr = marcacion.fecha
    ? new Date(marcacion.fecha).toISOString().slice(0, 10)
    : defaultFechaQuery(req);

  res.render('Asistencia/marcacion-detalle', {
    empresa,
    error: null,
    session: req.session,
    marcacion,
    empleado,
    daily,
    intentos,
    bitacora,
    fecha: fechaStr,
    estatusDiarioLabels: ESTATUS_DIARIO,
    formatTimeHHMM
  });
}

async function listIntentosDia(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const fechaStr = defaultFechaQuery(req);
  const fecha = startOfDay(parseDateTimeLocal(`${fechaStr}T12:00`) || new Date());
  const empleadoId = parseOptionalObjectId(req.query.empleadoId);

  const Empleado = await getEmpleadoModel();
  const empleados = empresa
    ? await Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' })
        .sort({ lastName: 1 })
        .lean()
    : [];
  const empMap = new Map(
    empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName} (${e.numEmpleado})`])
  );

  const intentos = empresa
    ? await listIntentos(req.session.tenantId, {
        empleadoId: empleadoId || undefined,
        fechaDesde: fecha,
        fechaHasta: endOfDay(fecha),
        limit: 300
      })
    : [];

  res.render('Asistencia/intentos', {
    empresa,
    error: error || null,
    session: req.session,
    fecha: fechaStr,
    empleadoId: empleadoId ? String(empleadoId) : '',
    empleados,
    empMap,
    intentos,
    formatTimeHHMM
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
    const tipoMarcacion = trimString(req.body.tipoMarcacion);
    const usarHoraServidor =
      req.body.usarHoraServidor === undefined ||
      req.body.usarHoraServidor === '1' ||
      req.body.usarHoraServidor === 'on' ||
      req.body.usarHoraServidor === true;
    const ahoraServidor = new Date();
    const timestampForm = parseDateTimeLocal(req.body.timestamp);
    const motivoHoraManual = trimString(req.body.motivoHoraManual);

    if (!empleadoId || !tipoMarcacion) {
      req.flash('error', 'Empleado y tipo de marcación son obligatorios');
      return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
    }

    let timestamp = usarHoraServidor ? ahoraServidor : timestampForm;
    if (!usarHoraServidor) {
      if (!timestampForm) {
        req.flash('error', 'Indica fecha/hora o marca «Usar hora del servidor»');
        return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
      }
      if (!motivoHoraManual) {
        req.flash('error', 'Motivo obligatorio al capturar hora distinta a la del servidor');
        return res.redirect(`/asistencia-marcaciones?fecha=${defaultFechaQuery(req)}`);
      }
      timestamp = timestampForm;
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
    const notasBase = trimString(req.body.notas);
    const notas = [
      notasBase,
      !usarHoraServidor ? `Hora manual (motivo: ${motivoHoraManual})` : ''
    ]
      .filter(Boolean)
      .join(' · ');

    const created = await AttendanceRecord.create({
      tenantId: req.session.tenantId,
      empleadoId,
      turnoId: empleado.turnoId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fecha,
      timestamp,
      timestampOriginal: timestamp,
      servidorRegisteredAt: ahoraServidor,
      tipoMarcacion,
      metodo: trimString(req.body.metodo) || 'manual',
      registradoPorUserId: actor.userId,
      notas,
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
      mensaje: `Marcación ${tipoMarcacion} registrada${usarHoraServidor ? ' (hora servidor)' : ' (hora manual)'}`,
      motivo: motivoHoraManual || '',
      despues: snapshotMarcacion(created.toObject ? created.toObject() : created),
      detalle: {
        usarHoraServidor,
        servidorRegisteredAt: ahoraServidor,
        timestampForm: timestampForm || null
      }
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
      `Marcación registrada. Asistencia del día: ${estatusTxt}.${hint}`
    );
    const ymd = fecha.toISOString().slice(0, 10);
    res.redirect(`/asistencia-marcaciones?fecha=${ymd}&empleadoId=${empleadoId}`);
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
    const horaAntes = antes.timestamp;

    if (timestamp) {
      doc.timestamp = timestamp;
      doc.fecha = startOfDay(timestamp);
    }
    if (tipoMarcacion) doc.tipoMarcacion = tipoMarcacion;
    // Conservar siempre la primera hora original (no pisar en ajustes sucesivos)
    if (!doc.timestampOriginal) {
      doc.timestampOriginal = antes.timestampOriginal || antes.timestamp || doc.timestamp;
    }
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
      mensaje: `Ajuste ${doc.tipoMarcacion}: ${formatTimeHHMM(horaAntes)} → ${formatTimeHHMM(doc.timestamp)}`,
      motivo,
      antes,
      despues: snapshotMarcacion(doc.toObject()),
      detalle: {
        horaAntes: horaAntes || null,
        horaDespues: doc.timestamp || null,
        tipoAntes: antes.tipoMarcacion,
        tipoDespues: doc.tipoMarcacion
      }
    });

    await recalculateDailyAttendance(req.session.tenantId, doc.empleadoId, doc.fecha);
    if (antes.fecha && String(antes.fecha) !== String(doc.fecha)) {
      await recalculateDailyAttendance(req.session.tenantId, doc.empleadoId, antes.fecha);
    }

    // Aviso si quedan otras checadas del mismo tipo (p. ej. otra salida más tarde)
    const AttendanceRecord2 = AttendanceRecord;
    const mismas = await AttendanceRecord2.find({
      tenantId: req.session.tenantId,
      empleadoId: doc.empleadoId,
      fecha: { $gte: startOfDay(doc.fecha), $lte: endOfDay(doc.fecha) },
      tipoMarcacion: doc.tipoMarcacion,
      _id: { $ne: doc._id },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .select('timestamp')
      .lean();

    let flash =
      `Marcación ajustada (${formatTimeHHMM(horaAntes)} → ${formatTimeHHMM(doc.timestamp)}). Motivo y bitácora registrados.`;
    if (mismas.length) {
      const horas = mismas.map((m) => formatTimeHHMM(m.timestamp)).join(', ');
      flash += ` Atención: hay ${mismas.length} ${doc.tipoMarcacion}(s) activa(s) más (${horas}). El día usa la última; anúlalas si no aplican.`;
    }

    req.flash('success', flash);
    res.redirect(
      `/asistencia-marcaciones?fecha=${doc.fecha.toISOString().slice(0, 10)}&empleadoId=${doc.empleadoId}`
    );
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
  showMarcacionDetalle,
  listIntentosDia,
  createMarcacion,
  ajustarMarcacion,
  anularMarcacion,
  borrarMarcacionBloqueado
};
