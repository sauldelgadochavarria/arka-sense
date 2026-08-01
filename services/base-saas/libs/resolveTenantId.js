'use strict';

/** tenantId operativo usado en empresas, empleados, etc. (UUID en campo tenant.tenantId). */
function resolveTenantId(tenant) {
  if (!tenant) return null;
  return tenant.tenantId || String(tenant._id);
}

module.exports = { resolveTenantId };
