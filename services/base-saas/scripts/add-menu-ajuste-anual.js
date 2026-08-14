'use strict';
/**
 * Menú Personal → Ajuste anual de sueldos
 *   node scripts/add-menu-ajuste-anual.js
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

  const personal = await Menu.findOne({ menuPrincipal: 'Personal', esCategoria: true, activo: true }).lean();
  if (!personal) throw new Error('No se encontró categoría Personal');

  const filter = { menuPrincipal: 'Ajuste anual de sueldos', parentId: personal._id };
  const payload = {
    menuPrincipal: 'Ajuste anual de sueldos',
    rutaApp: '/personal/ajuste-anual',
    parentId: personal._id,
    orden: 53,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['personal'],
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

  console.log('menú: Personal → Ajuste anual de sueldos → /personal/ajuste-anual');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
