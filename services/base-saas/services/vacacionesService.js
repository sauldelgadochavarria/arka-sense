'use strict';

const getEmpleadoModel = require('../models/empleado');
const getVacacionSaldoModel = require('../models/vacacionSaldo');
const getVacacionSolicitudModel = require('../models/vacacionSolicitud');
const getIncidenciaModel = require('../models/incidencia');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getSubsidiariaModel = require('../models/subsidiaria');
const { diasVacacionesPorAntiguedad, calcularAniosServicio } = require('../config/vacacionesLFT');
const { startOfDay, DEFAULT_TZ } = require('../libs/timeHelpers');
const { contarDiasVacaciones } = require('./calendarioLaboralService');
const {
  notifySupervisorSolicitud,
  notifyEmpleadoResolucion
} = require('./vacacionNotificacionService');

async function resolveZonaHoraria(empleado) {
  if (!empleado?.subsidiariaId) return DEFAULT_TZ;
  const Subsidiaria = await getSubsidiariaModel();
  const sub = await Subsidiaria.findById(empleado.subsidiariaId).select('zonaHoraria').lean();
  return sub?.zonaHoraria || DEFAULT_TZ;
}

async function recalcularSaldoEmpleado(tenantId, empleadoId, anio = new Date().getFullYear()) {
  const Empleado = await getEmpleadoModel();
  const VacacionSaldo = await getVacacionSaldoModel();
  const VacacionSolicitud = await getVacacionSolicitudModel();
  const Incidencia = await getIncidenciaModel();

  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) return null;

  const anios = calcularAniosServicio(empleado.fechaIngreso);
  const diasCorresponden = diasVacacionesPorAntiguedad(anios);

  const inicioAnio = new Date(anio, 0, 1);
  const finAnio = new Date(anio, 11, 31, 23, 59, 59, 999);

  const [aprobadasSol, pendientesSol, vacInc] = await Promise.all([
    VacacionSolicitud.find({
      tenantId,
      empleadoId,
      status: 'APPROVED',
      anioSaldo: anio
    }).lean(),
    VacacionSolicitud.find({
      tenantId,
      empleadoId,
      status: 'PENDING',
      anioSaldo: anio
    }).lean(),
    Incidencia.find({
      tenantId,
      empleadoId,
      codigo: 'VAC',
      estatus: 'aprobada',
      fechaInicio: { $gte: inicioAnio, $lte: finAnio }
    }).lean()
  ]);

  // Preferir solicitudes; sumar incidencias VAC sin solicitud vinculada (legado)
  const solIds = new Set(
    aprobadasSol.map((s) => String(s.incidenciaId || '')).filter(Boolean)
  );
  const diasTomadosSol = aprobadasSol.reduce((sum, s) => sum + (s.diasSolicitados || 0), 0);
  const diasTomadosInc = vacInc
    .filter((i) => !solIds.has(String(i._id)))
    .reduce((sum, i) => sum + (i.diasAfectados || 1), 0);
  const diasTomados = diasTomadosSol + diasTomadosInc;
  const diasCongelados = pendientesSol.reduce((sum, s) => sum + (s.diasSolicitados || 0), 0);
  const diasPendientes = Math.max(0, diasCorresponden - diasTomados - diasCongelados);

  return VacacionSaldo.findOneAndUpdate(
    { tenantId, empleadoId, anio },
    {
      $set: {
        tenantId,
        empleadoId,
        anio,
        diasCorresponden,
        diasTomados,
        diasCongelados,
        diasPendientes,
        primaVacacionalPct: 25
      }
    },
    { upsert: true, new: true }
  ).lean();
}

async function recalcularSaldosTenant(tenantId, anio = new Date().getFullYear()) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean();
  const results = [];
  for (const e of empleados) {
    results.push(await recalcularSaldoEmpleado(tenantId, e._id, anio));
  }
  return results;
}

