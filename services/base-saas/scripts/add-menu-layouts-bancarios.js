'use strict';
/**
 * Inserta / actualiza: Nómina → Configuraciones → Layouts bancarios
 *   node scripts/add-menu-layouts-bancarios.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');

(async () => {
  const conn = await mongoose.createConnection(
    dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config'
  ).asPromise();
  const Menu = conn.model('Menu', menuSchema, 'mainmenu');

  const nomina = await Menu.findOne({ menuPrincipal: 'Nómina', esCategoria: true, activo: true }).lean();
  if (!nomina) throw new Error('No se encontró categoría Nómina en mainmenu');

  let config = await Menu.findOne({
    menuPrincipal: 'Configuraciones',
    parentId: nomina._id,
    activo: true
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
    console.log('✓ creada categoría Configuraciones');
  }

  const filter = { menuPrincipal: 'Layouts bancarios', parentId: config._id };
  const payload = {
    menuPrincipal: 'Layouts bancarios',
    rutaApp: '/nomina/layouts-bancarios',
    parentId: config._id,
    orden: 356,
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

  console.log('menú: Nómina → Configuraciones → Layouts bancarios → /nomina/layouts-bancarios');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
