const crypto = require('crypto');

const DEFAULT_ALLOWED_IPS = ['127.0.0.1', '::1'];

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function getClientIp(req) {
  return normalizeIp(req.ip || req.connection?.remoteAddress || '');
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getBasicCredentials(req) {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { username: decoded.slice(0, i), password: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

function challengeBasicAuth(res) {
  res.set('WWW-Authenticate', 'Basic realm="Base Admin", charset="UTF-8"');
  return res.status(401).send('Acceso no autorizado');
}

function buildAllowedIpRules() {
  const configured = parseCsv(process.env.BASE_ADMIN_ALLOWED_IPS);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_IPS;
}

function ipv4ToInt(ip) {
  const parts = normalizeIp(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function ipMatchesCidr(ip, cidr) {
  const [network, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!bitsStr || Number.isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  if (ipInt === null || netInt === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function isIpAllowed(ip, allowlist) {
  const clientIp = normalizeIp(ip);
  if (!clientIp) return false;
  if (allowlist.includes('*') || allowlist.includes('0.0.0.0/0')) return true;

  return allowlist.some((rule) => {
    const trimmed = rule.trim();
    if (!trimmed) return false;
    if (trimmed.includes('/')) return ipMatchesCidr(clientIp, trimmed);
    return clientIp === normalizeIp(trimmed);
  });
}

function requireAllowedIp(req, res, next) {
  const allowlist = buildAllowedIpRules();
  const clientIp = getClientIp(req);
  if (!isIpAllowed(clientIp, allowlist)) {
    return res.status(403).send('IP no autorizada');
  }
  return next();
}

function requireBasicAuth(req, res, next) {
  const expectedUser = String(process.env.BASE_ADMIN_AUTH_USER || '').trim();
  const expectedPassword = String(process.env.BASE_ADMIN_AUTH_PASSWORD || '');

  if (!expectedUser || !expectedPassword) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).send('Autenticación no configurada');
    }
    return next();
  }

  const credentials = getBasicCredentials(req);
  if (
    !credentials ||
    !timingSafeEqualStrings(credentials.username, expectedUser) ||
    !timingSafeEqualStrings(credentials.password, expectedPassword)
  ) {
    return challengeBasicAuth(res);
  }
  return next();
}

module.exports = {
  adminAccessControl: [requireAllowedIp, requireBasicAuth]
};
