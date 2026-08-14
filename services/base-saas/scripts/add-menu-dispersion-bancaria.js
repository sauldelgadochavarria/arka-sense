'use strict';
/**
 * Actualiza menú Pago-dispersión → /nomina/dispersion-bancaria
 *   node scripts/add-menu-dispersion-bancaria.js
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
  if (!nomina) throw new Error('No se encontró categoría Nómina');

  let calculo = await Menu.findOne({
    menuPrincipal: 'Cálculo',
    parentId: nomina._id,
    esCategoria: true,
    activo: true
  }).lean();
  if (!calculo) {
    calculo = await Menu.create({
      menuPrincipal: 'Cálculo',
      esCategoria: true,
      parentId: nomina._id,
      orden: 37,
      activo: true,
      requiredFeatureKeys: ['nomina'],
      roles: []
    });
  }

  const filter = { menuPrincipal: 'Pago-dispersión', parentId: calculo._id };
  const payload = {
    menuPrincipal: 'Pago-dispersión',
    rutaApp: '/nomina/dispersion-bancaria',
    parentId: calculo._id,
    orden: 373,
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

  // Desactiva placeholder viejo si quedó
  await Menu.updateMany(
    { rutaApp: '/nomina/placeholder/pago-dispersion' },
    { $set: { activo: false } }
  );

  console.log('menú: Nómina → Cálculo → Pago-dispersión → /nomina/dispersion-bancaria');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
