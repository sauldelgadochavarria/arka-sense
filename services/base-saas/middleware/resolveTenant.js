const getTenantModel = require('../models/tenant');
const getTenantDomainModel = require('../models/tenantDomain');

const ENABLED = (process.env.TENANT_RESOLUTION_ENABLED || 'true').toLowerCase() !== 'false';
const ALLOW_QUERY = (process.env.TENANT_ALLOW_QUERY_ACCOUNT || 'true').toLowerCase() !== 'false';
const USE_SESSION = (process.env.TENANT_USE_SESSION_SLUG || 'true').toLowerCase() !== 'false';
const PERSIST_SESSION = (process.env.TENANT_PERSIST_ACCOUNT_TO_SESSION || 'true').toLowerCase() === 'true';
const RESERVED = new Set(['www', 'app', 'admin', 'api', 'auth', 'localhost']);

function normalizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function sanitizeHost(host) {
  return String(host || '').split(':')[0].trim().toLowerCase();
}

function isLocalHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function getExplicitSlug(req) {
  const h = req.headers['x-tenant-slug'];
  if (typeof h === 'string' && h.trim()) return normalizeSlug(h);

  const host = sanitizeHost(req.headers.host);
  if (ALLOW_QUERY && req.query?.account && (isLocalHost(host) || process.env.TENANT_ALLOW_QUERY_ACCOUNT_PUBLIC === 'true')) {
    return normalizeSlug(req.query.account);
  }

  if (USE_SESSION && req.session?.tenantSlug) {
    return normalizeSlug(req.session.tenantSlug);
  }
  return '';
}

async function resolveTenantMiddleware(req, res, next) {
  req.tenant = null;
  if (!ENABLED) return next();

  try {
    const slug = getExplicitSlug(req);
    if (slug && !RESERVED.has(slug)) {
      const Tenant = await getTenantModel();
      const tenant = await Tenant.findOne({ slug }).lean();
      if (tenant) {
        req.tenant = tenant;
        if (PERSIST_SESSION && req.session) req.session.tenantSlug = tenant.slug;
      }
    }

    if (!req.tenant) {
      const host = sanitizeHost(req.headers.host);
      const TenantDomain = await getTenantDomainModel();
      const Tenant = await getTenantModel();
      const domain = await TenantDomain.findOne({ domain: host, verified: true }).lean();
      if (domain) {
        req.tenant = await Tenant.findOne({ tenantId: domain.tenantId }).lean();
      }
    }

    res.locals.tenant = req.tenant;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = resolveTenantMiddleware;
