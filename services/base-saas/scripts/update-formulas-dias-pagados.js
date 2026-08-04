'use strict';

/**
 * Actualiza fórmulas SUELDO / IMSS para usar diasPagados / diasCotizacion.
 * Uso: node scripts/update-formulas-dias-pagados.js --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getFormulaConceptoModel = require('../models/formulaConcepto');

async function main() {
  const slugArg = process.argv.find((a) => a.startsWith('--slug='));
  const slug = slugArg ? slugArg.split('=')[1] : 'empresa-demo';
  await mongoose.connect(dbConfig.connectionStringConfig || process.env.MONGO_URI || 'mongodb://localhost:27020/config');
  const Tenant = await getTenantModel();
  const tenant = await Tenant.findOne({ slug }).lean();
  if (!tenant) throw new Error('Tenant no encontrado');

  const Formula = await getFormulaConceptoModel();
  const r1 = await Formula.updateMany(
    {
      tenantId: tenant.tenantId,
      conceptoCodigo: 'SUELDO',
      formula: { $regex: /diasLaborados/ }
    },
    { $set: { formula: 'sueldoDiario * diasPagados' } }
  );
  const r2 = await Formula.updateMany(
    {
      tenantId: tenant.tenantId,
      conceptoCodigo: 'IMSS_OBRERO',
      formula: { $regex: /diasLaborados/ }
    },
    {
      $set: {
        formula: 'imssObrero(sueldoDiario, diasCotizacion)',
        condicion: 'diasCotizacion > 0'
      }
    }
  );
  const r3 = await Formula.updateMany(
    {
      tenantId: tenant.tenantId,
      conceptoCodigo: 'IMSS_PATRONAL',
      formula: { $regex: /diasLaborados/ }
    },
    {
      $set: {
        formula: 'imssPatronal(sueldoDiario, diasCotizacion)',
        condicion: 'diasCotizacion > 0'
      }
    }
  );
  console.log('SUELDO', r1.modifiedCount, 'IMSS_OBRERO', r2.modifiedCount, 'IMSS_PATRONAL', r3.modifiedCount);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
