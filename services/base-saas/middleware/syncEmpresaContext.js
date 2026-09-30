'use strict';

const { ensureSessionEmpresaContext } = require('../libs/tenantScope');

/**
 * Sincroniza empresa/subsidiaria activa en sesión y expone listas al layout.
 */
async function syncEmpresaContext(req, res, next) {
  try {
    if (!req.session?.userid || !req.session?.tenantId) {
      res.locals.empresasDisponibles = [];
      res.locals.subsidiariasDisponibles = [];
      res.locals.empresaActiva = null;
      return next();
    }
    const ctx = await ensureSessionEmpresaContext(req);
    res.locals.empresasDisponibles = ctx.empresas || [];
    res.locals.subsidiariasDisponibles = ctx.subsidiarias || [];
    res.locals.empresaActiva = ctx.empresa || null;
    return next();
  } catch (err) {
    console.warn('[syncEmpresaContext]', err.message);
    res.locals.empresasDisponibles = [];
    res.locals.subsidiariasDisponibles = [];
    res.locals.empresaActiva = null;
    return next();
  }
}

module.exports = syncEmpresaContext;
