'use strict';

/**
 * Envío SMS (stub de desarrollo + hook Twilio opcional).
 * Prod: configurar SMS_PROVIDER=twilio + TWILIO_* 
 * Dev: SMS_PROVIDER=console (default) — solo loguea el código.
 */

async function sendSms({ to, body }) {
  const provider = String(process.env.SMS_PROVIDER || 'console').toLowerCase();
  const telefono = String(to || '').trim();
  const mensaje = String(body || '');

  if (!telefono) {
    const err = new Error('Teléfono requerido para SMS');
    err.code = 'SMS_NO_PHONE';
    throw err;
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      const err = new Error('Twilio no configurado (TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM)');
      err.code = 'SMS_CONFIG';
      throw err;
    }
    // Carga perezosa: no exigir dependencia si no se usa
    let twilio;
    try {
      // eslint-disable-next-line import/no-extraneous-dependencies, global-require
      twilio = require('twilio');
    } catch {
      const err = new Error('Instala el paquete twilio: npm i twilio');
      err.code = 'SMS_DEPENDENCY';
      throw err;
    }
    const client = twilio(sid, token);
    const res = await client.messages.create({ to: telefono, from, body: mensaje });
    return { ok: true, provider: 'twilio', sid: res.sid };
  }

  console.info(`[sms:console] → ${telefono}: ${mensaje}`);
  return { ok: true, provider: 'console' };
}

module.exports = { sendSms };
