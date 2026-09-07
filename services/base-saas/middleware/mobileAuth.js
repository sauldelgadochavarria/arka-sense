'use strict';

const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const s = String(process.env.MOBILE_JWT_SECRET || process.env.BASE_SESSION_SECRET || '').trim();
  if (s) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MOBILE_JWT_SECRET (o BASE_SESSION_SECRET) requerido en producción');
  }
  return 'dev-only-mobile-jwt-secret';
}

function getJwtExpiresIn() {
  return process.env.MOBILE_JWT_EXPIRES_IN || '30d';
}

function signMobileToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: getJwtExpiresIn() });
}

function verifyMobileToken(token) {
  return jwt.verify(token, getJwtSecret());
}

/**
 * Middleware Bearer JWT para app de asistencia.
 * Requiere claims: userId, tenantId, empleadoId.
 */
async function requireMobileAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Token requerido (Authorization: Bearer …)' });
    }
    let decoded;
    try {
      decoded = verifyMobileToken(match[1].trim());
    } catch {
      return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    }
    if (!decoded?.userId || !decoded?.tenantId || !decoded?.empleadoId) {
      return res.status(401).json({ ok: false, error: 'Token incompleto' });
    }
    req.mobileAuth = {
      userId: String(decoded.userId),
      tenantId: String(decoded.tenantId),
      tenantSlug: String(decoded.tenantSlug || ''),
      empleadoId: String(decoded.empleadoId),
      email: String(decoded.email || ''),
      name: String(decoded.name || '')
    };
    return next();
  } catch (err) {
    console.error('[mobileAuth]', err);
    return res.status(500).json({ ok: false, error: 'Error de autenticación' });
  }
}

module.exports = {
  signMobileToken,
  verifyMobileToken,
  requireMobileAuth,
  getJwtSecret
};
