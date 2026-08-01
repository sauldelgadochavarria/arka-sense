'use strict';

const { userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');

function requireNominaViewAccess(req, res, next) {
  if (userCanViewNomina(req.session)) return next();
  req.flash('error', 'Tu rol no tiene permiso para consultar conceptos de nómina.');
  return res.redirect('/dashboard');
}

function requireNominaEditAccess(req, res, next) {
  if (userCanEditNomina(req.session)) return next();
  req.flash('error', 'Tu rol no tiene permiso para editar conceptos de nómina (solo consulta).');
  const codigo = req.params?.codigo;
  if (codigo) {
    return res.redirect(`/nomina/conceptos/${encodeURIComponent(String(codigo).toUpperCase())}?modo=vista`);
  }
  return res.redirect('/nomina/conceptos');
}

module.exports = {
  requireNominaViewAccess,
  requireNominaEditAccess,
  userCanEditNomina,
  userCanViewNomina
};
