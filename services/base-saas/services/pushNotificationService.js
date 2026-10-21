'use strict';

const getPushTokenModel = require('../models/pushToken');

/**
 * Registro de token FCM + envío.
 * Env: FCM_SERVER_KEY (API legacy) o FCM_ENABLED=false para solo log.
 */
async function registerPushToken({
  tenantId,
  empleadoId,
  userId = '',
  token,
  plataforma = '',
  deviceUuid = ''
}) {
  const t = String(token || '').trim();
  if (!t) {
    const err = new Error('token FCM requerido');
    err.status = 400;
    throw err;
  }
  const Model = await getPushTokenModel();
  const doc = await Model.findOneAndUpdate(
    { tenantId, empleadoId, token: t },
    {
      $set: {
        tenantId,
        empleadoId,
        userId: String(userId || ''),
        token: t,
        plataforma: String(plataforma || '').slice(0, 40),
        deviceUuid: String(deviceUuid || '').slice(0, 80),
        activo: true,
        ultimoUsoAt: new Date()
      }
    },
    { upsert: true, new: true }
  );
  return { ok: true, id: String(doc._id) };
}

async function sendToEmpleado(tenantId, empleadoId, { title, body, data = {} }) {
  const Model = await getPushTokenModel();
  const tokens = await Model.find({
    tenantId,
    empleadoId,
    activo: true
  })
    .select('token')
    .lean();
  if (!tokens.length) {
    console.info(`[push] sin tokens empleado=${empleadoId} · ${title}`);
    return { ok: true, sent: 0, skipped: true };
  }

  const key = (process.env.FCM_SERVER_KEY || '').trim();
  if (!key || process.env.FCM_ENABLED === 'false') {
    console.info(`[push:console] →${empleadoId} ${title}: ${body}`, data);
    return { ok: true, sent: 0, mode: 'console', tokens: tokens.length };
  }

  let sent = 0;
  const invalid = [];
  for (const row of tokens) {
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: row.token,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
          ),
          priority: 'high'
        })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success === 1) sent += 1;
      else if (json.results?.[0]?.error === 'NotRegistered') invalid.push(row.token);
      else console.warn('[push] fcm response', json);
    } catch (e) {
      console.warn('[push] send error', e.message);
    }
  }
  if (invalid.length) {
    await Model.updateMany(
      { token: { $in: invalid } },
      { $set: { activo: false } }
    );
  }
  return { ok: true, sent, invalid: invalid.length };
}

module.exports = { registerPushToken, sendToEmpleado };
