'use strict';

/**
 * Filtra empleados cuyo tipo de período coincide con el motor del período
 * (semanal, quincenal, …).
 *
 * - Con tipoPeriodoId: solo si el catálogo.tipoMotor === tipoMotorPeriodo
 * - Sin tipoPeriodoId: se incluyen (compatibilidad) salvo que strict=true
 */
function filterEmpleadosByTipoMotor(empleados, tiposPeriodo, tipoMotorPeriodo, { strict = false } = {}) {
  if (!tipoMotorPeriodo) return empleados || [];
  const byId = new Map((tiposPeriodo || []).map((t) => [String(t._id), t]));

  return (empleados || []).filter((e) => {
    if (!e.tipoPeriodoId) return !strict;
    const tp = byId.get(String(e.tipoPeriodoId));
    if (!tp) return !strict;
    return tp.tipoMotor === tipoMotorPeriodo;
  });
}

module.exports = { filterEmpleadosByTipoMotor };
