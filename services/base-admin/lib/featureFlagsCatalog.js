'use strict';

const FEATURE_FLAG_KEYS = [
  {
    key: 'core',
    label: 'Núcleo',
    description: 'Funcionalidad base de la aplicación.'
  },
  {
    key: 'config_admin',
    label: 'Configuración administrativa',
    description: 'Gestión de usuarios, roles y subsidiarias.'
  },
  {
    key: 'reportes',
    label: 'Reportes',
    description: 'Módulo de reportes y exportaciones.'
  },
  {
    key: 'personal',
    label: 'Catálogo de personal',
    description: 'Empleados, departamentos y puestos (Fase 1).'
  },
  {
    key: 'asistencia',
    label: 'Control de asistencia',
    description: 'Turnos, marcaciones e incidencias de asistencia.'
  },
  {
    key: 'incidencias',
    label: 'Incidencias y vacaciones',
    description: 'Solicitudes, aprobaciones, catálogo de incidencias y vacaciones.'
  },
  {
    key: 'prenomina',
    label: 'Pre-nómina',
    description: 'Cálculo de períodos, conceptos y exportación a nómina.'
  },
  {
    key: 'nomina',
    label: 'Nómina',
    description: 'Administración y cálculo formal de nómina (períodos, conceptos, fiscal).'
  },
  {
    key: 'gestion_documental',
    label: 'Gestión documental',
    description:
      'Expediente digital por empresa/año/mes/período y por trabajador (CFDI, SUA, impuestos, contratos). Storage local o bucket S3/Linode.'
  },
  {
    key: 'integraciones',
    label: 'Integraciones',
    description: 'Exportación a nómina externa, sync ABC y dispositivos biométricos.'
  }
];

function tenantHasFeature(featureFlags, flagKey) {
  if (!featureFlags || typeof featureFlags !== 'object') return flagKey === 'core';
  if (Object.prototype.hasOwnProperty.call(featureFlags, flagKey)) {
    return featureFlags[flagKey] === true;
  }
  return flagKey === 'core';
}

function toFlagBoolean(value) {
  return value === true || value === 'true' || value === 'on';
}

function normalizeIncomingFeatureFlags(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const f of FEATURE_FLAG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, f.key)) {
      out[f.key] = toFlagBoolean(input[f.key]);
    }
  }
  return out;
}

/** Parsea el POST del formulario admin (checkboxes bajo featureFlags[key]). */
function parseFeatureFlagsFromForm(body) {
  const nested = body?.featureFlags;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const out = {};
    for (const f of FEATURE_FLAG_KEYS) {
      out[f.key] = toFlagBoolean(nested[f.key]);
    }
    return out;
  }
  return normalizeIncomingFeatureFlags(body?.featureFlags || body);
}

function mergeFeatureFlagsForDisplay(stored) {
  const base = {};
  for (const f of FEATURE_FLAG_KEYS) {
    base[f.key] = tenantHasFeature(stored, f.key);
  }
  return base;
}

module.exports = {
  FEATURE_FLAG_KEYS,
  tenantHasFeature,
  normalizeIncomingFeatureFlags,
  parseFeatureFlagsFromForm,
  mergeFeatureFlagsForDisplay
};
