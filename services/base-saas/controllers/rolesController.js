const getRoleModel = require('../models/role');

async function listRoles(req, res) {
  const Role = await getRoleModel();
  const roles = await Role.find().sort({ nombre: 1 }).lean();
  res.render('Configurations/roles', { roles, session: req.session });
}

async function createRole(req, res) {
  const Role = await getRoleModel();
  await Role.create({
    nombre: req.body.nombre,
    descripcion: req.body.descripcion,
    esAdmin: req.body.esAdmin === 'on',
    adminAccesoConfig: req.body.adminAccesoConfig === 'on',
    puedeGestionarSubsidiarias: req.body.puedeGestionarSubsidiarias === 'on',
    esAdminSistema: req.body.esAdminSistema === 'on',
    puedeVerReportes: req.body.puedeVerReportes === 'on',
    puedeVerNomina: req.body.puedeVerNomina === 'on',
    puedeGestionarNomina: req.body.puedeGestionarNomina === 'on',
    activo: true
  });
  res.redirect('/config-roles');
}

module.exports = { listRoles, createRole };
