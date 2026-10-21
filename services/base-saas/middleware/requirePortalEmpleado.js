'use strict';

const { loadEmpleadoFromSession } = require('../libs/portalSession');
const { isSoloPortalUser } = require('../libs/roleAccess');
const getSubsidiariaModel = require('../models/subsidiaria');
const { resolveEffectiveFeatureFlags } = require('../libs/tenantFeatureFlags');
const { buildEmpleadoCapabilities } = require('../services/portalCapabilitiesService');

async function requirePortalEmpleado(req, res, next) {
  const empleado = await loadEmpleadoFromSession(req);
  if (!empleado) {
    if (isSoloPortalUser(req.session)) {
      return res.render('Portal/sin-vinculo', { session: req.session });
    }
    req.flash('error', 'Tu usuario no está vinculado a un empleado activo. Contacta a RRHH.');
    return res.redirect('/dashboard');
  }
  req.empleado = empleado;
  res.locals.empleado = empleado;

  try {
    const tenantFlags = req.session.tenantFeatureFlags || req.tenant?.featureFlags || {};
    let subModulos = null;
    if (empleado.subsidiariaId) {
      const Subsidiaria = await getSubsidiariaModel();
      const sub = await Subsidiaria.findById(empleado.subsidiariaId).select('modulos').lean();
      subModulos = sub?.modulos || null;
    }
    const effective = resolveEffectiveFeatureFlags(tenantFlags, subModulos);
    req.session.featureFlags = effective;
    res.locals.featureFlags = effective;

    const capabilities = await buildEmpleadoCapabilities({
      tenantId: req.session.tenantId,
      empleado,
      featureFlags: effective
    });
    req.session.capabilities = capabilities;
    res.locals.capabilities = capabilities;
  } catch (e) {
    /* ignore */
  }

  next();
}

module.exports = { requirePortalEmpleado };
