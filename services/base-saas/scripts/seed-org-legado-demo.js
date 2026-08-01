#!/usr/bin/env node
'use strict';

/**
 * Siembra códigos legado Fortia en deptos, puestos y ubicación para pruebas de importación.
 *
 * npm run seed:org-legado-demo -- --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const getSubsidiariaModel = require('../models/subsidiaria');
const { resolveTenantId } = require('../libs/resolveTenantId');

const DEPTOS_DEMO = [
  { codigoLegado: 25, nombre: 'Depto legado 25' },
  { codigoLegado: 99, nombre: 'Depto legado 99' },
  { codigoLegado: 30, nombre: 'Depto legado 30' },
  { codigoLegado: 28, nombre: 'Depto legado 28' }
];

const PUESTOS_DEMO = [
  { codigoLegado: 1139, nombre: 'Puesto legado 1139' },
  { codigoLegado: 1079, nombre: 'Puesto legado 1079' },
  { codigoLegado: 1125, nombre: 'Puesto legado 1125' },
  { codigoLegado: 2000, nombre: 'Puesto legado 2000' },
  { codigoLegado: 990, nombre: 'Puesto legado 990' },
  { codigoLegado: 109, nombre: 'Puesto legado 109' }
];

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

async function upsertDepto(Departamento, tenantId, empresaId, item) {
  const existing = await Departamento.findOne({ tenantId, codigoLegado: item.codigoLegado });
  if (existing) {
    existing.nombre = item.nombre;
    await existing.save();
    return 'actualizado';
  }
  await Departamento.create({
    tenantId,
    empresaId,
    nombre: item.nombre,
    codigoLegado: item.codigoLegado,
    activo: true
  });
  return 'creado';
}

async function upsertPuesto(Puesto, tenantId, empresaId, item) {
  const existing = await Puesto.findOne({ tenantId, codigoLegado: item.codigoLegado });
  if (existing) {
    existing.nombre = item.nombre;
    await existing.save();
    return 'actualizado';
  }
  await Puesto.create({
    tenantId,
    empresaId,
    nombre: item.nombre,
    codigoLegado: item.codigoLegado,
    activo: true
  });
  return 'creado';
}

async function upsertSubsidiaria(Subsidiaria, empresaId, item) {
  const existing = await Subsidiaria.findOne({ empresaId, codigoLegado: item.codigoLegado });
  if (existing) {
    existing.nombre = item.nombre;
    await existing.save();
    return 'actualizada';
  }
  const byCodigo = await Subsidiaria.findOne({ codigo: item.codigo }).lean();
  if (byCodigo) {
    await Subsidiaria.updateOne({ _id: byCodigo._id }, { $set: { codigoLegado: item.codigoLegado } });
    return 'codigoLegado asignado a subsidiaria existente';
  }
  await Subsidiaria.create({
    empresaId,
    codigo: item.codigo,
    nombre: item.nombre,
    codigoLegado: item.codigoLegado,
    activo: true
  });
  return 'creada';
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

  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();

  for (const d of DEPTOS_DEMO) {
    const r = await upsertDepto(Departamento, tenantId, empresa._id, d);
    console.log(`Depto ${d.codigoLegado}: ${r}`);
  }
  for (const p of PUESTOS_DEMO) {
    const r = await upsertPuesto(Puesto, tenantId, empresa._id, p);
    console.log(`Puesto ${p.codigoLegado}: ${r}`);
  }

  const subResult = await upsertSubsidiaria(Subsidiaria, empresa._id, {
    codigoLegado: 1,
    codigo: 'UBIC01',
    nombre: 'Ubicación legado 1'
  });
  console.log(`Subsidiaria CLA_UBICACION=1: ${subResult}`);

  console.log('✓ Catálogos org legado listos para import:historial-legado');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
