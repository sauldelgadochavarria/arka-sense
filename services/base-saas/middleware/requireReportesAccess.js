'use strict';

function userCanViewReportes(session) {
  const roles = session?.roles || [];
  if (!roles.length) return true;
  return roles.some((r) => r.puedeVerReportes || r.esAdmin || r.esAdminSistema);
}

function requireReportesAccess(req, res, next) {
  if (userCanViewReportes(req.session)) return next();
  req.flash('error', 'Tu rol no tiene permiso para consultar reportes.');
  return res.redirect('/dashboard');
}

module.exports = { requireReportesAccess, userCanViewReportes };
