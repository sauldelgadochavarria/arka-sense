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

async function listPendientes(
  tenantId,
  { supervisorId = null, equipoIds = null, empleadoIds = null, desde = null, hasta = null, limit = 80 } = {}
) {
  if (Array.isArray(empleadoIds) && !empleadoIds.length) return [];
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const q = { tenantId, estado: 'pendiente' };
  if (desde || hasta) {
    q.fecha = {};
    if (desde) q.fecha.$gte = new Date(desde);
    if (hasta) q.fecha.$lte = new Date(hasta);
  }
  if (Array.isArray(empleadoIds)) q.empleadoId = { $in: empleadoIds };
  const or = [];
  if (supervisorId) or.push({ supervisorId });
  if (Array.isArray(equipoIds) && equipoIds.length) {
    or.push({ empleadoId: { $in: equipoIds } });
  }
  if (or.length === 1 && !q.empleadoId) Object.assign(q, or[0]);
  else if (or.length) q.$or = or;
  return AsistenciaAutorizacion.find(q).sort({ fecha: -1, createdAt: -1 }).limit(limit).lean();
}

async function countPendientes(tenantId, opts = {}) {
  if (Array.isArray(opts.empleadoIds) && !opts.empleadoIds.length) return 0;
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const q = { tenantId, estado: 'pendiente' };
  if (Array.isArray(opts.empleadoIds)) q.empleadoId = { $in: opts.empleadoIds };
  const or = [];
  if (opts.supervisorId) or.push({ supervisorId: opts.supervisorId });
  if (Array.isArray(opts.equipoIds) && opts.equipoIds.length) {
    or.push({ empleadoId: { $in: opts.equipoIds } });
  }
  if (or.length === 1 && !q.empleadoId) Object.assign(q, or[0]);
  else if (or.length) q.$or = or;
  return AsistenciaAutorizacion.countDocuments(q);
}

function claveDia(empleadoId, fecha) {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return `${empleadoId}|`;
  return `${empleadoId}|${d.toISOString().slice(0, 10)}`;
}

/**
 * Registros del día en el rango, con la solicitud de autorización si existe.
 * La fecha guardada es medianoche UTC del día laboral.
 */
