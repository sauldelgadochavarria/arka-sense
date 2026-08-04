#!/usr/bin/env node
'use strict';

/**
 * Limpia conceptos del tenant a un set mínimo:
 * sueldo, premios puntualidad/asistencia, fondo de ahorro, impuestos +
 * acumuladores y conceptos de pre-nómina operativos.
 *
 * Uso:
 *   node scripts/limpiar-conceptos-empresa.js --slug=empresa-demo
 *   node scripts/limpiar-conceptos-empresa.js --slug=empresa-demo --dry-run
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getFormulaConceptoModel = require('../models/formulaConcepto');
const getCompanyConceptConfigModel = require('../models/companyConceptConfig');
const getConceptCatalogModel = require('../models/conceptCatalog');
const {
  ensureNominaConceptsForTenant,
  recalcularDependientes
} = require('../services/nomina/nominaConceptoService');
const { ensureConceptCatalog, ensureCompanyConceptConfigs } = require('../services/nomina/conceptResolutionService');

const KEEP = new Set([
  'SUELDO',
  'PREMIO_PUNTUALIDAD',
  'PREMIO_ASISTENCIA',
  'FONDO_AHORRO_EMPRESA',
  'FONDO_AHORRO_TRABAJADOR',
  'DED_FONDO_AHORRO',
  'ISR',
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'IMSS_OBRERO',
  'IMSS_PATRONAL',
  'PERCEPCIONES_GRAVADAS',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR',
  // Pre-nómina operativa
  'SALARIO_PERIODO',
  'HE_PRENOMINA',
  'RETARDOS',
  'FALTAS',
  'SALIDA_ANTICIPADA'
]);

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const slug = argValue('slug') || 'empresa-demo';
  const dryRun = hasFlag('dry-run');

  await mongoose.connect(dbConfig.connectionStringConfig);
  const Tenant = await getTenantModel();
  const tenant = await Tenant.findOne({ slug }).lean();
  if (!tenant) {
    console.error(`Tenant no encontrado: ${slug}`);
    process.exit(1);
  }

  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId: tenant.tenantId }).lean();
  if (!empresa) {
    console.error('Sin empresa vinculada');
    process.exit(1);
  }

  const ConceptoNomina = await getConceptoNominaModel();
  const FormulaConcepto = await getFormulaConceptoModel();
  const Config = await getCompanyConceptConfigModel();
  const Catalog = await getConceptCatalogModel();

  const todos = await ConceptoNomina.find({ tenantId: tenant.tenantId }).select('codigo activo').lean();
  const aBorrar = todos.filter((c) => !KEEP.has(c.codigo));
  const aConservar = todos.filter((c) => KEEP.has(c.codigo));

  console.log(`Tenant: ${tenant.displayName} (${tenant.slug})`);
  console.log(`Total conceptos: ${todos.length}`);
  console.log(`Conservar: ${aConservar.map((c) => c.codigo).join(', ') || '(ninguno aún)'}`);
  console.log(`Eliminar: ${aBorrar.length}`);

  if (dryRun) {
    console.log('Dry-run: no se escribe. Muestra de códigos a borrar:');
    console.log(aBorrar.slice(0, 40).map((c) => c.codigo).join(', '), aBorrar.length > 40 ? '...' : '');
    await mongoose.disconnect();
    return;
  }

  const codigosBorrar = aBorrar.map((c) => c.codigo);

  if (codigosBorrar.length) {
    const delConc = await ConceptoNomina.deleteMany({
      tenantId: tenant.tenantId,
      codigo: { $in: codigosBorrar }
    });
    const delForm = await FormulaConcepto.deleteMany({
      tenantId: tenant.tenantId,
      conceptoCodigo: { $in: codigosBorrar }
    });
    console.log(`Borrados conceptos: ${delConc.deletedCount}, fórmulas: ${delForm.deletedCount}`);
  }

  // Catálogo global: desactivar lo que ya no está en el set limpio de arquitectura
  const catalogKeep = new Set([
    'SALARIO_PERIODO',
    'HE_PRENOMINA',
    'RETARDOS',
    'FALTAS',
    'SALIDA_ANTICIPADA',
    'SUELDO',
    'PREMIO_ASISTENCIA',
    'PREMIO_PUNTUALIDAD'
  ]);
  const catOff = await Catalog.updateMany(
    { codigo: { $nin: [...catalogKeep] } },
    { $set: { activo: false } }
  );
  console.log(`Catálogo global desactivado: ${catOff.modifiedCount}`);

  await ensureConceptCatalog();
  await ensureCompanyConceptConfigs(tenant.tenantId, empresa._id);

  // Deshabilitar configs de empresa fuera del KEEP
  const cfgOff = await Config.updateMany(
    { tenantId: tenant.tenantId, empresaId: empresa._id, conceptoCodigo: { $nin: [...KEEP] } },
    { $set: { deshabilitado: true, activo: false } }
  );
  console.log(`Configs empresa deshabilitados: ${cfgOff.modifiedCount}`);

  // Asegurar set canónico + fórmulas vigentes
  await ensureNominaConceptsForTenant(tenant.tenantId, empresa._id);
  await recalcularDependientes(tenant.tenantId);

  // Desactivar cualquier fórmula huérfana de conceptos no KEEP (por si sync dejó alguna)
  const formOff = await FormulaConcepto.updateMany(
    { tenantId: tenant.tenantId, conceptoCodigo: { $nin: [...KEEP] } },
    { $set: { activo: false } }
  );
  console.log(`Fórmulas fuera del set desactivadas: ${formOff.modifiedCount}`);

  const finales = await ConceptoNomina.find({ tenantId: tenant.tenantId, activo: true })
    .select('codigo nombre')
    .sort({ codigo: 1 })
    .lean();
  console.log(`Activos finales (${finales.length}):`);
  finales.forEach((c) => console.log(`  ${c.codigo} — ${c.nombre}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
