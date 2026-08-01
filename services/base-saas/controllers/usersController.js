const bcrypt = require('bcryptjs');
const { getUserModel } = require('../models/user');
const getRoleModel = require('../models/role');
const getEmpleadoModel = require('../models/empleado');
const { findOneByTenant, findOneDocByTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');

async function loadUserCatalogs(tenantId) {
  const Role = await getRoleModel();
  const Empleado = await getEmpleadoModel();
  const [roles, empleados] = await Promise.all([
    Role.find({ activo: true }).sort({ nombre: 1 }).lean(),
    Empleado.find({ tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean()
  ]);
  const empMap = new Map(empleados.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));
  const roleMap = new Map(roles.map((r) => [String(r._id), r.nombre]));
  return { roles, empleados, empMap, roleMap };
}

async function listUsers(req, res) {
  const User = await getUserModel();
  const tenantId = req.session.tenantId;
  const users = await User.find({ tenantId }).sort({ lastName: 1, firstName: 1 }).lean();
  const { roles, empleados, empMap, roleMap } = await loadUserCatalogs(tenantId);

  res.render('Configurations/users', {
    users,
    roles,
    empleados,
    empMap,
    roleMap,
    session: req.session
  });
}

async function createUser(req, res) {
  try {
    const User = await getUserModel();
    const hash = await bcrypt.hash(req.body.password, 10);
    const roleId = parseOptionalObjectId(req.body.roleId);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);

    await User.create({
      firstName: trimString(req.body.firstName),
      lastName: trimString(req.body.lastName),
      userName: trimString(req.body.userName),
      email: trimString(req.body.email).toLowerCase(),
      password: hash,
      roles: roleId ? [roleId] : [],
      empleadoId,
      tenantId: req.session.tenantId,
      activo: true
    });

    req.flash('success', 'Usuario creado');
    res.redirect('/config-users');
  } catch (err) {
    console.error('[users]', err);
    req.flash('error', err.code === 11000 ? 'Email o nombre de usuario ya existe' : 'Error al crear usuario');
    res.redirect('/config-users');
  }
}

async function editUser(req, res) {
  const User = await getUserModel();
  const user = await findOneByTenant(User, req.session.tenantId, req.params.id);
  if (!user) return res.status(404).send('Usuario no encontrado');

  const { roles, empleados } = await loadUserCatalogs(req.session.tenantId);
  const roleId = user.roles?.[0] ? String(user.roles[0]) : '';

  res.render('Configurations/user-edit', {
    user,
    roles,
    empleados,
    roleId,
    session: req.session
  });
}

async function updateUser(req, res) {
  try {
    const User = await getUserModel();
    const user = await findOneDocByTenant(User, req.session.tenantId, req.params.id);
    if (!user) {
      req.flash('error', 'Usuario no encontrado');
      return res.redirect('/config-users');
    }

    const email = trimString(req.body.email).toLowerCase();
    const userName = trimString(req.body.userName);
    const roleId = parseOptionalObjectId(req.body.roleId);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    const newPassword = trimString(req.body.password);

    const dup = await User.findOne({
      tenantId: req.session.tenantId,
      _id: { $ne: user._id },
      $or: [{ email }, { userName }]
    }).lean();
    if (dup) {
      req.flash('error', 'Email o nombre de usuario ya está en uso');
      return res.redirect(`/config-users/${user._id}/edit`);
    }

    user.firstName = trimString(req.body.firstName);
    user.lastName = trimString(req.body.lastName);
    user.userName = userName;
    user.email = email;
    user.roles = roleId ? [roleId] : [];
    user.empleadoId = empleadoId;

    if (req.body.activo === 'on' || req.body.activo === 'true') {
      user.activo = true;
    } else if (String(user._id) !== String(req.session.userid)) {
      user.activo = false;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        req.flash('error', 'La contraseña debe tener al menos 6 caracteres');
        return res.redirect(`/config-users/${user._id}/edit`);
      }
      user.password = await bcrypt.hash(newPassword, 10);
      if (String(user._id) !== String(req.session.userid)) {
        user.activeSessionToken = '';
      }
    }

    await user.save();
    req.flash('success', 'Usuario actualizado');
    res.redirect('/config-users');
  } catch (err) {
    console.error('[users]', err);
    req.flash('error', 'Error al actualizar usuario');
    res.redirect(`/config-users/${req.params.id}/edit`);
  }
}

async function toggleUser(req, res) {
  const User = await getUserModel();
  const user = await findOneDocByTenant(User, req.session.tenantId, req.params.id);
  if (!user) {
    req.flash('error', 'Usuario no encontrado');
    return res.redirect('/config-users');
  }

  if (String(user._id) === String(req.session.userid)) {
    req.flash('error', 'No puedes desactivar tu propia cuenta');
    return res.redirect('/config-users');
  }

  user.activo = !user.activo;
  if (!user.activo) user.activeSessionToken = '';
  await user.save();

  req.flash('success', user.activo ? 'Usuario activado' : 'Usuario desactivado');
  res.redirect('/config-users');
}

module.exports = { listUsers, createUser, editUser, updateUser, toggleUser };
