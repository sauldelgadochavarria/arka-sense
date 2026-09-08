'use strict';
/**
 * Menú Configuración → Puntos de acceso
 *   node scripts/add-menu-puntos-acceso.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');

(async () => {
  const conn = await mongoose
    .createConnection(dbConfig.connectionStringConfig || 'mongodb://mongo:27017/config')
    .asPromise();
  const Menu = conn.model('Menu', menuSchema, 'mainmenu');

  const configCat = await Menu.findOne({
    menuPrincipal: 'Configuración',
    esCategoria: true,
    activo: true
  }).lean();
  if (!configCat) throw new Error('No se encontró categoría Configuración');

  const filter = { menuPrincipal: 'Puntos de acceso', parentId: configCat._id };
  const payload = {
    menuPrincipal: 'Puntos de acceso',
    rutaApp: '/config-puntos-acceso',
    parentId: configCat._id,
    orden: 104,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['config_admin'],
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

  console.log('menú: Configuración → Puntos de acceso → /config-puntos-acceso');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
