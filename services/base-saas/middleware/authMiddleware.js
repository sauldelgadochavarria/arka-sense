const crypto = require('crypto');

function isUserAllowed(req, res, next) {
  if (!req.session?.user || !req.session?.userid) {
    return res.redirect('/auth-login');
  }

  const token = req.session.sessionToken || '';
  if (!token) {
    return res.redirect('/auth-login');
  }

  if (req.tenant && req.tenant.status === 'suspended') {
    return res.status(403).render('Auth/suspended', { tenant: req.tenant });
  }

  return next();
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { isUserAllowed, generateSessionToken };
