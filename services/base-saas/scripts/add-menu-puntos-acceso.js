'use strict';
/**
 * Menú Asistencia → Puntos de acceso
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

  const asistenciaCat = await Menu.findOne({
    menuPrincipal: 'Asistencia',
    esCategoria: true,
    activo: true
  }).lean();
  if (!asistenciaCat) throw new Error('No se encontró categoría Asistencia');

  // Quitar de Configuración si estaba ahí
  await Menu.updateMany(
    { menuPrincipal: 'Puntos de acceso', rutaApp: '/config-puntos-acceso' },
    {
      $set: {
        parentId: asistenciaCat._id,
        orden: 49,
        activo: true,
        requiredFeatureKeys: ['asistencia'],
        roles: []
      }
    }
  );

  const existing = await Menu.findOne({
    menuPrincipal: 'Puntos de acceso',
    parentId: asistenciaCat._id
  }).lean();
  if (!existing) {
    await Menu.create({
      menuPrincipal: 'Puntos de acceso',
      rutaApp: '/config-puntos-acceso',
      parentId: asistenciaCat._id,
      orden: 49,
      esCategoria: false,
      activo: true,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
  }

  console.log('menú: Asistencia → Puntos de acceso → /config-puntos-acceso');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
