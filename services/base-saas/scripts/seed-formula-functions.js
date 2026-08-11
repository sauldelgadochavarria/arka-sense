'use strict';

/** Seed catálogo de funciones de fórmula.
 *   node scripts/seed-formula-functions.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { ensureFormulaFunctionsSeeded } = require('../services/nomina/formulaFunctionsService');

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const r = await ensureFormulaFunctionsSeeded();
  console.log('✓ seed formula functions', r);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
