'use strict';

const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant, findOneByTenant } = require('../libs/tenantScope');
const {
  invitar,
  buscarInvitacion,
  activarContrasena,
  revocarAcceso,
  mensajeEnvio
} = require('../services/portalAccesoService');

function volver(res, id) {
  return res.redirect(`/personal-empleados/${id}#acceso`);
}

async function invitarAcceso(req, res) {
  const id = req.params.id;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-empleados');
    }
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, id);
    if (!empleado) return res.status(404).send('Empleado no encontrado');

    const result = await invitar({
      req,
      empleado,
      empresa,
      email: req.body.emailAcceso
    });
    const msg = mensajeEnvio(result);
    if (result.envio?.modo === 'error') req.flash('error', msg);
    else req.flash('success', msg);
  } catch (err) {
    console.error('[acceso-portal]', err);
    const dup = err.code === 11000;
    req.flash('error', dup ? 'Ese correo o usuario ya existe' : (err.message || 'No se pudo preparar el acceso'));
  }
  return volver(res, id);
}

async function revocarAccesoAction(req, res) {
  const id = req.params.id;
  try {
    await revocarAcceso({ tenantId: req.session.tenantId, empleadoId: id });
    req.flash('success', 'Acceso desactivado. La app deja de aceptar la sesión anterior.');
  } catch (err) {
    console.error('[acceso-portal]', err);
    req.flash('error', err.message || 'No se pudo desactivar el acceso');
  }
  return volver(res, id);
}

async function activarForm(req, res) {
  const user = await buscarInvitacion(req.params.token);
  res.render('Auth/activar-acceso', {
    token: req.params.token,
    valido: !!user,
    email: user ? user.email : '',
    error: null,
    listo: false,
    cuenta: ''
  });
}

async function activarAction(req, res) {
  const token = req.params.token;
  const password = String(req.body.password || '');
  const confirm = String(req.body.password2 || '');
  if (password !== confirm) {
    const user = await buscarInvitacion(token);
    return res.render('Auth/activar-acceso', {
      token,
      valido: !!user,
      email: user ? user.email : '',
      error: 'Las contraseñas no coinciden.',
      listo: false,
      cuenta: ''
    });
  }
  try {
    const result = await activarContrasena({ token, password });
    return res.render('Auth/activar-acceso', {
      token,
      valido: true,
      email: result.user.email,
      error: null,
      listo: true,
      cuenta: result.cuenta
    });
  } catch (err) {
    console.error('[activar-acceso]', err);
    return res.render('Auth/activar-acceso', {
      token,
      valido: false,
      email: '',
      error: err.message || 'No se pudo guardar la contraseña.',
      listo: false,
      cuenta: ''
    });
  }
}

module.exports = {
  invitarAcceso,
  revocarAccesoAction,
  activarForm,
  activarAction
};
