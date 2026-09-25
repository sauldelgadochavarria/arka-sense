'use strict';

const { tenantHasFeature, tenantHasAnyFeature } = require('../libs/tenantFeatureFlags');
const { isAllowlisted, matchFeatureRule } = require('../libs/featureRouteMap');

function featureFlagsFromReq(req) {
  return req.tenant?.featureFlags || req.session?.featureFlags || {};
}

function deny(req, res, message) {
  if (req.flash) req.flash('error', message || 'Este módulo no está activo en tu licencia.');
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ ok: false, error: 'FEATURE_DISABLED', message });
  }
  return res.redirect('/dashboard');
}

/**
 * Bloquea rutas de módulos cuya feature no está activa en el tenant/sesión.
 */
function enforceFeatureFlags(req, res, next) {
  const path = req.path || req.url || '';
  if (isAllowlisted(path)) return next();

  const rule = matchFeatureRule(path);
  if (!rule) return next();

  const flags = featureFlagsFromReq(req);

  if (rule.allOf?.length) {
    const missing = rule.allOf.filter((k) => !tenantHasFeature(flags, k));
    if (missing.length) {
      return deny(req, res, `Módulo no disponible (requiere: ${missing.join(', ')}).`);
    }
  }

  if (rule.anyOf?.length && !tenantHasAnyFeature(flags, rule.anyOf)) {
    return deny(req, res, `Módulo no disponible (requiere alguno de: ${rule.anyOf.join(', ')}).`);
  }

  return next();
}

module.exports = enforceFeatureFlags;
