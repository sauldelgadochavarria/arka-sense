'use strict';
/**
 * Menú Asistencia → Registro de jornada
 *   node scripts/add-menu-registro-jornada.js
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

  const asistencia = await Menu.findOne({
    menuPrincipal: 'Asistencia',
    esCategoria: true,
    activo: true
  }).lean();
  if (!asistencia) throw new Error('No se encontró categoría Asistencia');

  const filter = { menuPrincipal: 'Registro de jornada', parentId: asistencia._id };
  const payload = {
    menuPrincipal: 'Registro de jornada',
    rutaApp: '/asistencia-registro-jornada',
    parentId: asistencia._id,
    orden: 48,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['asistencia'],
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

  console.log('menú: Asistencia → Registro de jornada → /asistencia-registro-jornada');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
