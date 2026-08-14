'use strict';

const { userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');

function requireNominaViewAccess(req, res, next) {
  if (userCanViewNomina(req.session)) return next();
  req.flash('error', 'Tu rol no tiene permiso para consultar conceptos de nómina.');
  return res.redirect('/dashboard');
}

function requireNominaEditAccess(req, res, next) {
  if (userCanEditNomina(req.session)) return next();
  req.flash(
    'error',
    'Tu rol solo puede consultar nómina. Calcular, cerrar o editar requiere el rol «Nómina operativa».'
  );
  const codigo = req.params?.codigo;
  if (codigo) {
    return res.redirect(`/nomina/conceptos/${encodeURIComponent(String(codigo).toUpperCase())}?modo=vista`);
  }
  if (req.params?.id && String(req.originalUrl || '').includes('/periodos/')) {
    return res.redirect(`/nomina/periodos/${req.params.id}`);
  }
  return res.redirect('/nomina/periodos');
}

module.exports = {
  requireNominaViewAccess,
  requireNominaEditAccess,
  userCanEditNomina,
  userCanViewNomina
};
