'use strict';

const getIncidenciaModel = require('../models/incidencia');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getEmpleadoModel = require('../models/empleado');
const getSubsidiariaModel = require('../models/subsidiaria');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const { ensureTiposIncidenciaForTenant } = require('./tiposIncidenciaService');
const { heMinimosDe } = require('./asistenciaAutorizacionService');
const { startOfDay } = require('../libs/timeHelpers');

const AUTO_CLAVES_DIA = ['FI', 'RP', 'FR', 'RET', 'SA', 'HEO', 'HED', 'HEF'];
const HE_CLAVES = ['HEO', 'HED', 'HEF'];
const HE_ETIQUETA = { HEO: 'ordinaria', HED: 'doble', HEF: 'triple' };

function minutosHeTotal(daily) {
  const raw = Number(daily?.minutosHorasExtra);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return (
    (Number(daily?.minutosHEOrdinaria) || 0) +
    (Number(daily?.minutosHEDoble) || 0) +
    (Number(daily?.minutosHETriple) || 0)
  );
}

async function minimoHeDeEmpleado(empleadoId) {
  const Empleado = await getEmpleadoModel();
  const emp = await Empleado.findById(empleadoId).select('subsidiariaId').lean();
  if (!emp?.subsidiariaId) return heMinimosDe(undefined);
  const Subsidiaria = await getSubsidiariaModel();
  const sub = await Subsidiaria.findById(emp.subsidiariaId).select('heMinutosParaAutorizar').lean();
  return heMinimosDe(sub?.heMinutosParaAutorizar);
}

function motivoAutomatico(clave, daily, dayStart, minimo) {
  const fecha = dayStart.toLocaleDateString('es-MX');
  if (HE_CLAVES.includes(clave)) {
    const min = minutosPorCodigo(clave, daily);
    return `Hora extra ${HE_ETIQUETA[clave]}: ${min} min el ${fecha}. Supera el mínimo de ${minimo} min de la subsidiaria.`;
  }
  if (clave === 'RET') {
    return `Retardo de ${minutosPorCodigo(clave, daily)} min el ${fecha}.`;
  }
  if (clave === 'SA') {
    return `Salida anticipada de ${minutosPorCodigo(clave, daily)} min el ${fecha}.`;
  }
  return `Generada automáticamente por asistencia del ${fecha}`;
}

function minutosPorCodigo(clave, daily) {
  switch (clave) {
    case 'RET':
      return daily.minutosRetardo || 0;
    case 'SA':
      return daily.minutosSalidaAnticipada || 0;
    case 'HEO':
      return daily.minutosHEOrdinaria ?? daily.minutosHorasExtra ?? 0;
    case 'HED':
      return daily.minutosHEDoble || 0;
    case 'HEF':
      return daily.minutosHETriple || 0;
    default:
      return 0;
  }
}

/**
 * Sincroniza incidencias automáticas del día con daily_attendance.
 * Crea/actualiza las de incidenciasAutomaticas y cancela las automáticas
 * del catálogo que ya no aplican (p. ej. FI cuando el día pasó a presente/retardo).
 */
