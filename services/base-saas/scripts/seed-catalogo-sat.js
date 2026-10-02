#!/usr/bin/env node
'use strict';

/**
 * Siembra / actualiza catálogos SAT de nómina.
 * Uso: npm run seed:catalogo-sat
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getCatalogoSatModel = require('../models/catalogoSat');
const { SAT_CATALOG_SEED } = require('../config/satCatalogSeed');

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);

  const CatalogoSat = await getCatalogoSatModel();
  let creados = 0;
  let actualizados = 0;

  for (const e of SAT_CATALOG_SEED) {
    const vigenciaDesde = e.vigenciaDesde || new Date('2017-01-01T00:00:00Z');
    const res = await CatalogoSat.updateOne(
      { catalogo: e.catalogo, clave: e.clave, vigenciaDesde },
      {
        $set: {
          descripcion: e.descripcion,
          activo: true,
          vigenciaHasta: null
        },
        $setOnInsert: {
          catalogo: e.catalogo,
          clave: e.clave,
          vigenciaDesde,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );
    if (res.upsertedCount) {
      creados += 1;
      console.log(`+ ${e.catalogo} ${e.clave}`);
    } else if (res.modifiedCount) {
      actualizados += 1;
    }
  }

  console.log(
    `Catálogo SAT: ${creados} nuevos, ${actualizados} actualizados, ${SAT_CATALOG_SEED.length} total en seed`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
