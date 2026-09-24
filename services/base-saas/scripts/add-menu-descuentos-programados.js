'use strict';
/**
 * Menú Nómina → Descuentos programados
 *   node scripts/add-menu-descuentos-programados.js
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

  // Preferir subcategoría Cálculo si existe (mismo criterio que Finiquitos en seed.js)
  const calculo = await Menu.findOne({
    menuPrincipal: 'Cálculo',
    parentId: nomina._id,
    esCategoria: true,
    activo: true
  }).lean();
  const parentId = calculo ? calculo._id : nomina._id;
  const orden = calculo ? 375 : 356;

  const filter = { menuPrincipal: 'Descuentos programados', parentId };
  const payload = {
    menuPrincipal: 'Descuentos programados',
    rutaApp: '/nomina/descuentos-programados',
    parentId,
    esCategoria: false,
    orden,
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };

  const existing = await Menu.findOne(filter).lean();
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: payload });
    console.log('✓ actualizado Descuentos programados', String(existing._id));
  } else {
    // Si quedó colgado bajo otro parent (solo Nómina), reubicarlo
    const orphan = await Menu.findOne({
      menuPrincipal: 'Descuentos programados',
      rutaApp: '/nomina/descuentos-programados'
    }).lean();
    if (orphan) {
      await Menu.updateOne({ _id: orphan._id }, { $set: payload });
      console.log('✓ reubicado Descuentos programados', String(orphan._id));
    } else {
      const created = await Menu.create(payload);
      console.log('+ creado Descuentos programados', String(created._id));
    }
  }

  console.log(
    calculo
      ? 'menú: Nómina → Cálculo → Descuentos programados'
      : 'menú: Nómina → Descuentos programados'
  );
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
