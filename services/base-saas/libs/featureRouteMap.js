'use strict';

/**
 * Prefijos de ruta → feature(s) requeridos.
 * Match: path === prefix | path.startsWith(prefix + '/') | path.startsWith(prefix + '-')
 * Gana el prefijo más largo.
 */
const FEATURE_ROUTE_RULES = [
  { prefix: '/nomina/gestion-documental', allOf: ['gestion_documental'] },
  { prefix: '/nomina', allOf: ['nomina'] },

  { prefix: '/asistencia', allOf: ['asistencia'] },
  { prefix: '/config-puntos-acceso', allOf: ['asistencia'] },

  { prefix: '/incidencias', allOf: ['incidencias'] },

  { prefix: '/prenomina', allOf: ['prenomina'] },
  { prefix: '/catalogos/periodos', allOf: ['prenomina'] },

  { prefix: '/reportes', allOf: ['reportes'] },

  { prefix: '/integraciones/abc', anyOf: ['asistencia', 'integraciones'] },
  { prefix: '/integraciones/dispositivos', anyOf: ['asistencia', 'integraciones'] },
  { prefix: '/integraciones/grupos-dispositivos', anyOf: ['asistencia', 'integraciones'] },
  { prefix: '/integraciones/exportacion', anyOf: ['prenomina', 'integraciones'] },
  { prefix: '/integraciones', allOf: ['integraciones'] },

  { prefix: '/personal', allOf: ['personal'] },
  { prefix: '/config-empresa', allOf: ['personal'] },

  { prefix: '/config-users', allOf: ['config_admin'] },
  { prefix: '/config-roles', allOf: ['config_admin'] },
  { prefix: '/config-subsidiarias', allOf: ['config_admin'] },
  { prefix: '/config-sistema', allOf: ['config_admin'] }
];

const FEATURE_ROUTE_ALLOWLIST = [
  '/',
  '/dashboard',
  '/inicio',
  '/nomina/flujo',
  '/preferencias',
  '/ayuda',
  '/portal',
  '/logout',
  '/auth-login',
  '/post-login',
  '/cambiar-subsidiaria',
  '/health'
];

function normalizePath(pathname) {
  const p = String(pathname || '').split('?')[0];
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p || '/';
}

function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}-`);
}

function isAllowlisted(pathname) {
  const path = normalizePath(pathname);
  return FEATURE_ROUTE_ALLOWLIST.some((a) => pathMatchesPrefix(path, a));
}

function matchFeatureRule(pathname) {
  const path = normalizePath(pathname);
  let best = null;
  for (const rule of FEATURE_ROUTE_RULES) {
    if (!pathMatchesPrefix(path, rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best;
}

module.exports = {
  FEATURE_ROUTE_RULES,
  FEATURE_ROUTE_ALLOWLIST,
  normalizePath,
  isAllowlisted,
  matchFeatureRule,
  pathMatchesPrefix
};
