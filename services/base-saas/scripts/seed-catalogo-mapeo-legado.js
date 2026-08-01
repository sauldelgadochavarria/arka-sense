#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { seedMapeosLegadoFortia } = require('../services/nomina/catalogosNominaService');

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  const { creados, total } = await seedMapeosLegadoFortia();
  console.log(`Mapeo legado Fortia: ${creados} nuevos, ${total} verificados`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
