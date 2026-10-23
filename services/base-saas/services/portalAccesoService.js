'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getUserModel } = require('../models/user');
const getRoleModel = require('../models/role');
const getTenantModel = require('../models/tenant');
const { enviarCorreo, resolverCorreoConfig } = require('./mailerService');
const { revokeMobileAccessForUser } = require('./mobileAccessService');

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function emailEmpleado(empleado) {
  const personal = String(empleado?.emailPersonal || '').trim().toLowerCase();
  const corp = String(empleado?.email || '').trim().toLowerCase();
  return personal || corp || '';
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function estadoDe(user) {
  if (!user) return 'sin_cuenta';
  if (user.activo && !user.credencialesPendientes) return 'activo';
  if (user.inviteTokenHash && user.inviteExpiresAt && new Date(user.inviteExpiresAt).getTime() > Date.now()) {
    return 'pendiente';
  }
  return 'inactivo';
}

function publicBase(req) {
  const env = String(process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (env) return env.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

async function rolPortal() {
  const Role = await getRoleModel();
  return Role.findOne({
    activo: true,
    $or: [{ esPortalEmpleado: true }, { nombre: 'Empleado' }]
  }).lean();
}

async function usuarioDeEmpleado(tenantId, empleadoId) {
  const User = await getUserModel();
  return User.findOne({ tenantId, empleadoId });
}

async function describirAcceso(tenantId, empleado) {
  const user = empleado?._id ? await usuarioDeEmpleado(tenantId, empleado._id) : null;
  const sugerido = emailEmpleado(empleado);
  const plain = user ? (typeof user.toObject === 'function' ? user.toObject() : user) : null;
  return {
    user: plain,
    estado: estadoDe(plain),
    emailSugerido: sugerido,
    emailCuenta: plain?.email || sugerido,
    inviteSentAt: plain?.inviteSentAt || null,
    inviteExpiresAt: plain?.inviteExpiresAt || null,
    externo: false
  };
}

async function tenantInfo(tenantId) {
  const Tenant = await getTenantModel();
  const t = await Tenant.findOne({ tenantId }).select('slug displayName').lean();
  return { slug: t?.slug || '', displayName: t?.displayName || '' };
}

async function uniqueUserName(User, base) {
  const clean = String(base || 'empleado').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'empleado';
  let name = `emp-${clean}`;
  let n = 0;
  while (await User.findOne({ userName: name }).select('_id').lean()) {
    n += 1;
    name = n > 20 ? `emp-${clean.slice(0, 12)}-${crypto.randomBytes(3).toString('hex')}` : `emp-${clean}-${n}`;
    if (n > 25) break;
  }
  return name;
}

function escHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function correoHtml({ nombre, link, cuenta, yaActivo, expira }) {
  const cuando = expira.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  const paso = yaActivo
    ? 'Usa este enlace para definir una contraseña nueva. La anterior deja de servir cuando termines.'
    : 'Abre el enlace y elige tu contraseña. Puedes hacerlo en el celular o en una computadora.';
  return `<p>Hola ${escHtml(nombre)},</p>
<p>${paso}</p>
<p><a href="${escHtml(link)}">${escHtml(link)}</a></p>
<p>El enlace vence el ${escHtml(cuando)}.</p>
<p>Cuando la contraseña quede guardada, entra a la app con:</p>
<ul>
  <li>Cuenta: <strong>${escHtml(cuenta) || '(la que te indique RRHH)'}</strong></li>
  <li>Correo: el de este mensaje</li>
  <li>La contraseña que acabas de definir</li>
</ul>
<p>El mismo correo y contraseña sirven para el portal en el navegador.</p>`;
}

async function invitar({ req, empleado, empresa, email }) {
  if (!empleado || empleado.estatus === 'baja') {
    throw fail('El empleado está dado de baja. Reactívalo antes de dar acceso.');
  }
  const to = String(email || emailEmpleado(empleado)).trim().toLowerCase();
  if (!validEmail(to)) {
    throw fail('Indica un correo válido. Si la ficha no tiene correo personal ni corporativo, escríbelo aquí.');
  }
  const rol = await rolPortal();
  if (!rol) throw fail('No existe el rol de portal Empleado.', 500);

  const User = await getUserModel();
  const ocupado = await User.findOne({
    email: to,
    empleadoId: { $ne: empleado._id }
  }).select('_id email').lean();
  if (ocupado) throw fail('Ese correo ya pertenece a otra cuenta del sistema.');

  const token = crypto.randomBytes(32).toString('hex');
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + INVITE_TTL_MS);
  let user = await User.findOne({ tenantId: req.session.tenantId, empleadoId: empleado._id });
  const yaActivo = !!(user && user.activo && !user.credencialesPendientes);

  if (!user) {
    const userName = await uniqueUserName(User, empleado.numEmpleado);
    user = await User.create({
      firstName: empleado.firstName || 'Empleado',
      lastName: empleado.apellidoPaterno || empleado.lastName || '-',
      userName,
      email: to,
      password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
      roles: [rol._id],
      empleadoId: empleado._id,
      tenantId: req.session.tenantId,
      activo: false,
      credencialesPendientes: true,
      inviteTokenHash: hashToken(token),
      inviteExpiresAt: expira,
      inviteSentAt: ahora
    });
  } else {
    user.email = to;
    user.firstName = empleado.firstName || user.firstName;
    user.lastName = empleado.apellidoPaterno || empleado.lastName || user.lastName;
    if (!user.roles || !user.roles.length) user.roles = [rol._id];
    user.inviteTokenHash = hashToken(token);
    user.inviteExpiresAt = expira;
    user.inviteSentAt = ahora;
    if (!yaActivo) {
      user.activo = false;
      user.credencialesPendientes = true;
    }
    await user.save();
  }

  const info = await tenantInfo(req.session.tenantId);
  const link = `${publicBase(req)}/activar-acceso/${token}`;
  const nombre = [empleado.firstName, empleado.apellidoPaterno || empleado.lastName].filter(Boolean).join(' ') || 'empleado';
  const cfg = await resolverCorreoConfig(req.session.tenantId, empresa?._id || empleado.empresaId);
  const subject = yaActivo
    ? 'Define una nueva contraseña de acceso'
    : 'Activa tu acceso al portal y a la app';
  const html = correoHtml({ nombre, link, cuenta: info.slug, yaActivo, expira });
  const text = `${nombre}, abre ${link} para definir tu contraseña. Cuenta de la app: ${info.slug || 'consulta a RRHH'}. Vence ${expira.toISOString()}.`;

  let envio;
  try {
    envio = await enviarCorreo({
      to,
      subject,
      html,
      text,
      fromName: info.displayName || 'Arka-Presence',
      config: cfg
    });
  } catch (err) {
    envio = { modo: 'error', error: err.message || 'No se pudo enviar' };
  }

  return { to, link, yaActivo, expira, envio, cuenta: info.slug };
}

async function buscarInvitacion(token) {
  if (!token) return null;
  const User = await getUserModel();
  const user = await User.findOne({ inviteTokenHash: hashToken(token) }).lean();
  if (!user || !user.inviteExpiresAt || new Date(user.inviteExpiresAt).getTime() < Date.now()) return null;
  return user;
}

async function activarContrasena({ token, password }) {
  const pwd = String(password || '');
  if (pwd.length < 6) throw fail('La contraseña debe tener al menos 6 caracteres.');
  const User = await getUserModel();
  const user = await User.findOne({ inviteTokenHash: hashToken(token) });
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) {
    throw fail('El enlace no es válido o ya venció. Pide a RRHH que lo envíe de nuevo.');
  }
  const eraActivo = user.activo && !user.credencialesPendientes;
  user.password = await bcrypt.hash(pwd, 10);
  user.activo = true;
  user.credencialesPendientes = false;
  user.inviteTokenHash = '';
  user.inviteExpiresAt = null;
  user.mobileTokenVersion = Number(user.mobileTokenVersion || 0) + 1;
  if (eraActivo) user.activeSessionToken = '';
  await user.save();
  const info = await tenantInfo(user.tenantId);
  return { user, cuenta: info.slug };
}

async function revocarAcceso({ tenantId, empleadoId }) {
  const user = await usuarioDeEmpleado(tenantId, empleadoId);
  if (!user) throw fail('Este empleado no tiene cuenta de acceso.');
  user.activo = false;
  user.credencialesPendientes = false;
  user.inviteTokenHash = '';
  user.inviteExpiresAt = null;
  await user.save();
  await revokeMobileAccessForUser(user._id);
  return user;
}

function mensajeEnvio(result) {
  const base = result.yaActivo
    ? `Enlace para nueva contraseña listo para ${result.to}.`
    : `Invitación lista para ${result.to}.`;
  const vence = ` Vence el ${result.expira.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}.`;
  if (result.envio?.modo === 'simulacion') {
    return `${base} El correo quedó en simulación (no hay SMTP). Copia este enlace: ${result.link}${vence}`;
  }
  if (result.envio?.modo === 'error') {
    return `${base} No se pudo enviar el correo (${result.envio.error}). Copia este enlace: ${result.link}${vence}`;
  }
  return `${base} Revisa la bandeja del empleado.${vence} Cuenta de la app: ${result.cuenta || '—'}.`;
}

module.exports = {
  emailEmpleado,
  describirAcceso,
  invitar,
  buscarInvitacion,
  activarContrasena,
  revocarAcceso,
  mensajeEnvio
};
