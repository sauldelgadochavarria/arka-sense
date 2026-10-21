'use strict';

const { SUBSIDIARY_MODULE_KEYS } = require('../config/subsidiaryModules');

function tenantHasFeature(featureFlags, flagKey) {
  if (!featureFlags || typeof featureFlags !== 'object') return flagKey === 'core';
  if (Object.prototype.hasOwnProperty.call(featureFlags, flagKey)) {
    return featureFlags[flagKey] === true;
  }
  return flagKey === 'core';
}

function tenantHasAnyFeature(featureFlags, flagKeys) {
  if (!flagKeys?.length) return true;
  return flagKeys.some((k) => tenantHasFeature(featureFlags, k));
}

/**
 * Licencia del tenant para un módulo de subsidiaria.
 * El flag propio manda: ausente o false = OFF. No se hereda de incidencias ni de nómina.
 */
function tenantLicensesModule(tenantFlags, mod) {
  const flags = tenantFlags && typeof tenantFlags === 'object' ? tenantFlags : {};
  const keys = mod.tenantAnyOf?.length ? mod.tenantAnyOf : [mod.key];
  return tenantHasAnyFeature(flags, keys);
}

/** Flags efectivos ya calculados en sesión (tenant ∩ subsidiaria activa). */
function effectiveFeatureFlagsFromReq(req) {
  const sessionFlags = req.session?.featureFlags;
  if (sessionFlags && typeof sessionFlags === 'object' && Object.keys(sessionFlags).length) {
    return sessionFlags;
  }
  return req.tenant?.featureFlags || {};
}

/**
 * Licencia tenant ∩ módulos de subsidiaria.
 * `subModulos` = { asistencia?: boolean, recibos?: boolean, vacaciones?: boolean }
 * Ausente o true en sub = hereda; false = apaga aunque el tenant lo tenga.
 * Tenant en false siempre gana (no se puede “encender” solo desde la sub).
 */
function resolveEffectiveFeatureFlags(tenantFlags, subModulos) {
  const base = tenantFlags && typeof tenantFlags === 'object' ? { ...tenantFlags } : {};
  const effective = { ...base };
  const mods = subModulos && typeof subModulos === 'object' ? subModulos : {};

  for (const mod of SUBSIDIARY_MODULE_KEYS) {
    const tenantOn = tenantLicensesModule(base, mod);
    const subOn = Object.prototype.hasOwnProperty.call(mods, mod.key) ? mods[mod.key] === true : true;
    effective[mod.key] = Boolean(tenantOn && subOn);
  }

  return effective;
}

function subsidiaryModuleEnabled(effectiveFlags, moduleKey) {
  return tenantHasFeature(effectiveFlags, moduleKey);
}

module.exports = {
  tenantHasFeature,
  tenantHasAnyFeature,
  tenantLicensesModule,
  resolveEffectiveFeatureFlags,
  subsidiaryModuleEnabled,
  effectiveFeatureFlagsFromReq
};
