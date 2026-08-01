#!/usr/bin/env node
'use strict';

/**
 * Siembra tipos de período Fortia por tenant.
 * npm run seed:tipos-periodo -- --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const { ensureTiposPeriodoForTenant } = require('../services/tipoPeriodoNominaService');
const { TIPOS_PERIODO_DEFAULT } = require('../config/tipoPeriodoDefaults');
const { resolveTenantId } = require('../libs/resolveTenantId');

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

async function main() {
  const slug = argValue('slug');
  await mongoose.connect(dbConfig.connectionStringConfig);

  const Tenant = await getTenantModel();
  const tenant = slug
    ? await Tenant.findOne({ slug }).lean()
    : await Tenant.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();

  if (!tenant) {
    console.error('No se encontró tenant');
    process.exit(1);
  }

  const tenantId = resolveTenantId(tenant);
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  if (!empresa) {
    console.error('No hay empresa para el tenant');
    process.exit(1);
  }

  await ensureTiposPeriodoForTenant(tenantId, empresa._id);
  console.log(`✓ ${TIPOS_PERIODO_DEFAULT.length} tipos de período listos para ${tenant.slug}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
