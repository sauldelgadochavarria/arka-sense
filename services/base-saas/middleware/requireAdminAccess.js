'use strict';

const { isSoloPortalUser } = require('../libs/roleAccess');

function requireAdminAccess(req, res, next) {
  if (!isSoloPortalUser(req.session)) {
    return next();
  }

  req.flash('error', 'Tu cuenta es de portal empleado. No tienes acceso al área de administración.');
  return res.redirect('/portal');
}

module.exports = { requireAdminAccess };
