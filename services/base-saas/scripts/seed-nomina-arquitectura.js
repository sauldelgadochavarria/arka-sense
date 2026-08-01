#!/usr/bin/env node
'use strict';

/**
 * Siembra arquitectura en capas: enums, concept_catalog, company_concept_config, fórmulas SUELDO/HE.
 *
 *   npm run seed:nomina-arquitectura
 *   npm run seed:nomina-arquitectura -- --tenant=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { ensureSystemEnums } = require('../services/nomina/systemEnumService');
const {
  ensureConceptCatalog,
  ensureCompanyConceptConfigs,
  ensureDefaultFormulas
} = require('../services/nomina/conceptResolutionService');

function parseArgs(argv) {
  const out = { tenantSlug: process.env.SEED_TENANT_SLUG || '' };
  for (const arg of argv) {
    if (arg.startsWith('--tenant=')) out.tenantSlug = arg.slice(9).trim();
  }
  return out;
}

async function main() {
  const { tenantSlug } = parseArgs(process.argv.slice(2));
  await mongoose.connect(dbConfig.connectionStringConfig);
  const db = mongoose.connection.db;

  console.log('✓ Sembrando enums del sistema…');
  await ensureSystemEnums();

  console.log('✓ Sembrando catálogo global (SUELDO, HE)…');
  await ensureConceptCatalog();

  const tenants = db.collection('tenants');
  const empresas = db.collection('empresas');
  let tenant;
  if (tenantSlug) {
    tenant = await tenants.findOne({ slug: tenantSlug.toLowerCase() });
  } else {
    tenant = await tenants.findOne({ status: 'active' }) || await tenants.findOne({});
  }
  if (!tenant) {
    console.log('· Sin tenant — solo enums y catálogo global listos.');
    await mongoose.disconnect();
    return;
  }

  const empresa = await empresas.findOne({ tenantId: tenant.tenantId });
  if (!empresa) {
    console.warn(`· Tenant ${tenant.slug} sin empresa; no se creó company_concept_config.`);
  } else {
    console.log(`✓ Config empresa para ${tenant.slug}…`);
    await ensureCompanyConceptConfigs(tenant.tenantId, empresa._id);
  }

  console.log('✓ Fórmulas default (plantilla empresaId=null)…');
  await ensureDefaultFormulas(tenant.tenantId, null);

  await mongoose.disconnect();
  console.log('Seed arquitectura nómina completado.');
  console.log('  UI enums: /config-sistema/enums');
  console.log('  Conceptos: /nomina/conceptos/SUELDO y /nomina/conceptos/HORAS_EXTRA_DOBLES');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
