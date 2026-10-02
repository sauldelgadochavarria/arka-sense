'use strict';
/**
 * Deja solo la carga masiva CFDI en menú (desactiva carga rápida).
 *   node scripts/_menu-solo-cfdi-masivo.js
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

  const off = await Menu.updateMany(
    { rutaApp: '/config-empresa/cargas/cfdi_nomina_zip' },
    { $set: { activo: false, menuPrincipal: 'Históricos CFDI (retirada)' } }
  );
  console.log('desactivados carga rápida:', off.modifiedCount, off.matchedCount);

  const masivos = await Menu.find({
    rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo'
  }).lean();

  if (!masivos.length) {
    const personal = await Menu.findOne({
      menuPrincipal: 'Personal',
      esCategoria: true,
      parentId: null
    }).lean();
    if (personal) {
      await Menu.create({
        menuPrincipal: 'Históricos CFDI',
        rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo',
        parentId: personal._id,
        orden: 14.2,
        activo: true,
        esCategoria: false,
        requiredFeatureKeys: ['personal'],
        roles: []
      });
      console.log('creado Históricos CFDI bajo Personal');
    }
  } else {
    for (const m of masivos) {
      await Menu.updateOne(
        { _id: m._id },
        {
          $set: {
            menuPrincipal: 'Históricos CFDI',
            activo: true,
            rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo'
          }
        }
      );
      console.log('actualizado masivo', String(m._id));
    }
  }

  // Verificación final: forzar off de rápida otra vez por si quedó sucia
  await Menu.updateMany(
    { rutaApp: '/config-empresa/cargas/cfdi_nomina_zip' },
    { $set: { activo: false, menuPrincipal: 'Históricos CFDI (retirada)' } }
  );

  const rows = await Menu.find({ rutaApp: /cfdi_nomina/ })
    .select('menuPrincipal rutaApp orden activo')
    .sort({ orden: 1 })
    .lean();
  console.log(JSON.stringify(rows, null, 2));
  await conn.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
