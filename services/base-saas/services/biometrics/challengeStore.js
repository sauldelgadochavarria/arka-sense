'use strict';

/**
 * Retos biométricos en memoria con TTL (anti-replay).
 * En multi-instancia sustituir por Redis.
 */

const crypto = require('crypto');

const DEFAULT_TTL_MS = Number(process.env.BIOMETRICS_CHALLENGE_TTL_MS || 45_000);
const store = new Map();

function cleanupExpired() {
  const now = Date.now();
  for (const [id, row] of store.entries()) {
    if (row.expiresAtMs <= now || row.consumed) store.delete(id);
  }
}

setInterval(cleanupExpired, 15_000).unref?.();

function createChallenge({ tenantId, userId, empleadoId, requiredFrames, ttlMs = DEFAULT_TTL_MS }) {
  cleanupExpired();
  const challengeId = `ch_${crypto.randomBytes(8).toString('hex')}`;
  const expiresAtMs = Date.now() + ttlMs;
  const row = {
    challengeId,
    tenantId: String(tenantId),
    userId: String(userId),
    empleadoId: String(empleadoId),
    requiredFrames: requiredFrames.map((f) => ({ ...f })),
    expiresAtMs,
    consumed: false,
    createdAt: new Date()
  };
  store.set(challengeId, row);
  return {
    challengeId,
    requiredFrames: row.requiredFrames,
    expiresAt: Math.floor(expiresAtMs / 1000)
  };
}

/**
 * Consume el reto de forma atómica (una sola vez).
 * @returns {{ ok: true, challenge } | { ok: false, error: string }}
 */
function consumeChallenge(challengeId, { tenantId, userId, empleadoId }) {
  cleanupExpired();
  const id = String(challengeId || '');
  const row = store.get(id);
  if (!row) return { ok: false, error: 'Reto no encontrado o ya usado' };
  if (row.consumed) {
    store.delete(id);
    return { ok: false, error: 'Reto ya utilizado (replay)' };
  }
  if (row.expiresAtMs <= Date.now()) {
    store.delete(id);
    return { ok: false, error: 'Reto expirado' };
  }
  if (row.tenantId !== String(tenantId) || row.empleadoId !== String(empleadoId)) {
    return { ok: false, error: 'Reto no pertenece a esta sesión' };
  }
  if (userId && row.userId !== String(userId)) {
    return { ok: false, error: 'Reto no pertenece a este usuario' };
  }
  row.consumed = true;
  store.delete(id);
  return { ok: true, challenge: row };
}

function peekChallenge(challengeId) {
  return store.get(String(challengeId || '')) || null;
}

module.exports = {
  createChallenge,
  consumeChallenge,
  peekChallenge,
  DEFAULT_TTL_MS
};
