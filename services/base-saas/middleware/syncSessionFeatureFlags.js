'use strict';

const getTenantModel = require('../models/tenant');
const getSubsidiariaModel = require('../models/subsidiaria');
const { resolveEffectiveFeatureFlags } = require('../libs/tenantFeatureFlags');
const { sessionSubsidiariaId } = require('../libs/tenantScope');

/**
 * Refresca featureFlags efectivos (tenant ∩ subsidiaria) en cada request autenticado.
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

    let tenantFlags = {};
    if (tenant) {
      req.tenant = req.tenant ? { ...req.tenant, ...tenant } : tenant;
      tenantFlags = tenant.featureFlags || {};
      if (tenant.slug) req.session.tenantSlug = tenant.slug;
      res.locals.tenant = req.tenant;
    }

    let subModulos = null;
    const subId = sessionSubsidiariaId(req);
    if (subId) {
      const Subsidiaria = await getSubsidiariaModel();
      const sub = await Subsidiaria.findById(subId).select('modulos nombre').lean();
      if (sub) {
        subModulos = sub.modulos || {};
        req.session.subsidiariaModulos = subModulos;
        res.locals.subsidiariaModulos = subModulos;
      }
    }

    // Empleado portal: módulos de su subsidiaria de expediente
    if (!subModulos && req.empleado?.subsidiariaId) {
      const Subsidiaria = await getSubsidiariaModel();
      const sub = await Subsidiaria.findById(req.empleado.subsidiariaId).select('modulos').lean();
      if (sub) subModulos = sub.modulos || {};
    }

    const effective = resolveEffectiveFeatureFlags(tenantFlags, subModulos);
    req.session.featureFlags = effective;
    req.session.tenantFeatureFlags = tenantFlags;
    res.locals.featureFlags = effective;
    res.locals.tenantFeatureFlags = tenantFlags;
    return next();
  } catch (err) {
    console.warn('[syncSessionFeatureFlags]', err.message);
    res.locals.featureFlags = req.session?.featureFlags || {};
    return next();
  }
}

module.exports = syncSessionFeatureFlags;
