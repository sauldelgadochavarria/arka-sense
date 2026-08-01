#!/usr/bin/env node
'use strict';

/**
 * Importa movimientos asistencia→nómina Fortia (TSV).
 * npm run import:movimientos-asistencia -- --slug=empresa-demo --file=data/movimientos-asistencia-sample.tsv
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getEmpleadoModel = require('../models/empleado');
const { importarMovimientosLegado } = require('../libs/importacionMovimientosAsistenciaLegado');
const { resolveTenantId } = require('../libs/resolveTenantId');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'movimientos-asistencia-sample.tsv');

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

  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId }).lean();
  const byCodigo = new Map();
  const byNum = new Map();
  for (const e of empleados) {
    if (e.codigoExterno) byCodigo.set(String(e.codigoExterno), e._id);
    if (e.numEmpleado) byNum.set(String(e.numEmpleado), e._id);
  }

  async function empleadoResolver(claTrab) {
    return byCodigo.get(claTrab) || byNum.get(claTrab) || null;
  }

  const result = await importarMovimientosLegado(tenantId, empresa._id, filePath, empleadoResolver, {
    dryRun
  });

  if (dryRun) {
    console.log(`Simulación: ${result.total} movimientos, omitidos: ${result.omitidos.length}`);
  } else {
    console.log(`Insertados: ${result.insertados}, omitidos: ${result.omitidos.length}`);
  }
  if (result.omitidos?.length) {
    console.log('Omitidos:', result.omitidos.slice(0, 10));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
