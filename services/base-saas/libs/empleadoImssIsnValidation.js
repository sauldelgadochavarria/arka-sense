'use strict';

const { ENTIDADES_FEDERATIVAS } = require('../config/empleadoCatalogos');

const ENTIDAD_VALUES = new Set(ENTIDADES_FEDERATIVAS.map((e) => e.value));

function resolveRegistroPatronal(empleado = {}, empresa = {}) {
  return String(empleado.registroPatronal || empresa.registroPatronal || '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

function resolveEntidadFederativa(empleado = {}, empresa = {}) {
  const fromEmp = String(empleado.domicilio?.entidad || '').toUpperCase().trim();
  if (fromEmp) return fromEmp;
  return String(empresa.estado || '').toUpperCase().trim();
}

/**
 * Validaciones IMSS + ISN (impuesto sobre nómina estatal).
 * @returns {string[]} lista de problemas (vacía = OK)
 */
function validateEmpleadoImssIsn(empleado = {}, empresa = {}) {
  const issues = [];
  const rp = resolveRegistroPatronal(empleado, empresa);
  if (!rp) {
    issues.push(
      'Registro patronal IMSS obligatorio (captúralo en el empleado o en Datos de empresa)'
    );
  } else if (rp.length < 10 || rp.length > 11) {
    issues.push('Registro patronal debe tener 10–11 caracteres');
  }

  const entidad = resolveEntidadFederativa(empleado, empresa);
  if (!entidad) {
    issues.push(
      'Entidad federativa obligatoria (domicilio del trabajador) para impuesto sobre nómina estatal'
    );
  } else if (!ENTIDAD_VALUES.has(entidad)) {
    issues.push('Entidad federativa no válida (usa la clave del catálogo, ej. JC, NL, DF)');
  }

  return issues;
}

function labelEntidadFederativa(clave) {
  const found = ENTIDADES_FEDERATIVAS.find((e) => e.value === String(clave || '').toUpperCase());
  return found ? found.label : clave || '—';
}

module.exports = {
  resolveRegistroPatronal,
  resolveEntidadFederativa,
  validateEmpleadoImssIsn,
  labelEntidadFederativa,
  ENTIDAD_VALUES
};
