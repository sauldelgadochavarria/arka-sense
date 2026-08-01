const crypto = require('crypto');

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getProvidedKey(req) {
  const header = req.headers['x-base-internal-key'] || req.headers['x-arka-internal-key'];
  if (typeof header === 'string' && header.length > 0) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function internalApiAuth(req, res, next) {
  const expected = process.env.BASE_INTERNAL_API_KEY || process.env.ARKA_INTERNAL_API_KEY;
  if (!expected || !String(expected).trim()) return next();

  const provided = getProvidedKey(req);
  if (!provided || !timingSafeEqualStrings(provided, expected)) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  return next();
}

module.exports = { internalApiAuth };
