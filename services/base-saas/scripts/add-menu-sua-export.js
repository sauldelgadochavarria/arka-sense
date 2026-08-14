'use strict';
/**
 * Menú Nómina → Exportación SUA
 *   node scripts/add-menu-sua-export.js
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

  const filter = { menuPrincipal: 'Exportación SUA', parentId: nomina._id };
  const payload = {
    menuPrincipal: 'Exportación SUA',
    rutaApp: '/nomina/sua',
    parentId: nomina._id,
    orden: 365,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };

  const existing = await Menu.findOne(filter).lean();
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: payload });
    console.log('✓ actualizado', String(existing._id));
  } else {
    const created = await Menu.create(payload);
    console.log('✓ creado', String(created._id));
  }

  console.log('menú: Nómina → Exportación SUA → /nomina/sua');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
