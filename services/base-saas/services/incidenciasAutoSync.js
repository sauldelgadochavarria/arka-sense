'use strict';

const getIncidenciaModel = require('../models/incidencia');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const { ensureTiposIncidenciaForTenant } = require('./tiposIncidenciaService');
const { startOfDay } = require('../libs/timeHelpers');

const AUTO_CLAVES_DIA = ['FI', 'RP', 'FR', 'RET', 'SA', 'HEO', 'HED', 'HEF'];

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
async function syncAutomaticIncidencias(tenantId, empresaId, empleadoId, fecha, daily) {
  await ensureTiposIncidenciaForTenant(tenantId, empresaId);
  const TipoIncidencia = await getTipoIncidenciaModel();
  const Incidencia = await getIncidenciaModel();
  const dayStart = startOfDay(fecha);
  const activas = new Set(daily?.incidenciasAutomaticas || []);

  for (const clave of activas) {
    const tipo = await TipoIncidencia.findOne({ tenantId, clave, activo: true }).lean();
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
          motivo: `Generada automáticamente por asistencia del ${dayStart.toLocaleDateString('es-MX')}`,
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

  if (stale.length) {
    await Incidencia.updateMany(
      { _id: { $in: stale.map((s) => s._id) } },
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

module.exports = { syncAutomaticIncidencias };
