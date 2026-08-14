'use strict';
/**
 * Menú Gestión documental (feature: gestion_documental)
 *   node scripts/add-menu-gestion-documental.js
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

  let cat = await Menu.findOne({
    menuPrincipal: 'Gestión documental',
    parentId: nomina._id,
    esCategoria: true
  }).lean();

  const catPayload = {
    menuPrincipal: 'Gestión documental',
    esCategoria: true,
    parentId: nomina._id,
    orden: 385,
    activo: true,
    requiredFeatureKeys: ['gestion_documental'],
    roles: []
  };

  if (!cat) {
    cat = await Menu.create(catPayload);
    console.log('+', 'Gestión documental (cat)', String(cat._id));
  } else {
    await Menu.updateOne({ _id: cat._id }, { $set: catPayload });
    console.log('✓', 'Gestión documental (cat)', String(cat._id));
  }

  const common = {
    parentId: cat._id,
    esCategoria: false,
    activo: true,
    requiredFeatureKeys: ['gestion_documental'],
    roles: []
  };

  async function upsert(menuPrincipal, rutaApp, orden) {
    const filter = { menuPrincipal, parentId: cat._id };
    const payload = { ...common, menuPrincipal, rutaApp, orden };
    const existing = await Menu.findOne(filter).lean();
    if (existing) {
      await Menu.updateOne({ _id: existing._id }, { $set: payload });
      console.log('✓', menuPrincipal);
    } else {
      await Menu.create(payload);
      console.log('+', menuPrincipal);
    }
  }

  await upsert('Cumplimiento', '/nomina/gestion-documental', 386);
  await upsert('Expediente', '/nomina/gestion-documental/expediente', 387);
  await upsert('Subir documento', '/nomina/gestion-documental/subir', 388);
  await upsert('Cobertura / reportes', '/nomina/gestion-documental/reporte', 389);
  await upsert('Config. storage', '/nomina/gestion-documental/config', 390);

  console.log('menú Gestión documental listo');
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
