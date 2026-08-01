#!/usr/bin/env node
'use strict';

/**
 * Importa catálogo de conceptos legado (Fortia/Ingenios TSV).
 *
 * Capa A (metadatos): npm run import:conceptos-legado -- --slug=empresa-demo
 * Solo simular:       npm run import:conceptos-legado -- --slug=empresa-demo --dry-run
 * Filtrar empresa:    npm run import:conceptos-legado -- --slug=empresa-demo --empresa=4
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const {
  importarConceptosLegadoCapaA,
  ensureCapaBConceptosForTenant,
  ensureCapaCConceptosForTenant,
  recalcularDependientes
} = require('../services/nomina/nominaConceptoService');
const { obtenerMapeosLegadoActivos } = require('../services/nomina/catalogosNominaService');
const { PRIORIDAD_CAPA_B_IDS } = require('../config/nominaConceptosCapaB');
const { PRIORIDAD_CAPA_C_IDS } = require('../config/nominaConceptosCapaC');

const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'conceptos-legado.tsv');

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
  const conFormulas = hasFlag('con-formulas') || !hasFlag('solo-metadatos');
  const claEmpresa = argValue('empresa') ? Number(argValue('empresa')) : null;
  const incluirInactivos = hasFlag('incluir-inactivos');

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
  console.log(`Tenant: ${tenant.displayName} (${tenant.slug})`);

  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId: tenant.tenantId }).lean();
  if (!empresa) {
    console.error('Sin empresa vinculada al tenant');
    process.exit(1);
  }

  console.log(`Archivo: ${filePath}`);
  if (claEmpresa != null) console.log(`Filtro CLA_EMPRESA: ${claEmpresa}`);
  if (dryRun) console.log('Modo: dry-run (sin escribir en BD)');

  const mapeos = await obtenerMapeosLegadoActivos('fortia');
  console.log('Mapeos legado cargados desde catálogo');

  const resultado = await importarConceptosLegadoCapaA(tenant.tenantId, empresa._id, filePath, {
    dryRun,
    soloActivos: !incluirInactivos,
    claEmpresa,
    mapeos
  });

  const { resumen } = resultado;
  console.log('\n--- Capa A: metadatos legado ---');
  console.log(`Conceptos mapeados: ${resumen.total}`);
  console.log(`  Percepciones: ${resumen.porTipo.percepcion}`);
  console.log(`  Deducciones:  ${resumen.porTipo.deduccion}`);
  console.log(`  Otros pagos:  ${resumen.porTipo.otro_pago}`);
  console.log(`  Orden cálculo: ${resumen.ordenMin} – ${resumen.ordenMax}`);

  if (!dryRun) {
    console.log(`Insertados: ${resultado.insertados}, actualizados: ${resultado.actualizados}`);
    console.log(`Filas en archivo: ${resultado.totalFilas}`);
  }

  if (conFormulas && !dryRun) {
    console.log('\n--- Capa B: fórmulas mathjs prioritarias ---');
    await ensureCapaBConceptosForTenant(tenant.tenantId, empresa._id);
    console.log(`✓ Capa B (${PRIORIDAD_CAPA_B_IDS.length} IDs legado)`);

    console.log('\n--- Capa C: INFONAVIT, fondo de ahorro, finiquito ---');
    await ensureCapaCConceptosForTenant(tenant.tenantId, empresa._id);
    await recalcularDependientes(tenant.tenantId);
    console.log(`✓ Capa C (${PRIORIDAD_CAPA_C_IDS.length} IDs legado)`);
  }

  console.log('\nPrioridad oleada 1:', PRIORIDAD_CAPA_B_IDS.join(', '));
  console.log('Prioridad oleada 2:', PRIORIDAD_CAPA_C_IDS.join(', '));
  console.log('Listo.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
