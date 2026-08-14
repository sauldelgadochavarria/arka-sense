'use strict';
/**
 * Agrega menú: Nómina → Configuraciones → Configuración fiscal
 *   node scripts/add-menu-configuracion-fiscal.js
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

  let config = await Menu.findOne({
    menuPrincipal: 'Configuraciones',
    parentId: nomina._id,
    esCategoria: true
  }).lean();
  if (!config) {
    config = await Menu.create({
      menuPrincipal: 'Configuraciones',
      esCategoria: true,
      parentId: nomina._id,
      orden: 35,
      activo: true,
      requiredFeatureKeys: ['nomina'],
      roles: []
    });
  }

  const filter = { menuPrincipal: 'Configuración fiscal', parentId: config._id };
  const payload = {
    menuPrincipal: 'Configuración fiscal',
    rutaApp: '/nomina/configuracion',
    parentId: config._id,
    orden: 350,
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

  console.log('menú: Nómina → Configuraciones → Configuración fiscal → /nomina/configuracion');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
