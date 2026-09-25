#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');
const MenuService = require('../services/menuService');

const ALL_FLAGS = {
  core: true,
  personal: true,
  prenomina: true,
  nomina: true,
  asistencia: true,
  integraciones: true,
  incidencias: true,
  reportes: true,
  config_admin: true
};

function printTree(nodes, depth = 0) {
  for (const n of nodes) {
    console.log(`${'  '.repeat(depth)}${n.menuPrincipal}${n.rutaApp ? ` -> ${n.rutaApp}` : ''}`);
    if (n.children?.length) printTree(n.children, depth + 1);
  }
}

async function main() {
  await mongoose.connect(dbConfig.connectionStringConfig);
  const Menu = mongoose.model('Menu', menuSchema, 'mainmenu');

  const roots = await Menu.find({ activo: true, parentId: null }).sort({ orden: 1 }).lean();
  console.log('Raíces activas en BD:', roots.map((r) => `${r.menuPrincipal} (${r.orden})`).join(', '));

  const result = await MenuService.getMenuTree([], { featureFlags: ALL_FLAGS, moduleView: 'ambos' });
  const tree = result.tree || result;
  console.log('\nÁrbol filtrado (todos los features ON, vista ambos):');
  printTree(tree);

  const active = await Menu.find({ activo: true }).lean();
  const byId = new Map(active.map((m) => [String(m._id), m]));
  const orphans = active.filter((m) => m.parentId && !byId.has(String(m.parentId)));
  console.log(`\nHuérfanos activos: ${orphans.length}`);
  if (orphans.length) {
    orphans.slice(0, 15).forEach((m) => console.log(`  - ${m.menuPrincipal} -> ${m.rutaApp || ''}`));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
