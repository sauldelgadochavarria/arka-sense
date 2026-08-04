'use strict';

/**
 * Asegura conceptos informativos del motor ISR dual en el tenant.
 * Uso: node scripts/ensure-isr-motor-conceptos.js --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const { ensureNominaConceptsForTenant } = require('../services/nomina/nominaConceptoService');

async function main() {
  const slugArg = process.argv.find((a) => a.startsWith('--slug='));
  const slug = slugArg ? slugArg.split('=')[1] : 'empresa-demo';
  await mongoose.connect(dbConfig.mongoUri || process.env.MONGO_URI || 'mongodb://localhost:27020/config');
  const Tenant = await getTenantModel();
  const Empresa = await getEmpresaModel();
  const tenant = await Tenant.findOne({ slug }).lean();
  if (!tenant) throw new Error('Tenant no encontrado: ' + slug);
  const empresa = await Empresa.findOne({ tenantId: tenant.tenantId });
  if (!empresa) throw new Error('Empresa no encontrada');
  if (!empresa.nominaIsr) {
    empresa.nominaIsr = { modo: 'inteligente_alerta', activo: true };
    await empresa.save();
  }
  await ensureNominaConceptsForTenant(tenant.tenantId, empresa._id);
  console.log('OK motor ISR + conceptos para', slug);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
