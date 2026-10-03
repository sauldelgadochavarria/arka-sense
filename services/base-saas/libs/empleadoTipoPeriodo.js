'use strict';

/**
 * Clasificación laboral implícita en nombre/leyenda del tipo de período.
 * @returns {'sindicalizado'|'confianza'|null}
 */
function clasificacionFromTipoPeriodo(tipo) {
  if (!tipo) return null;
  const blob = `${tipo.nombre || ''} ${tipo.leyenda || ''}`.toLowerCase();
  const looksSind = /\bsind/.test(blob) || blob.includes('sindical');
  const looksConf = /\bconf/.test(blob) || blob.includes('confianza');
  if (looksSind && !looksConf) return 'sindicalizado';
  if (looksConf) return 'confianza';
  if (looksSind) return 'sindicalizado';
  return null;
}

function clasificacionFromEmpleado(emp) {
  if (!emp) return null;
  if (emp.sindicalizado === true) return 'sindicalizado';
  if (emp.sindicalizado === false) return 'confianza';
  const te = String(emp.tipoEmpleado || '')
    .trim()
    .toLowerCase();
  if (te.includes('sind')) return 'sindicalizado';
  if (te === 'confianza' || te.includes('conf')) return 'confianza';
  return null;
}

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

/**
 * Si el período tiene tipoPeriodoId (SIND/CONF), limita a esos empleados.
 * Fallback: motor + clasificación sindicalizado del trabajador.
 */
function filterEmpleadosForPeriodo(empleados, tiposPeriodo, periodo, { strict = false } = {}) {
  const list = empleados || [];
  const tipos = tiposPeriodo || [];
  const byId = new Map(tipos.map((t) => [String(t._id), t]));
  const tipoMotor = String(periodo?.tipoPeriodo || '').toLowerCase();

  if (periodo?.tipoPeriodoId) {
    const targetId = String(periodo.tipoPeriodoId);
    const tipoCat = byId.get(targetId);
    const clasifPeriodo = clasificacionFromTipoPeriodo(tipoCat);
    return list.filter((e) => {
      if (e.tipoPeriodoId && String(e.tipoPeriodoId) === targetId) return true;
      if (e.tipoPeriodoId) {
        const tpEmp = byId.get(String(e.tipoPeriodoId));
        if (tpEmp && clasifPeriodo && clasificacionFromTipoPeriodo(tpEmp) === clasifPeriodo) {
          return String(tpEmp.tipoMotor || '').toLowerCase() === tipoMotor || !tipoMotor;
        }
        return false;
      }
      if (clasifPeriodo) {
        const clasifEmp = clasificacionFromEmpleado(e);
        if (clasifEmp) return clasifEmp === clasifPeriodo;
        return !strict;
      }
      return !strict;
    });
  }

  return filterEmpleadosByTipoMotor(list, tipos, periodo?.tipoPeriodo, { strict });
}

module.exports = {
  filterEmpleadosByTipoMotor,
  filterEmpleadosForPeriodo,
  clasificacionFromTipoPeriodo,
  clasificacionFromEmpleado
};
