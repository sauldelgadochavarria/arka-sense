#!/usr/bin/env node
'use strict';

/**
 * Smoke test del motor de nómina.
 * Uso: node scripts/nomina-smoke-test.js [--slug=mi-tenant]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getPeriodoNominaModel = require('../models/periodoNomina');
const { ensureNominaConceptsForTenant } = require('../services/nomina/nominaConceptoService');
const { validatePeriodoForCalculo } = require('../services/nomina/nominaPreflightService');
const { calcularPeriodo } = require('../services/nomina/calculoNominaService');
const { resolvePeriodRange } = require('../libs/payrollPeriodDates');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

function argSlug() {
  const arg = process.argv.find((a) => a.startsWith('--slug='));
  return arg ? arg.split('=')[1] : null;
}

async function main() {
  const slug = argSlug();
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

  if (!tenant.featureFlags?.nomina) {
    console.warn('⚠ Flag nomina no activo en tenant; el cálculo igual se ejecutará en este script.');
  }

  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId: tenant.tenantId }).lean();
  if (!empresa) {
    console.error('Sin empresa vinculada al tenant');
    process.exit(1);
  }

  await ensureNominaConceptsForTenant(tenant.tenantId, empresa._id);
  console.log('✓ Conceptos y fórmulas base verificados');

  const PeriodoNomina = await getPeriodoNominaModel();
  let periodo = await PeriodoNomina.findOne({
    tenantId: tenant.tenantId,
    estatus: { $in: ['abierto', 'calculado'] }
  })
    .sort({ fechaInicio: -1 })
    .lean();

  if (!periodo) {
    const { fechaInicio, fechaFin } = resolvePeriodRange('quincenal', new Date());
    periodo = await PeriodoNomina.create({
      tenantId: tenant.tenantId,
      empresaId: empresa._id,
      tipoPeriodo: 'quincenal',
      tipoNomina: 'ordinaria',
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: endOfDay(fechaFin),
      diasPeriodo: 15,
      estatus: 'abierto',
      notas: 'Creado por nomina-smoke-test'
    });
    console.log('✓ Período de prueba creado:', periodo._id.toString());
  } else {
    console.log('· Usando período existente:', periodo._id.toString());
  }

  const preflight = await validatePeriodoForCalculo(tenant.tenantId, periodo);
  console.log('\n--- Preflight ---');
  console.log('OK:', preflight.ok);
  console.log('Resumen:', preflight.resumen);
  if (preflight.bloqueos.length) {
    console.log('Bloqueos:');
    preflight.bloqueos.forEach((b) => console.log('  ✗', b.mensaje));
    process.exit(1);
  }
  if (preflight.advertencias.length) {
    console.log('Advertencias:');
    preflight.advertencias.forEach((a) => console.log('  !', a.mensaje));
  }

  console.log('\n--- Cálculo ---');
  const { resultados, totales } = await calcularPeriodo(tenant.tenantId, periodo._id, {
    userId: 'smoke-test'
  });

  const ok = resultados.filter((r) => r.ok);
  const err = resultados.filter((r) => !r.ok);
  console.log(`Recibos OK: ${ok.length}`);
  console.log(`Errores: ${err.length}`);
  if (err.length) {
    err.slice(0, 5).forEach((e) => console.log('  ✗', e.empleadoId, e.error));
  }
  console.log('Totales:', totales);

  await mongoose.disconnect();
  console.log('\nSmoke test completado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
