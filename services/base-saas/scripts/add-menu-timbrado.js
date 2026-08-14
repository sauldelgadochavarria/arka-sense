'use strict';
/**
 * Menú Timbrado: PAC, Recibos PDF, Timbrador
 *   node scripts/add-menu-timbrado.js
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

  let timbrado = await Menu.findOne({
    menuPrincipal: 'Timbrado',
    parentId: nomina._id,
    esCategoria: true
  }).lean();
  if (!timbrado) {
    timbrado = await Menu.create({
      menuPrincipal: 'Timbrado',
      esCategoria: true,
      parentId: nomina._id,
      orden: 38,
      activo: true,
      requiredFeatureKeys: ['nomina'],
      roles: []
    });
  } else {
    await Menu.updateOne({ _id: timbrado._id }, { $set: { activo: true, orden: 38 } });
  }

  const common = {
    parentId: timbrado._id,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };

  async function upsert(menuPrincipal, rutaApp, orden) {
    const filter = { menuPrincipal, parentId: timbrado._id };
    const payload = { ...common, menuPrincipal, rutaApp, orden };
    const existing = await Menu.findOne(filter).lean();
    if (existing) {
      await Menu.updateOne({ _id: existing._id }, { $set: payload });
      console.log('✓', menuPrincipal, String(existing._id));
    } else {
      const created = await Menu.create(payload);
      console.log('+', menuPrincipal, String(created._id));
    }
  }

  await upsert('Configuración PAC', '/nomina/pac', 380);
  await upsert('Recibos PDF', '/nomina/recibos-pdf', 381);
  await upsert('Timbrador', '/nomina/timbrado', 382);
  await upsert('Configuración de correo', '/nomina/correo', 383);
  await upsert('Envío de correo', '/nomina/envio-correo', 384);

  await Menu.updateMany(
    { rutaApp: { $in: ['/nomina/placeholder/timbrador', '/nomina/placeholder/plantilla'] } },
    { $set: { activo: false } }
  );
  await Menu.updateMany(
    { rutaApp: '/nomina/placeholder/envio-correo' },
    { $set: { rutaApp: '/nomina/envio-correo', activo: true } }
  );

  console.log('menú Timbrado listo');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
