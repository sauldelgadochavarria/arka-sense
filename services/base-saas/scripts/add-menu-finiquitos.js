'use strict';
/**
 * Menú Finiquitos (bajo Nómina, feature nomina)
 *   node scripts/add-menu-finiquitos.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');

(async () => {
  const conn = await mongoose
    .createConnection(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config')
    .asPromise();
  const Menu = conn.model('Menu', menuSchema, 'mainmenu');

  const nomina = await Menu.findOne({ menuPrincipal: 'Nómina', esCategoria: true, activo: true }).lean();
  if (!nomina) throw new Error('No se encontró categoría Nómina');

  const filter = { menuPrincipal: 'Finiquitos', parentId: nomina._id };
  const payload = {
    menuPrincipal: 'Finiquitos',
    rutaApp: '/nomina/finiquitos',
    parentId: nomina._id,
    esCategoria: false,
    orden: 355,
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };

  const existing = await Menu.findOne(filter).lean();
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: payload });
    console.log('✓ Finiquitos');
  } else {
    await Menu.create(payload);
    console.log('+ Finiquitos');
  }

  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
