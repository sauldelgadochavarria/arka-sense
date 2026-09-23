'use strict';
/**
 * Agrega menú: Asistencia → Inicio asistencia + Autorizaciones
 *   node scripts/add-menu-asistencia-hub.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');

async function upsert(Menu, parentId, item) {
  const existing = await Menu.findOne({ rutaApp: item.rutaApp }).lean();
  const payload = {
    ...item,
    parentId,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['asistencia'],
    roles: []
  };
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: payload });
    console.log('✓ actualizado', item.menuPrincipal, '→', item.rutaApp);
    return;
  }
  const created = await Menu.create(payload);
  console.log('✓ creado', item.menuPrincipal, String(created._id));
}

(async () => {
  const conn = await mongoose
    .createConnection(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config')
    .asPromise();
  const Menu = conn.model('Menu', menuSchema, 'mainmenu');

  let cat = await Menu.findOne({ menuPrincipal: 'Asistencia', esCategoria: true }).lean();
  if (!cat) {
    cat = await Menu.create({
      menuPrincipal: 'Asistencia',
      esCategoria: true,
      orden: 40,
      activo: true,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
    console.log('✓ categoría Asistencia creada');
  }

  await upsert(Menu, cat._id, {
    menuPrincipal: 'Inicio asistencia',
    rutaApp: '/asistencia',
    orden: 40.5
  });
  await upsert(Menu, cat._id, {
    menuPrincipal: 'Autorizaciones',
    rutaApp: '/asistencia-autorizaciones',
    orden: 47.5
  });

  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