async function syncAutomaticIncidencias(tenantId, empresaId, empleadoId, fecha, daily, syncCtx = null) {
  const TipoIncidencia = syncCtx?.tiposByClave ? null : await getTipoIncidenciaModel();
  if (!syncCtx?.tiposByClave) await ensureTiposIncidenciaForTenant(tenantId, empresaId);
  const Incidencia = await getIncidenciaModel();
  const dayStart = startOfDay(fecha);
  const activas = new Set(daily?.incidenciasAutomaticas || []);
  const minimo = syncCtx?.heMinimo != null ? syncCtx.heMinimo : await minimoHeDeEmpleado(empleadoId);
  const heTotal = minutosHeTotal(daily);
  if (heTotal < minimo) {
    for (const clave of HE_CLAVES) activas.delete(clave);
  }

  for (const clave of activas) {
    const tipo = syncCtx?.tiposByClave
      ? syncCtx.tiposByClave.get(clave) || null
      : await TipoIncidencia.findOne({ tenantId, clave, activo: true }).lean();
    if (!tipo) continue;

    const estatus = tipo.requiereAprobacion ? 'pendiente' : 'aprobada';
    const minutosAfectados = minutosPorCodigo(clave, daily);

    await Incidencia.updateOne(
      {
        tenantId,
        empleadoId,
        codigo: clave,
        fechaInicio: dayStart,
        origen: 'automatica'
      },
      {
        $set: {
          tenantId,
          empleadoId,
          tipoIncidenciaId: tipo._id,
          codigo: clave,
          fechaInicio: dayStart,
          fechaFin: dayStart,
          diasAfectados: ['FI', 'RP', 'FR'].includes(clave) ? 1 : 0,
          minutosAfectados,
          motivo: motivoAutomatico(clave, daily, dayStart, minimo),
          origen: 'automatica',
          estatus,
          dailyAttendanceId: daily?._id || null,
          fechaResolucion: estatus === 'aprobada' ? new Date() : undefined
        },
        $unset: { canceladaAt: 1 }
      },
      { upsert: true }
    );
  }

  // Cancelar automáticas del día que ya no están en incidenciasAutomaticas
  const stale = await Incidencia.find({
    tenantId,
    empleadoId,
    origen: 'automatica',
    fechaInicio: dayStart,
    codigo: { $in: AUTO_CLAVES_DIA.filter((c) => !activas.has(c)) },
    estatus: { $ne: 'rechazada' }
  }).lean();

  const enElDia = new Set(daily?.incidenciasAutomaticas || []);
  const heBajoMinimo = [];
  const otras = [];
  for (const s of stale) {
    if (HE_CLAVES.includes(s.codigo) && enElDia.has(s.codigo) && heTotal < minimo) {
      if (s.estatus === 'pendiente') heBajoMinimo.push(s._id);
      continue;
    }
    otras.push(s._id);
  }

  if (heBajoMinimo.length) {
    await Incidencia.updateMany(
      { _id: { $in: heBajoMinimo } },
      {
        $set: {
          estatus: 'rechazada',
          motivoRechazo: `Horas extra de ${heTotal} min, bajo el mínimo de ${minimo} min de la subsidiaria. Queda como nota y no pide autorización.`,
          fechaResolucion: new Date()
        }
      }
    );
  }
  if (otras.length) {
    await Incidencia.updateMany(
      { _id: { $in: otras } },
      {
        $set: {
          estatus: 'rechazada',
          motivoRechazo: 'Cancelada: la asistencia del día ya no genera esta incidencia',
          fechaResolucion: new Date()
        }
      }
    );
  }
}

/**
 * Cierra HED/HEO/HEF pendientes que quedaron bajo el mínimo de la subsidiaria
 * y reescribe el motivo de las que sí lo superan.
 */
async function cerrarHePendientesBajoMinimo() {
  const Incidencia = await getIncidenciaModel();
  const DailyAttendance = await getDailyAttendanceModel();
  const pendientes = await Incidencia.find({
    origen: 'automatica',
    estatus: 'pendiente',
    codigo: { $in: HE_CLAVES }
  }).lean();

  let cerradas = 0;
  let actualizadas = 0;
  for (const inc of pendientes) {
    const minimo = await minimoHeDeEmpleado(inc.empleadoId);
    const daily = inc.dailyAttendanceId
      ? await DailyAttendance.findById(inc.dailyAttendanceId).lean()
      : null;
    const heTotal = daily ? minutosHeTotal(daily) : Number(inc.minutosAfectados) || 0;
    if (heTotal < minimo) {
      await Incidencia.updateOne(
        { _id: inc._id },
        {
          $set: {
            estatus: 'rechazada',
            motivoRechazo: `Horas extra de ${heTotal} min, bajo el mínimo de ${minimo} min de la subsidiaria. Queda como nota y no pide autorización.`,
            fechaResolucion: new Date()
          }
        }
      );
      cerradas += 1;
      continue;
    }
    const minClave = daily ? minutosPorCodigo(inc.codigo, daily) : Number(inc.minutosAfectados) || 0;
    await Incidencia.updateOne(
      { _id: inc._id },
      {
        $set: {
          minutosAfectados: minClave,
          motivo: `Hora extra ${HE_ETIQUETA[inc.codigo] || inc.codigo}: ${minClave} min el ${new Date(inc.fechaInicio).toLocaleDateString('es-MX')}. Supera el mínimo de ${minimo} min de la subsidiaria.`
        }
      }
    );
    actualizadas += 1;
  }
  return { revisadas: pendientes.length, cerradas, actualizadas };
}

/**
 * Misma regla que syncAutomaticIncidencias, en un solo lote del día.
 * items: [{ empleadoId, daily, heMinimo }]
 */
