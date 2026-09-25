'use strict';

const getTenantModel = require('../models/tenant');

/**
 * Refresca featureFlags del tenant en sesión en cada request autenticado,
 * para que cambios en admin apliquen sin re-login.
 */
async function syncSessionFeatureFlags(req, res, next) {
  try {
    const tenantId = req.session?.tenantId || req.tenant?.tenantId;
    if (!tenantId) {
      res.locals.featureFlags = req.session?.featureFlags || {};
      return next();
    }

    const Tenant = await getTenantModel();
    const tenant = await Tenant.findOne({ tenantId })
      .select('tenantId slug displayName status featureFlags')
      .lean();

    if (tenant) {
      req.tenant = req.tenant ? { ...req.tenant, ...tenant } : tenant;
      req.session.featureFlags = tenant.featureFlags || {};
      if (tenant.slug) req.session.tenantSlug = tenant.slug;
      res.locals.tenant = req.tenant;
    }

    res.locals.featureFlags = req.session.featureFlags || {};
    return next();
  } catch (err) {
    console.warn('[syncSessionFeatureFlags]', err.message);
    res.locals.featureFlags = req.session?.featureFlags || {};
    return next();
  }
}

module.exports = syncSessionFeatureFlags;
