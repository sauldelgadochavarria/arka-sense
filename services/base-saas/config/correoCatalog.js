'use strict';

/**
 * Presets de correo para envío de recibos.
 * El usuario puede tener varios perfiles y marcar uno como predeterminado.
 */
const CORREO_PROVEEDORES = [
  {
    value: 'simulacion',
    label: 'Simulación (no sale a internet)',
    help: 'Marca los recibos como enviados sin conectar a un servidor. Útil para pruebas.',
    host: '',
    port: 0,
    seguridad: 'ninguna',
    usuarioHint: ''
  },
  {
    value: 'smtp',
    label: 'SMTP genérico',
    help: 'Cualquier servidor SMTP (hosting, cPanel, relay interno).',
    host: '',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'Usuario SMTP (suele ser el mismo correo)'
  },
  {
    value: 'gmail',
    label: 'Gmail / Google Workspace',
    help: 'Usa contraseña de aplicación (no la clave de la cuenta). Activa 2FA en Google.',
    host: 'smtp.gmail.com',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'Tu Gmail completo'
  },
  {
    value: 'office365',
    label: 'Microsoft 365 / Outlook',
    help: 'Cuenta de empresa en Exchange Online. Puede requerir SMTP AUTH habilitado.',
    host: 'smtp.office365.com',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'correo@tuempresa.com'
  },
  {
    value: 'sendgrid',
    label: 'SendGrid (SMTP)',
    help: 'Usuario fijo “apikey”. La contraseña es la API Key de SendGrid.',
    host: 'smtp.sendgrid.net',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'apikey',
    usuarioFijo: 'apikey'
  },
  {
    value: 'mailgun',
    label: 'Mailgun (SMTP)',
    help: 'Usuario típico: postmaster@mg.tudominio.com',
    host: 'smtp.mailgun.org',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'postmaster@mg.tudominio.com'
  },
  {
    value: 'amazon_ses',
    label: 'Amazon SES (SMTP)',
    help: 'Host según región, ej. email-smtp.us-east-1.amazonaws.com. Credenciales SMTP de SES, no las de IAM consola.',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    seguridad: 'starttls',
    usuarioHint: 'SMTP username de SES'
  }
];

const CORREO_SEGURIDAD = [
  { value: 'starttls', label: 'STARTTLS (puerto 587, recomendado)' },
  { value: 'ssl', label: 'SSL/TLS implícito (puerto 465)' },
  { value: 'ninguna', label: 'Sin cifrado (solo red interna)' }
];

function presetProveedor(value) {
  return CORREO_PROVEEDORES.find((p) => p.value === value) || CORREO_PROVEEDORES[0];
}

module.exports = { CORREO_PROVEEDORES, CORREO_SEGURIDAD, presetProveedor };