async function listRegistroYAutorizaciones(tenantId, { empleadoIds = null, desde = null, hasta = null, limit = 400 } = {}) {
  if (!Array.isArray(empleadoIds) || !empleadoIds.length || (!desde && !hasta)) return [];
  const DailyAttendance = await getDailyAttendanceModel();
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const fecha = {};
  if (desde) fecha.$gte = new Date(desde);
  if (hasta) fecha.$lte = new Date(hasta);
  const q = { tenantId, empleadoId: { $in: empleadoIds }, fecha };
  const [dailies, auths] = await Promise.all([
    DailyAttendance.find(q).sort({ fecha: -1 }).limit(limit).lean(),
    AsistenciaAutorizacion.find(q).sort({ fecha: -1 }).limit(limit).lean()
  ]);
  const dailyPorDia = new Map(dailies.map((d) => [claveDia(d.empleadoId, d.fecha), d]));
  const diasConSolicitud = new Set();
  const filas = [];
  auths.forEach((auth) => {
    const clave = claveDia(auth.empleadoId, auth.fecha);
    diasConSolicitud.add(clave);
    filas.push({
      fecha: auth.fecha,
      empleadoId: auth.empleadoId,
      daily: dailyPorDia.get(clave) || null,
      auth
    });
  });
  dailies.forEach((daily) => {
    const clave = claveDia(daily.empleadoId, daily.fecha);
    if (diasConSolicitud.has(clave)) return;
    filas.push({ fecha: daily.fecha, empleadoId: daily.empleadoId, daily, auth: null });
  });
  filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return filas.slice(0, limit);
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

  if (doc.dailyAttendanceId) {
    const DailyAttendance = await getDailyAttendanceModel();
    const daily = await DailyAttendance.findOne({ _id: doc.dailyAttendanceId, tenantId })
      .select('notas')
      .lean();
    const marca = aprobar
      ? `Autorizado (${doc.motivoDecision})`
      : `Rechazado (${doc.motivoDecision})`;
    const notas = [daily?.notas, marca].filter(Boolean).join(' · ').slice(0, 500);
    await DailyAttendance.updateOne(
      { _id: doc.dailyAttendanceId, tenantId },
      { $set: { notas } }
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

function heMinimosDe(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) return 15;
  return Math.min(180, Math.round(n));
}

/**
 * Separa lo que se autoriza de lo que solo se anota.
 * Horas extra bajo el mínimo de la subsidiaria, y la checada fuera del horario, son nota.
 */
function clasificarAutorizacion(daily, heMinutos = 15) {
  const minimo = heMinimosDe(heMinutos);
  if (!daily) {
    return { requiere: false, tipo: null, observacion: '' };
  }
  const he = Number(daily.minutosHorasExtra) || 0;
  const ret = Number(daily.minutosRetardo) || 0;
  const fuera = daily.estatus === 'fuera_de_rango' || daily.marcajesFueraDeRango === true;
  const notas = [];
  let tipo = null;
  let requiere = false;

  if (fuera) {
    notas.push(
      ret > 0
        ? `Retardo por checada fuera de rango (${ret} min). Queda como nota.`
        : 'Checada fuera del horario del turno. Queda como nota.'
    );
  } else if (daily.estatus === 'retardo' || ret > 0) {
    tipo = 'retardo';
    requiere = true;
    notas.push(`Retardo: ${ret} min`);
  }

  if (he > 0 && he < minimo) {
    notas.push(`Horas extra: ${he} min. Bajo el mínimo de ${minimo} min; queda como nota.`);
  } else if (he >= minimo && he > 0) {
    if (!tipo) tipo = 'horas_extra';
    if (!fuera) requiere = true;
    notas.push(`Horas extra: ${he} min. Pide autorización (mínimo ${minimo} min).`);
  }

  const etiquetas = {
    falta: 'Falta',
    incompleto: 'Incompleto',
    registro_parcial: 'Registro parcial',
    anulada: 'Checada anulada'
  };
  if (!fuera && etiquetas[daily.estatus]) {
    requiere = true;
    if (!tipo) tipo = 'otro';
    notas.unshift(etiquetas[daily.estatus]);
  }

  if (fuera) {
    requiere = false;
    tipo = null;
  }

  return { requiere, tipo, observacion: notas.join(' ') };
}

function diaRequiereAutorizacion(daily, heMinutos = 15) {
  return clasificarAutorizacion(daily, heMinutos).requiere;
}

/**
 * Abre la solicitud del día (si no existe) y la decide en el mismo paso.
 */
async function autorizarDia({
  tenantId,
  empleadoId,
  fecha,
  aprobar,
  motivoDecision = '',
  userId = '',
  decididoPorEmpleadoId = null,
  empresaId = null
}) {
  const DailyAttendance = await getDailyAttendanceModel();
  const dia = startOfDay(fecha);
  const daily = await DailyAttendance.findOne({
    tenantId,
    empleadoId,
    fecha: { $gte: dia, $lte: endOfDay(fecha) }
  }).lean();
  if (!daily) throw new Error('DIA_NOT_FOUND');

  const Empleado = await getEmpleadoModel();
  const getSubsidiariaModel = require('../models/subsidiaria');
  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId })
    .select('supervisorId subsidiariaId')
    .lean();
  let heMinutos = 15;
  if (empleado?.subsidiariaId) {
    const Subsidiaria = await getSubsidiariaModel();
    const sub = await Subsidiaria.findById(empleado.subsidiariaId).select('heMinutosParaAutorizar').lean();
    heMinutos = heMinimosDe(sub?.heMinutosParaAutorizar);
  }
  const clase = clasificarAutorizacion(daily, heMinutos);
  if (!clase.requiere || !clase.tipo) throw new Error('DIA_NO_REQUIERE');
  const tipo = clase.tipo;
  const AsistenciaAutorizacion = await getAsistenciaAutorizacionModel();
  const fechaDia = startOfDay(daily.fecha);
  let doc = await AsistenciaAutorizacion.findOne({ tenantId, empleadoId, fecha: fechaDia, tipo });
  if (doc && doc.estado !== 'pendiente') throw new Error('NOT_PENDING');
  if (!doc) {
    doc = await AsistenciaAutorizacion.create({
      tenantId,
      empleadoId,
      supervisorId: empleado?.supervisorId || null,
      tipo,
      estado: 'pendiente',
      fecha: fechaDia,
      dailyAttendanceId: daily._id,
      minutosRetardo: Number(daily.minutosRetardo) || 0,
      minutosHE: Number(daily.minutosHorasExtra) || 0,
      motivoSolicitud: clase.observacion || `Registro ${daily.estatus || 'del día'}`,
      solicitadoPorUserId: userId,
      detalle: { estatus: daily.estatus || '', origen: 'listado' }
    });
  } else if (!doc.dailyAttendanceId) {
    doc.dailyAttendanceId = daily._id;
    await doc.save();
  }

  return decidirAutorizacion({
    tenantId,
    id: doc._id,
    aprobar,
    motivoDecision,
    userId,
    decididoPorEmpleadoId,
    empresaId
  });
}

async function autorizarDias(tenantId, filas, opts) {
  let hechas = 0;
  let omitidas = 0;
  for (const fila of filas || []) {
    if (!diaRequiereAutorizacion(fila.daily)) {
      omitidas += 1;
      continue;
    }
    if (fila.auth && fila.auth.estado !== 'pendiente') {
      omitidas += 1;
      continue;
    }
    try {
      await autorizarDia({
        tenantId,
        empleadoId: fila.empleadoId,
        fecha: fila.fecha,
        aprobar: opts.aprobar,
        motivoDecision: opts.motivoDecision,
        userId: opts.userId,
        decididoPorEmpleadoId: opts.decididoPorEmpleadoId,
        empresaId: opts.empresaId
      });
      hechas += 1;
    } catch (err) {
      if (err.message === 'NOT_PENDING' || err.message === 'DIA_NO_REQUIERE' || err.message === 'DIA_NOT_FOUND') {
        omitidas += 1;
        continue;
      }
      throw err;
    }
  }
  return { hechas, omitidas };
}

async function resumenEquipoHoy(tenantId, equipoIds, fecha = new Date(), hasta = null) {
  if (!equipoIds?.length) {
    return { presentes: 0, retardos: 0, faltas: 0, incompletos: 0, total: 0 };
  }
  const DailyAttendance = await getDailyAttendanceModel();
  const diarios = await DailyAttendance.find({
    tenantId,
    empleadoId: { $in: equipoIds },
    fecha: { $gte: new Date(fecha), $lte: hasta ? new Date(hasta) : endOfDay(fecha) }
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
  listRegistroYAutorizaciones,
  countPendientes,
  solicitarCambioTurno,
  decidirAutorizacion,
  autorizarDia,
  autorizarDias,
  clasificarAutorizacion,
  heMinimosDe,
  diaRequiereAutorizacion,
  resumenEquipoHoy
};
