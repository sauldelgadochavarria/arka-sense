'use strict';

const { getEquipoEmpleadoIds } = require('../libs/portalSession');
const { listPendientesSupervisor } = require('./vacacionesService');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');

/**
 * Capacidades del empleado autenticado (portal / app).
 * Un solo producto: empleado siempre; supervisor si tiene subordinados.
 */
async function buildEmpleadoCapabilities({
  tenantId,
  empleado,
  featureFlags = {}
}) {
  const vacacionesOn = tenantHasFeature(featureFlags, 'vacaciones');
  const recibosOn = tenantHasFeature(featureFlags, 'recibos');
  const asistenciaOn = featureFlags.asistencia !== false;

  const equipoIds = empleado?._id
    ? await getEquipoEmpleadoIds(tenantId, empleado._id)
    : [];
  const esSupervisor = equipoIds.length > 0;

  let pendientesAprobacionVacaciones = 0;
  if (vacacionesOn && esSupervisor) {
    const pend = await listPendientesSupervisor(tenantId, empleado._id);
    pendientesAprobacionVacaciones = pend.length;
  }

  return {
    asistencia: asistenciaOn,
    vacaciones: vacacionesOn,
    recibos: recibosOn,
    esSupervisor,
    equipoCount: equipoIds.length,
    pendientesAprobacionVacaciones
  };
}

module.exports = { buildEmpleadoCapabilities };
