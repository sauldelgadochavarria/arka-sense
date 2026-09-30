const express = require('express');
const bcrypt = require('bcryptjs');
const { getUserModel } = require('../models/user');
const getRoleModel = require('../models/role');
const getEmpresaModel = require('../models/empresa');
const getSubsidiariaModel = require('../models/subsidiaria');
const getTenantModel = require('../models/tenant');
const { generateSessionToken } = require('../middleware/authMiddleware');
const { isSoloPortalUser } = require('../libs/roleAccess');
const {
  snapshotEmpresa,
  snapshotSubsidiaria,
  setSessionEmpresa,
  setSessionSubsidiaria,
  redirectAfterContextSwitch
} = require('../libs/tenantScope');

const router = express.Router();

router.get('/auth-login', (req, res) => {
  if (req.session?.user) {
    if (isSoloPortalUser(req.session)) return res.redirect('/portal');
    return res.redirect('/dashboard');
  }
  res.render('Auth/login', { error: req.flash('error'), tenant: req.tenant });
});

router.post('/post-login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const User = await getUserModel();
    const user = await User.findOne({ email, activo: true });
    if (!user) {
      req.flash('error', 'Credenciales inválidas');
      return res.redirect('/auth-login');
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      req.flash('error', 'Credenciales inválidas');
      return res.redirect('/auth-login');
    }

    if (req.tenant && user.tenantId && user.tenantId !== req.tenant.tenantId) {
      req.flash('error', 'Usuario no pertenece a esta cuenta');
      return res.redirect('/auth-login');
    }

    const Role = await getRoleModel();
    const roles = await Role.find({ _id: { $in: user.roles || [] } }).lean();
    const sessionToken = generateSessionToken();
    user.activeSessionToken = sessionToken;
    await user.save();

    let tenant = req.tenant;
    if (!tenant && user.tenantId) {
      const Tenant = await getTenantModel();
      tenant = await Tenant.findOne({ tenantId: user.tenantId }).lean();
    }

    const tenantId = user.tenantId || tenant?.tenantId || '';
    const Empresa = await getEmpresaModel();
    const Subsidiaria = await getSubsidiariaModel();
    let empresa = null;
    let subsidiariaActiva = null;
    if (tenantId) {
      empresa = await Empresa.findOne({ tenantId, activo: { $ne: false } })
        .sort({ createdAt: 1 })
        .lean();
      if (empresa) {
        subsidiariaActiva =
          (await Subsidiaria.findOne({ empresaId: empresa._id, activo: true, codigo: 'MAIN' }).lean()) ||
          (await Subsidiaria.findOne({ empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean());
      }
    }

    req.session.user = `${user.firstName} ${user.lastName}`;
    req.session.userid = String(user._id);
    req.session.email = user.email;
    req.session.roles = roles;
    req.session.tenantId = tenantId;
    req.session.tenantSlug = tenant?.slug || req.session.tenantSlug || '';
    req.session.featureFlags = tenant?.featureFlags || {};
    req.session.sessionToken = sessionToken;
    req.session.empresaId = empresa ? String(empresa._id) : '';
    req.session.empresaActiva = snapshotEmpresa(empresa);
    req.session.subsidiariaActiva = snapshotSubsidiaria(subsidiariaActiva);
    req.session.empleadoId = user.empleadoId ? String(user.empleadoId) : '';

    const soloEmpleado = isSoloPortalUser({ roles });

    if (soloEmpleado) return res.redirect('/portal');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('[auth]', err);
    req.flash('error', 'Error al iniciar sesión');
    return res.redirect('/auth-login');
  }
});

router.get('/logout', async (req, res) => {
  try {
    if (req.session?.userid) {
      const User = await getUserModel();
      await User.updateOne({ _id: req.session.userid }, { $set: { activeSessionToken: '' } });
    }
  } catch (_) {}
  req.session.destroy(() => res.redirect('/auth-login'));
});

router.post('/cambiar-empresa/:id', async (req, res) => {
  if (!req.session?.userid) return res.redirect('/auth-login');
  if (isSoloPortalUser(req.session)) return res.redirect('/portal');
  try {
    await setSessionEmpresa(req, req.params.id);
    req.flash('success', 'Empresa activa actualizada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo cambiar de empresa');
  }
  res.redirect(redirectAfterContextSwitch(req, '/dashboard'));
});

router.post('/cambiar-subsidiaria/:id', async (req, res) => {
  if (!req.session?.userid) return res.redirect('/auth-login');
  if (isSoloPortalUser(req.session)) return res.redirect('/portal');
  try {
    await setSessionSubsidiaria(req, req.params.id);
    req.flash('success', 'Subsidiaria activa actualizada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo cambiar de subsidiaria');
  }
  res.redirect(redirectAfterContextSwitch(req, '/dashboard'));
});

module.exports = router;
