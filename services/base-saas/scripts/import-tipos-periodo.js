#!/usr/bin/env node
'use strict';

/**
 * Importa tipos de período Fortia (TSV).
 * npm run import:tipos-periodo -- --slug=empresa-demo --file=data/tipos-periodo-sample.tsv
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getTipoPeriodoNominaModel = require('../models/tipoPeriodoNomina');
const { importarTiposPeriodoLegado } = require('../libs/importacionTiposPeriodoLegado');
const { resolveTenantId } = require('../libs/resolveTenantId');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'tipos-periodo-sample.tsv');

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const slug = argValue('slug');
  const filePath = argValue('file') || DEFAULT_FILE;
  const dryRun = hasFlag('dry-run');

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
    console.error('No hay empresa');
    process.exit(1);
  }

  const TipoPeriodo = await getTipoPeriodoNominaModel();
  const result = await importarTiposPeriodoLegado(tenantId, empresa._id, filePath, TipoPeriodo, {
    dryRun
  });

  if (dryRun) {
    console.log(`Simulación: ${result.total} tipos mapeados`);
  } else {
    console.log(`Upsert: ${result.upserted} tipos, filas: ${result.totalFilas}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