async function syncAutomaticIncidenciasLote(tenantId, empresaId, items, syncCtx) {
  if (!items?.length || !syncCtx?.tiposByClave) return;
  const Incidencia = await getIncidenciaModel();
  const dayStart = startOfDay(items[0].daily?.fecha || new Date());
  const ids = items.map((item) => item.empleadoId).filter(Boolean);
  const existentes = await Incidencia.find({
    tenantId,
    empleadoId: { $in: ids },
    origen: 'automatica',
    fechaInicio: dayStart,
    codigo: { $in: AUTO_CLAVES_DIA },
    estatus: { $ne: 'rechazada' }
  })
    .select('empleadoId codigo estatus')
    .lean();
  const porEmpleado = new Map();
  for (const row of existentes) {
    const key = String(row.empleadoId);
    if (!porEmpleado.has(key)) porEmpleado.set(key, []);
    porEmpleado.get(key).push(row);
  }

  const ops = [];
  const rechazarBajo = [];
  const rechazarOtras = [];
  for (const item of items) {
    const daily = item.daily || {};
    const minimo = item.heMinimo;
    const activas = new Set(daily.incidenciasAutomaticas || []);
    const enElDia = new Set(daily.incidenciasAutomaticas || []);
    const heTotal = minutosHeTotal(daily);
    if (heTotal < minimo) {
      for (const clave of HE_CLAVES) activas.delete(clave);
    }
    for (const clave of activas) {
      const tipo = syncCtx.tiposByClave.get(clave);
      if (!tipo) continue;
      const estatus = tipo.requiereAprobacion ? 'pendiente' : 'aprobada';
      const minutosAfectados = minutosPorCodigo(clave, daily);
      const set = {
        tenantId,
        empleadoId: item.empleadoId,
        tipoIncidenciaId: tipo._id,
        codigo: clave,
        fechaInicio: dayStart,
        fechaFin: dayStart,
        diasAfectados: ['FI', 'RP', 'FR'].includes(clave) ? 1 : 0,
        minutosAfectados,
        motivo: motivoAutomatico(clave, daily, dayStart, minimo),
        origen: 'automatica',
        estatus,
        dailyAttendanceId: daily._id || null
      };
      if (estatus === 'aprobada') set.fechaResolucion = new Date();
      ops.push({
        updateOne: {
          filter: {
            tenantId,
            empleadoId: item.empleadoId,
            codigo: clave,
            fechaInicio: dayStart,
            origen: 'automatica'
          },
          update: { $set: set, $unset: { canceladaAt: 1 } },
          upsert: true
        }
      });
    }
    for (const stale of porEmpleado.get(String(item.empleadoId)) || []) {
      if (activas.has(stale.codigo)) continue;
      if (HE_CLAVES.includes(stale.codigo) && enElDia.has(stale.codigo) && heTotal < minimo) {
        if (stale.estatus === 'pendiente') rechazarBajo.push({ id: stale._id, heTotal, minimo });
        continue;
      }
      rechazarOtras.push(stale._id);
    }
  }

  for (let i = 0; i < ops.length; i += 500) {
    await Incidencia.bulkWrite(ops.slice(i, i + 500), { ordered: false });
  }
  const bajoPorMensaje = new Map();
  for (const row of rechazarBajo) {
    const msg = `Horas extra de ${row.heTotal} min, bajo el mínimo de ${row.minimo} min de la subsidiaria. Queda como nota y no pide autorización.`;
    if (!bajoPorMensaje.has(msg)) bajoPorMensaje.set(msg, []);
    bajoPorMensaje.get(msg).push(row.id);
  }
  for (const [motivoRechazo, idsBajo] of bajoPorMensaje) {
    await Incidencia.updateMany(
      { _id: { $in: idsBajo } },
      {
        $set: {
          estatus: 'rechazada',
          motivoRechazo,
          fechaResolucion: new Date()
        }
      }
    );
  }
  if (rechazarOtras.length) {
    await Incidencia.updateMany(
      { _id: { $in: rechazarOtras } },
      {
        $set: {
          estatus: 'rechazada',
          motivoRechazo: 'Cancelada: la asistencia del día ya no genera esta incidencia',
          fechaResolucion: new Date()
        }
      }
    );
  }
}

module.exports = {
  syncAutomaticIncidencias,
  syncAutomaticIncidenciasLote,
  cerrarHePendientesBajoMinimo
};
