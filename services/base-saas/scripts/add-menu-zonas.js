'use strict';
/**
 * Menú Asistencia → Zonas
 *   node scripts/add-menu-zonas.js
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

  const asistenciaCat = await Menu.findOne({
    menuPrincipal: 'Asistencia',
    esCategoria: true,
    activo: true
  }).lean();
  if (!asistenciaCat) throw new Error('No se encontró categoría Asistencia');

  const existing = await Menu.findOne({ rutaApp: '/config-zonas' }).lean();
  if (!existing) {
    await Menu.create({
      menuPrincipal: 'Zonas',
      rutaApp: '/config-zonas',
      parentId: asistenciaCat._id,
      orden: 48,
      esCategoria: false,
      activo: true,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
  } else {
    await Menu.updateOne(
      { _id: existing._id },
      {
        $set: {
          parentId: asistenciaCat._id,
          orden: 48,
          activo: true,
          requiredFeatureKeys: ['asistencia'],
          roles: []
        }
      }
    );
  }

  console.log('menú: Asistencia → Zonas → /config-zonas');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
