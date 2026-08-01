'use strict';

const getEmpresaModel = require('../models/empresa');

async function getEmpresaForTenant(tenantId) {
  if (!tenantId) return null;
  const Empresa = await getEmpresaModel();
  return Empresa.findOne({ tenantId }).lean();
}

module.exports = { getEmpresaForTenant };
