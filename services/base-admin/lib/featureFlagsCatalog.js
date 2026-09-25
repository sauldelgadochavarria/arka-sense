'use strict';

/**
 * Capacidades granulares (fuente de verdad de licencia por tenant).
 * Los paquetes comerciales (FEATURE_PACKAGES) solo agrupan/pre-marcan estas keys.
 */
const FEATURE_FLAG_KEYS = [
  {
    key: 'core',
    label: 'Núcleo',
    description: 'Funcionalidad base de la aplicación.',
    packageId: 'nucleo',
    locked: true
  },
  {
    key: 'config_admin',
    label: 'Configuración administrativa',
    description: 'Gestión de usuarios, roles y subsidiarias.',
    packageId: 'nucleo',
    locked: true
  },
  {
    key: 'personal',
    label: 'Catálogo de personal',
    description: 'Empleados, departamentos, puestos, empresa y cargas iniciales.',
    packageId: 'nucleo'
  },
  {
    key: 'integraciones',
    label: 'Integraciones',
    description: 'Perfiles, logs y conexiones externas genéricas.',
    packageId: 'nucleo'
  },
  {
    key: 'asistencia',
    label: 'Control de asistencia',
    description: 'Turnos, marcaciones, dispositivos y jornada.',
    packageId: 'asistencia_prenomina'
  },
  {
    key: 'incidencias',
    label: 'Incidencias y vacaciones',
    description: 'Solicitudes, aprobaciones, catálogo de incidencias y vacaciones.',
    packageId: 'asistencia_prenomina'
  },
  {
    key: 'prenomina',
    label: 'Pre-nómina',
    description: 'Períodos, pre-cálculo, movimientos, conceptos y exportar a nómina.',
    packageId: 'asistencia_prenomina'
  },
  {
    key: 'reportes',
    label: 'Reportes',
    description: 'Reportes y dashboard gerencial (asistencia / pre-nómina).',
    packageId: 'asistencia_prenomina'
  },
  {
    key: 'nomina',
    label: 'Nómina',
    description: 'Cálculo fiscal, períodos, pago-dispersión, timbrado y cumplimiento.',
    packageId: 'nomina'
  },
  {
    key: 'gestion_documental',
    label: 'Gestión documental',
    description:
      'Expediente digital por empresa/año/mes/período y por trabajador (CFDI, SUA, impuestos, contratos).',
    packageId: 'nomina'
  }
];

/**
 * Paquetes comerciales: atajo de UX sobre los flags granulares.
 * lockedOn = siempre ON al aplicar el paquete (y no se apagan desde UI de paquete).
 */
const FEATURE_PACKAGES = [
  {
    id: 'nucleo',
    label: 'Núcleo compartido',
    description: 'Siempre visible: Personal, Configuración, Integraciones, Ayuda.',
    alwaysOn: true,
    flagKeys: ['core', 'config_admin', 'personal', 'integraciones']
  },
  {
    id: 'asistencia_prenomina',
    label: 'Asistencia-Prenómina',
    description: 'Control de tiempo, incidencias y pre-nómina.',
    alwaysOn: false,
    flagKeys: ['asistencia', 'incidencias', 'prenomina', 'reportes']
  },
  {
    id: 'nomina',
    label: 'Nómina',
    description: 'Cálculo fiscal, timbrado, dispersión y cumplimiento.',
    alwaysOn: false,
    flagKeys: ['nomina', 'gestion_documental']
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
      // Flags locked del núcleo siempre quedan ON
      if (f.locked) {
        out[f.key] = true;
        continue;
      }
      out[f.key] = toFlagBoolean(nested[f.key]);
    }
    return out;
  }
  return {
    ...normalizeIncomingFeatureFlags(body?.featureFlags || body),
    core: true,
    config_admin: true
  };
}

function mergeFeatureFlagsForDisplay(stored) {
  const base = {};
  for (const f of FEATURE_FLAG_KEYS) {
    base[f.key] = f.locked ? true : tenantHasFeature(stored, f.key);
  }
  return base;
}

/** Flags agrupados por paquete para las vistas admin. */
function featureFlagsGroupedByPackage() {
  return FEATURE_PACKAGES.map((pkg) => ({
    ...pkg,
    flags: FEATURE_FLAG_KEYS.filter((f) => f.packageId === pkg.id)
  }));
}

/**
 * Aplica un paquete sobre un mapa de flags (no apaga otros paquetes).
 * @param {Record<string, boolean>} current
 * @param {string} packageId
 * @param {boolean} enabled
 */
function applyFeaturePackage(current, packageId, enabled) {
  const pkg = FEATURE_PACKAGES.find((p) => p.id === packageId);
  if (!pkg || pkg.alwaysOn) {
    return mergeFeatureFlagsForDisplay(current);
  }
  const out = mergeFeatureFlagsForDisplay(current);
  for (const key of pkg.flagKeys) {
    const meta = FEATURE_FLAG_KEYS.find((f) => f.key === key);
    if (meta?.locked) continue;
    out[key] = !!enabled;
  }
  return out;
}

/** Defaults comerciales al crear tenant (núcleo + asistencia-prenómina; nómina off). */
function defaultFeatureFlagsForNewTenant() {
  return {
    core: true,
    config_admin: true,
    personal: true,
    integraciones: true,
    asistencia: true,
    incidencias: true,
    prenomina: true,
    reportes: true,
    nomina: false,
    gestion_documental: false
  };
}

module.exports = {
  FEATURE_FLAG_KEYS,
  FEATURE_PACKAGES,
  tenantHasFeature,
  normalizeIncomingFeatureFlags,
  parseFeatureFlagsFromForm,
  mergeFeatureFlagsForDisplay,
  featureFlagsGroupedByPackage,
  applyFeaturePackage,
  defaultFeatureFlagsForNewTenant
};
