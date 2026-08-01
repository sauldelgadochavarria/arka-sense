#!/usr/bin/env node
'use strict';

/**
 * Siembra tipos de movimiento laboral por tenant.
 * npm run seed:tipos-movimiento-laboral -- --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const { ensureTiposMovimientoForTenant } = require('../services/historialLaboralService');
const { TIPOS_MOVIMIENTO_DEFAULT } = require('../config/historialLaboralDefaults');
const { resolveTenantId } = require('../libs/resolveTenantId');

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

async function main() {
  const slug = argValue('slug');
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  const Tenant = await getTenantModel();
  const tenant = slug
    ? await Tenant.findOne({ slug }).lean()
    : await Tenant.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();

  if (!tenant) {
    console.error('No se encontró tenant' + (slug ? ` slug=${slug}` : ' activo'));
    process.exit(1);
  }

  await ensureTiposMovimientoForTenant(resolveTenantId(tenant));
  console.log(`✓ ${TIPOS_MOVIMIENTO_DEFAULT.length} tipos de movimiento listos para tenant ${tenant.slug}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
