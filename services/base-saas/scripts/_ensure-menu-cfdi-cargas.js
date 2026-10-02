'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  const getMenu = require('../models/menu');
  const Menu = await getMenu();
  const personal = await Menu.findOne({
    menuPrincipal: 'Personal',
    esCategoria: true,
    parentId: null
  }).lean();
  if (!personal) throw new Error('Categoría Personal no encontrada');

  // Solo masiva
  const filter = {
    menuPrincipal: 'Históricos CFDI',
    parentId: personal._id,
    rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo'
  };
  const payload = {
    menuPrincipal: 'Históricos CFDI',
    rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo',
    parentId: personal._id,
    orden: 14.2,
    activo: true,
    esCategoria: false,
    requiredFeatureKeys: ['personal'],
    roles: []
  };
  const existing = await Menu.findOne({
    parentId: personal._id,
    rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo'
  });
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: payload });
    console.log('updated Históricos CFDI masivo');
  } else {
    await Menu.create(payload);
    console.log('created Históricos CFDI masivo');
  }

  await Menu.updateMany(
    { rutaApp: '/config-empresa/cargas/cfdi_nomina_zip' },
    { $set: { activo: false, menuPrincipal: 'Históricos CFDI (retirada)' } }
  );

  await Menu.updateOne(
    { rutaApp: '/config-empresa/cargas', parentId: personal._id },
    { $set: { activo: true, orden: 14, requiredFeatureKeys: ['personal'] } }
  );

  const rows = await Menu.find({
    parentId: personal._id,
    rutaApp: /cargas|cfdi/i
  })
    .select('menuPrincipal rutaApp orden activo')
    .sort({ orden: 1 })
    .lean();
  console.log(rows);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
