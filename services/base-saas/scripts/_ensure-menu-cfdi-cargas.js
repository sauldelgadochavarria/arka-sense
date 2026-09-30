'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  const getMenu = require('../models/menu');
  const Menu = await getMenu();
  const personal = await Menu.findOne({
    menuPrincipal: 'Personal',
    esCategoria: true,
    parentId: null
  }).lean();
  if (!personal) throw new Error('Categoría Personal no encontrada');

  const items = [
    {
      menuPrincipal: 'Históricos CFDI (ZIP)',
      rutaApp: '/config-empresa/cargas/cfdi_nomina_zip',
      orden: 14.1
    },
    {
      menuPrincipal: 'Históricos CFDI masivo',
      rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo',
      orden: 14.2
    }
  ];

  for (const item of items) {
    const filter = { menuPrincipal: item.menuPrincipal, parentId: personal._id };
    const existing = await Menu.findOne(filter);
    const payload = {
      ...item,
      parentId: personal._id,
      activo: true,
      esCategoria: false,
      requiredFeatureKeys: ['personal'],
      roles: []
    };
    if (existing) {
      await Menu.updateOne({ _id: existing._id }, { $set: payload });
      console.log('updated', item.menuPrincipal);
    } else {
      await Menu.create(payload);
      console.log('created', item.menuPrincipal);
    }
  }

  // Reactivar hub de cargas por si quedó off
  await Menu.updateOne(
    { rutaApp: '/config-empresa/cargas', parentId: personal._id },
    { $set: { activo: true, orden: 14, requiredFeatureKeys: ['personal'] } }
  );

  const rows = await Menu.find({
    parentId: personal._id,
    rutaApp: /cargas/i
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
