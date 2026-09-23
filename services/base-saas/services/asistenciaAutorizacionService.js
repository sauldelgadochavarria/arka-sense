'use strict';

const getAsistenciaAutorizacionModel = require('../models/asistenciaAutorizacion');
const getOverrideTurnoModel = require('../models/overrideTurno');
const getEmpleadoModel = require('../models/empleado');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { registrarAuditoriaAsistencia } = require('./asistenciaAuditoriaService');

/**
 * Crea/actualiza pendiente de retardo a partir del daily (idempotente).
 */
async function syncRetardoDesdeDaily(tenantId, empleado, daily) {
  if (!daily || !empleado) return null;
  const minutosRetardo = Number(daily.minutosRetardo) || 0;
  const esRetardo = daily.estatus === 'retardo' || minutosRetardo > 0;
  if (!esRetardo) return null;

  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const fecha = startOfDay(daily.fecha);
  const existing = await AsistenciaAutorizacion.findOne({
    tenantId,
    empleadoId: empleado._id,
    fecha,
    tipo: 'retardo'
  });

  if (existing && existing.estado !== 'pendiente') {
    return existing;
  }

  const payload = {
    tenantId,
    empleadoId: empleado._id,
    supervisorId: empleado.supervisorId || null,
    tipo: 'retardo',
    estado: 'pendiente',
    fecha,
    dailyAttendanceId: daily._id || null,
    minutosRetardo,
    motivoSolicitud: `Retardo automático (${minutosRetardo} min)`,
    detalle: { estatus: daily.estatus, sincronizadoEn: new Date() }
  };

  if (existing) {
    Object.assign(existing, {
      minutosRetardo,
      dailyAttendanceId: daily._id || existing.dailyAttendanceId,
      supervisorId: empleado.supervisorId || existing.supervisorId,
      motivoSolicitud: payload.motivoSolicitud
    });
    await existing.save();
    return existing;
  }

  return AsistenciaAutorizacion.create(payload);
}