/** @deprecated usar contarDiasVacaciones — mantiene compat portal incidencias */
function calcularDiasSolicitud(fechaInicio, fechaFin) {
  const start = startOfDay(fechaInicio);
  const end = startOfDay(fechaFin);
  if (end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

async function obtenerSaldoDisponible(tenantId, empleadoId, anio) {
  const VacacionSaldo = await getVacacionSaldoModel();
  let saldo = await VacacionSaldo.findOne({ tenantId, empleadoId, anio }).lean();
  if (!saldo) saldo = await recalcularSaldoEmpleado(tenantId, empleadoId, anio);
  return saldo;
}

async function haySolapamiento({ tenantId, empleadoId, fechaInicio, fechaFin, excludeId = null }) {
  const VacacionSolicitud = await getVacacionSolicitudModel();
  const q = {
    tenantId,
    empleadoId,
    status: { $in: ['PENDING', 'APPROVED'] },
    fechaInicio: { $lte: startOfDay(fechaFin) },
    fechaFin: { $gte: startOfDay(fechaInicio) }
  };
  if (excludeId) q._id = { $ne: excludeId };
  return VacacionSolicitud.findOne(q).lean();
}

async function crearSolicitudVacaciones({
  tenantId,
  empleado,
  fechaInicio,
  fechaFin,
  motivo = '',
  userId = ''
}) {
  const inicio = startOfDay(fechaInicio);
  const fin = startOfDay(fechaFin);
  if (!inicio || !fin || fin < inicio) {
    const err = new Error('Rango de fechas inválido');
    err.status = 400;
    err.code = 'INVALID_RANGE';
    throw err;
  }
  const hoy = startOfDay(new Date());
  if (inicio < hoy) {
    const err = new Error('No se pueden solicitar vacaciones en fechas pasadas');
    err.status = 400;
    err.code = 'PAST_DATE';
    throw err;
  }

  const overlap = await haySolapamiento({
    tenantId,
    empleadoId: empleado._id,
    fechaInicio: inicio,
    fechaFin: fin
  });
  if (overlap) {
    const err = new Error('Ya tienes una solicitud pendiente o aprobada en ese rango');
    err.status = 409;
    err.code = 'OVERLAP';
    throw err;
  }

  const tz = await resolveZonaHoraria(empleado);
  let turno = null;
  if (empleado.turnoId) {
    try {
      const getTurnoModel = require('../models/turno');
      const Turno = await getTurnoModel();
      turno = await Turno.findById(empleado.turnoId).select('diasLaborables descansaSabado descansaDomingo').lean();
    } catch (_) {
      /* ignore */
    }
  }
  const { dias, detalle } = await contarDiasVacaciones({
    tenantId,
    empresaId: empleado.empresaId || null,
    subsidiariaId: empleado.subsidiariaId || null,
    fechaInicio: inicio,
    fechaFin: fin,
    timeZone: tz,
    turno
  });
  if (dias < 1) {
    const err = new Error('El rango no incluye días laborables descontables');
    err.status = 400;
    err.code = 'NO_WORKING_DAYS';
    throw err;
  }

  const anio = inicio.getFullYear();
  const saldo = await obtenerSaldoDisponible(tenantId, empleado._id, anio);
  const disponibles = saldo?.diasPendientes ?? 0;
  if (dias > disponibles) {
    const err = new Error(
      `Solo tienes ${disponibles} día(s) disponibles; solicitaste ${dias}`
    );
    err.status = 400;
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  const VacacionSolicitud = await getVacacionSolicitudModel();
  const doc = await VacacionSolicitud.create({
    tenantId,
    empleadoId: empleado._id,
    subsidiariaId: empleado.subsidiariaId || null,
    supervisorId: empleado.supervisorId || null,
    fechaInicio: inicio,
    fechaFin: fin,
    diasSolicitados: dias,
    diasDetalle: detalle,
    anioSaldo: anio,
    motivo: String(motivo || '').trim().slice(0, 500),
    status: 'PENDING',
    solicitadoPorUserId: userId || ''
  });

  await recalcularSaldoEmpleado(tenantId, empleado._id, anio);

  let supervisor = null;
  if (empleado.supervisorId) {
    const Empleado = await getEmpleadoModel();
    supervisor = await Empleado.findById(empleado.supervisorId).lean();
  }
  const plain = doc.toObject ? doc.toObject() : doc;
  await notifySupervisorSolicitud({
    solicitud: plain,
    empleado,
    supervisor
  }).catch(() => {});

  return plain;
}

async function cancelarSolicitud({ tenantId, empleadoId, solicitudId, userId = '' }) {
  const VacacionSolicitud = await getVacacionSolicitudModel();
  const doc = await VacacionSolicitud.findOne({
    _id: solicitudId,
    tenantId,
    empleadoId
  });
  if (!doc) {
    const err = new Error('Solicitud no encontrada');
    err.status = 404;
    throw err;
  }
  if (doc.status === 'CANCELLED' || doc.status === 'REJECTED') {
    const err = new Error('La solicitud ya no se puede cancelar');
    err.status = 400;
    throw err;
  }
  const hoy = startOfDay(new Date());
  if (doc.status === 'APPROVED' && startOfDay(doc.fechaInicio) <= hoy) {
    const err = new Error('No puedes cancelar vacaciones ya iniciadas');
    err.status = 400;
    err.code = 'ALREADY_STARTED';
    throw err;
  }

  const prev = doc.status;
  doc.status = 'CANCELLED';
  doc.resueltoPorUserId = userId;
  doc.fechaResolucion = new Date();
  await doc.save();

  if (prev === 'APPROVED' && doc.incidenciaId) {
    const Incidencia = await getIncidenciaModel();
    await Incidencia.updateOne(
      { _id: doc.incidenciaId },
      { $set: { estatus: 'cancelada', notasResolucion: 'Cancelada por el empleado', fechaResolucion: new Date() } }
    );
  }

  await recalcularSaldoEmpleado(tenantId, empleadoId, doc.anioSaldo);
  return doc.toObject();
}

async function resolverSolicitud({
  tenantId,
  solicitudId,
  status,
  userId = '',
  motivoRechazo = '',
  actorEmpleadoId = null,
  allowRrhh = false
}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    const err = new Error('Estado de resolución inválido');
    err.status = 400;
    throw err;
  }

  const VacacionSolicitud = await getVacacionSolicitudModel();
  const Empleado = await getEmpleadoModel();
  const doc = await VacacionSolicitud.findOne({ _id: solicitudId, tenantId });
  if (!doc) {
    const err = new Error('Solicitud no encontrada');
    err.status = 404;
    throw err;
  }
  if (doc.status !== 'PENDING') {
    const err = new Error('Solo se pueden resolver solicitudes pendientes');
    err.status = 400;
    throw err;
  }

  const empleado = await Empleado.findOne({ _id: doc.empleadoId, tenantId }).lean();
  if (!empleado) {
    const err = new Error('Empleado no encontrado');
    err.status = 404;
    throw err;
  }

  if (!allowRrhh) {
    if (!actorEmpleadoId || String(doc.supervisorId || '') !== String(actorEmpleadoId)) {
      const err = new Error('No eres el supervisor de este empleado');
      err.status = 403;
      err.code = 'NOT_SUPERVISOR';
      throw err;
    }
  }

  doc.status = status;
  doc.resueltoPorUserId = userId;
  doc.fechaResolucion = new Date();
  if (status === 'REJECTED') {
    doc.motivoRechazo = String(motivoRechazo || '').trim().slice(0, 500);
  }

  if (status === 'APPROVED') {
    const incidencia = await asegurarIncidenciaVac({
      tenantId,
      empleado,
      solicitud: doc,
      userId
    });
    doc.incidenciaId = incidencia?._id || null;
  }

  await doc.save();
  await recalcularSaldoEmpleado(tenantId, doc.empleadoId, doc.anioSaldo);
  await notifyEmpleadoResolucion({ solicitud: doc, empleado, status }).catch(() => {});

  if (status === 'APPROVED') {
    try {
      const { recalculateDailyAttendance } = require('./attendanceProcessingService');
      const cursor = new Date(startOfDay(doc.fechaInicio));
      const fin = startOfDay(doc.fechaFin);
      while (cursor <= fin) {
        await recalculateDailyAttendance(tenantId, doc.empleadoId, cursor);
        cursor.setDate(cursor.getDate() + 1);
      }
    } catch (e) {
      console.warn('[vacaciones] recalc daily', e.message);
    }
  }

  return doc.toObject();
}

async function asegurarIncidenciaVac({ tenantId, empleado, solicitud, userId }) {
  const TipoIncidencia = await getTipoIncidenciaModel();
  const Incidencia = await getIncidenciaModel();
  let tipo = await TipoIncidencia.findOne({
    tenantId,
    clave: 'VAC',
    ...(empleado.empresaId ? { empresaId: empleado.empresaId } : {})
  }).lean();
  if (!tipo) {
    tipo = await TipoIncidencia.findOne({ tenantId, clave: 'VAC' }).lean();
  }

  return Incidencia.create({
    tenantId,
    empleadoId: empleado._id,
    tipoIncidenciaId: tipo?._id || null,
    codigo: 'VAC',
    fechaInicio: solicitud.fechaInicio,
    fechaFin: solicitud.fechaFin,
    diasAfectados: solicitud.diasSolicitados,
    motivo: solicitud.motivo || 'Vacaciones aprobadas',
    origen: 'solicitud_empleado',
    estatus: 'aprobada',
    solicitadoPorUserId: solicitud.solicitadoPorUserId || userId,
    resueltoPorUserId: userId,
    fechaResolucion: new Date(),
    notasResolucion: 'Aprobada (VacacionSolicitud)'
  });
}

async function listSolicitudesEmpleado(tenantId, empleadoId, { limit = 40 } = {}) {
  const VacacionSolicitud = await getVacacionSolicitudModel();
  return VacacionSolicitud.find({ tenantId, empleadoId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function listPendientesSupervisor(tenantId, supervisorEmpleadoId) {
  const VacacionSolicitud = await getVacacionSolicitudModel();
  return VacacionSolicitud.find({
    tenantId,
    supervisorId: supervisorEmpleadoId,
    status: 'PENDING'
  })
    .sort({ createdAt: 1 })
    .lean();
}

module.exports = {
  recalcularSaldoEmpleado,
  recalcularSaldosTenant,
  calcularDiasSolicitud,
  calcularAniosServicio,
  diasVacacionesPorAntiguedad,
  obtenerSaldoDisponible,
  crearSolicitudVacaciones,
  cancelarSolicitud,
  resolverSolicitud,
  listSolicitudesEmpleado,
  listPendientesSupervisor
};
