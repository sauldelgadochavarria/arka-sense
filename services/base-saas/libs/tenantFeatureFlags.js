'use strict';

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

module.exports = { tenantHasFeature, tenantHasAnyFeature };