async function syncFueraZonaOpcional(tenantId, empleado, daily, marcacionGeo) {
  if (!marcacionGeo?.fueraDeZona || !empleado) return null;
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const fecha = startOfDay(daily?.fecha || new Date());
  try {
    return await AsistenciaAutorizacion.findOneAndUpdate(
      { tenantId, empleadoId: empleado._id, fecha, tipo: 'fuera_zona' },
      {
        $setOnInsert: {
          tenantId,
          empleadoId: empleado._id,
          supervisorId: empleado.supervisorId || null,
          tipo: 'fuera_zona',
          estado: 'pendiente',
          fecha,
          dailyAttendanceId: daily?._id || null,
          fueraDeZona: true,
          motivoSolicitud: 'Checado fuera de geocerca',
          detalle: { distanceMeters: marcacionGeo.distanceMeters || null }
        }
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }
}

async function listPendientes(tenantId, { supervisorId = null, equipoIds = null, limit = 80 } = {}) {
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const q = { tenantId, estado: 'pendiente' };
  const or = [];
  if (supervisorId) or.push({ supervisorId });
  if (Array.isArray(equipoIds) && equipoIds.length) {
    or.push({ empleadoId: { $in: equipoIds } });
  }
  if (or.length === 1) Object.assign(q, or[0]);
  else if (or.length > 1) q.$or = or;
  return AsistenciaAutorizacion.find(q).sort({ fecha: -1, createdAt: -1 }).limit(limit).lean();
}

async function countPendientes(tenantId, opts = {}) {
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const q = { tenantId, estado: 'pendiente' };
  const or = [];
  if (opts.supervisorId) or.push({ supervisorId: opts.supervisorId });
  if (Array.isArray(opts.equipoIds) && opts.equipoIds.length) {
    or.push({ empleadoId: { $in: opts.equipoIds } });
  }
  if (or.length === 1) Object.assign(q, or[0]);
  else if (or.length > 1) q.$or = or;
  return AsistenciaAutorizacion.countDocuments(q);
}

async function solicitarCambioTurno({
  tenantId,
  empleadoId,
  fecha,
  turnoPropuestoId = null,
  esDescansoPropuesto = false,
  motivo = '',
  userId = '',
  supervisorId = null
}) {
  const Empleado = await getEmpleadoModel();
  const emp = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!emp) throw new Error('EMPLEADO_NOT_FOUND');

  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const fechaDia = startOfDay(fecha);
  return AsistenciaAutorizacion.findOneAndUpdate(
    { tenantId, empleadoId, fecha: fechaDia, tipo: 'cambio_turno' },
    {
      $set: {
        tenantId,
        empleadoId,
        supervisorId: supervisorId || emp.supervisorId || null,
        tipo: 'cambio_turno',
        estado: 'pendiente',
        fecha: fechaDia,
        turnoPropuestoId,
        esDescansoPropuesto: Boolean(esDescansoPropuesto),
        motivoSolicitud: motivo || 'Solicitud de cambio / excepción de turno',
        solicitadoPorUserId: userId,
        motivoDecision: '',
        decididoPorUserId: '',
        decididoEn: null
      }
    },
    { upsert: true, new: true }
  );
}

async function decidirAutorizacion({
  tenantId,
  id,
  aprobar,
  motivoDecision = '',
  userId = '',
  decididoPorEmpleadoId = null,
  empresaId = null
}) {
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const doc = await AsistenciaAutorizacion.findOne({ _id: id, tenantId });
  if (!doc) throw new Error('NOT_FOUND');
  if (doc.estado !== 'pendiente') throw new Error('NOT_PENDING');

  doc.estado = aprobar ? 'aprobada' : 'rechazada';
  doc.motivoDecision = motivoDecision || (aprobar ? 'Aprobado' : 'Rechazado');
  doc.decididoPorUserId = userId;
  doc.decididoPorEmpleadoId = decididoPorEmpleadoId || null;
  doc.decididoEn = new Date();
  await doc.save();

  if (aprobar && doc.tipo === 'cambio_turno' && empresaId) {
    const OverrideTurno = await getOverrideTurnoModel();
    await OverrideTurno.findOneAndUpdate(
      { tenantId, empleadoId: doc.empleadoId, fecha: startOfDay(doc.fecha) },
      {
        $set: {
          tenantId,
          empresaId,
          empleadoId: doc.empleadoId,
          fecha: startOfDay(doc.fecha),
          turnoId: doc.esDescansoPropuesto ? null : doc.turnoPropuestoId,
          esDescanso: Boolean(doc.esDescansoPropuesto),
          motivo: doc.motivoSolicitud || doc.motivoDecision,
          creadoPorUserId: userId,
          activo: true
        }
      },
      { upsert: true }
    );
  }

  if (aprobar && doc.tipo === 'retardo' && doc.dailyAttendanceId) {
    const DailyAttendance = await getDailyAttendanceModel();
    await DailyAttendance.updateOne(
      { _id: doc.dailyAttendanceId, tenantId },
      {
        $set: {
          notas: `Retardo autorizado por supervisor (${doc.motivoDecision})`.slice(0, 500)
        }
      }
    );
  }

  await registrarAuditoriaAsistencia({
    tenantId,
    accion: aprobar ? 'AUTORIZACION_APROBAR' : 'AUTORIZACION_RECHAZAR',
    entidad: 'asistencia_autorizacion',
    entidadId: doc._id,
    empleadoId: doc.empleadoId,
    fechaJornada: doc.fecha,
    userId,
    mensaje: `${doc.tipo} ${doc.estado}`,
    motivo: doc.motivoDecision,
    despues: {
      tipo: doc.tipo,
      estado: doc.estado,
      minutosRetardo: doc.minutosRetardo
    }
  });

  return doc.toObject();
}

async function resumenEquipoHoy(tenantId, equipoIds, fecha = new Date()) {
  if (!equipoIds?.length) {
    return { presentes: 0, retardos: 0, faltas: 0, incompletos: 0, total: 0 };
  }
  const DailyAttendance = await getDailyAttendanceModel();
  const diarios = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: equipoIds },
    fecha: { $gte: startOfDay(fecha), $lte: endOfDay(fecha) }
  })
    .select('estatus')
    .lean();

  const resumen = { presentes: 0, retardos: 0, faltas: 0, incompletos: 0, total: diarios.length };
  for (const d of diarios) {
    if (d.estatus === 'presente') resumen.presentes += 1;
    else if (d.estatus === 'retardo') resumen.retardos += 1;
    else if (d.estatus === 'falta') resumen.faltas += 1;
    else resumen.incompletos += 1;
  }
  return resumen;
}

module.exports = {
  syncRetardoDesdeDaily,
  syncFueraZonaOpcional,
  listPendientes,
  countPendientes,
  solicitarCambioTurno,
  decidirAutorizacion,
  resumenEquipoHoy
};
