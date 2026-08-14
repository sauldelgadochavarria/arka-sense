'use strict';

const getCorreoConfigModel = require('../models/correoConfig');
const { presetProveedor } = require('../config/correoCatalog');

function envSmtpFallback() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === '1' ||
    process.env.SMTP_SECURE === 'true' ||
    port === 465;
  return {
    codigo: 'ENV',
    nombre: 'SMTP del entorno',
    proveedor: 'smtp',
    fromNombre: '',
    fromEmail: String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
    replyTo: '',
    host,
    port: Number.isFinite(port) ? port : 587,
    seguridad: secure ? 'ssl' : 'starttls',
    usuario: String(process.env.SMTP_USER || '').trim(),
    password: String(process.env.SMTP_PASS || '').trim()
  };
}

function simulacionConfig(fromNombre = '') {
  return {
    codigo: 'SIM',
    nombre: 'Simulación',
    proveedor: 'simulacion',
    fromNombre,
    fromEmail: 'nomina@localhost',
    replyTo: '',
    host: '',
    port: 0,
    seguridad: 'ninguna',
    usuario: '',
    password: ''
  };
}

function aplicarPreset(doc) {
  if (!doc) return doc;
  const preset = presetProveedor(doc.proveedor);
  const out = { ...doc };
  if (preset.usuarioFijo && !out.usuario) out.usuario = preset.usuarioFijo;
  if (!out.host && preset.host) out.host = preset.host;
  if ((!out.port || out.port === 587) && preset.host) out.port = preset.port;
  return out;
}

function modoDeConfig(cfg) {
  if (!cfg || cfg.proveedor === 'simulacion' || !cfg.host) return 'simulacion';
  return 'real';
}

async function resolverCorreoConfig(tenantId, empresaId, correoConfigId = null) {
  const Correo = await getCorreoConfigModel();
  let doc = null;
  if (correoConfigId) {
    doc = await Correo.findOne({ _id: correoConfigId, tenantId, empresaId, activo: true }).lean();
  }
  if (!doc) {
    doc = await Correo.findOne({ tenantId, empresaId, activo: true, esDefault: true }).lean();
  }
  if (!doc) {
    doc = await Correo.findOne({ tenantId, empresaId, activo: true }).sort({ updatedAt: -1 }).lean();
  }
  if (doc) return aplicarPreset(doc);
  const env = envSmtpFallback();
  if (env) return env;
  return simulacionConfig();
}

function toBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data.buffer) return Buffer.from(data.buffer);
  return Buffer.from(data);
}

function fromHeader(cfg, fallbackName = '') {
  const email = String(cfg.fromEmail || cfg.usuario || 'nomina@localhost').trim();
  const name = String(cfg.fromNombre || fallbackName || '').replace(/"/g, '');
  return name ? `"${name}" <${email}>` : email;
}

function transportOpts(cfg) {
  const port = Number(cfg.port) || (cfg.seguridad === 'ssl' ? 465 : 587);
  const secure = cfg.seguridad === 'ssl' || port === 465;
  const opts = {
    host: cfg.host,
    port,
    secure
  };
  if (cfg.seguridad === 'starttls') {
    opts.requireTLS = true;
  }
  if (cfg.usuario || cfg.password) {
    opts.auth = { user: cfg.usuario || '', pass: cfg.password || '' };
  }
  return opts;
}

async function enviarCorreo({
  to,
  subject,
  html,
  text,
  attachments = [],
  fromName = '',
  config
}) {
  const cfg = aplicarPreset(config || simulacionConfig(fromName));
  const modo = modoDeConfig(cfg);
  const from = fromHeader(cfg, fromName);

  if (modo === 'simulacion') {
    console.log('[mailer] simulación', {
      to,
      subject,
      from,
      perfil: cfg.codigo,
      adjuntos: (attachments || []).map((a) => a.filename)
    });
    return { modo, messageId: `sim-${Date.now()}`, configId: cfg._id || null, codigo: cfg.codigo };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error(
      'Falta el paquete nodemailer. En el contenedor: npm install nodemailer'
    );
  }

  const transport = nodemailer.createTransport(transportOpts(cfg));
  const info = await transport.sendMail({
    from,
    to,
    replyTo: cfg.replyTo || undefined,
    subject,
    html,
    text: text || '',
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: toBuffer(a.content),
      contentType: a.contentType
    }))
  });

  return {
    modo,
    messageId: info.messageId || '',
    configId: cfg._id || null,
    codigo: cfg.codigo
  };
}

async function probarCorreo(cfg, to) {
  return enviarCorreo({
    to,
    subject: 'Prueba de correo — PayPilot / nómina',
    html: `<p>Este es un correo de prueba del perfil <strong>${cfg.codigo || ''}</strong> (${cfg.nombre || ''}).</p>
           <p>Si lo recibiste, la configuración es correcta.</p>`,
    fromName: cfg.fromNombre || '',
    config: cfg
  });
}

function maskCorreo(doc) {
  if (!doc) return doc;
  const o = { ...doc };
  o.password = doc.password ? '********' : '';
  return o;
}

module.exports = {
  envSmtpFallback,
  simulacionConfig,
  aplicarPreset,
  modoDeConfig,
  resolverCorreoConfig,
  enviarCorreo,
  probarCorreo,
  toBuffer,
  maskCorreo
};
