#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const menuSchema = require('../models/menuSchemaDefinition');
const { COLLECTION_ROLES } = require('../config/constants');
const { seedAyudaMenus } = require('./seed-ayuda-conocimiento');

const ROLES = [
  {
    nombre: 'Admin Completo',
    descripcion: 'Administrador con acceso total a configuración',
    esAdmin: true,
    adminAccesoConfig: true,
    puedeGestionarSubsidiarias: true,
    esAdminSistema: true,
    puedeVerReportes: true,
    puedeVerNomina: true,
    puedeGestionarNomina: true,
    activo: true,
    tenantFeatureKey: 'core'
  },
  {
    nombre: 'Usuario Operativo',
    descripcion: 'Acceso a operación diaria sin configuración',
    esAdmin: false,
    adminAccesoConfig: false,
    puedeGestionarSubsidiarias: false,
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'core'
  },
  {
    nombre: 'Solo Reportes',
    descripcion: 'Consulta de reportes',
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'reportes'
  },
  {
    nombre: 'RRHH',
    descripcion: 'Gestión de personal, expedientes y estructura organizacional',
    adminAccesoConfig: false,
    puedeGestionarPersonal: true,
    puedeVerReportes: true,
    puedeVerNomina: true,
    activo: true,
    tenantFeatureKey: 'personal'
  },
  {
    nombre: 'Supervisor',
    descripcion: 'Consulta de asistencia y aprobaciones de equipo',
    puedeGestionarAsistencia: true,
    puedeAprobarIncidencias: true,
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'incidencias'
  },
  {
    nombre: 'Empleado',
    descripcion: 'Portal de autoservicio: asistencia, solicitudes y vacaciones',
    esPortalEmpleado: true,
    activo: true,
    tenantFeatureKey: 'core'
  },
  {
    nombre: 'Nómina',
    descripcion:
      'Consulta de nómina formal (períodos, recibos, conceptos) y gestión de pre-nómina. No calcula ni cierra nómina formal.',
    puedeGestionarPrenomina: true,
    puedeVerReportes: true,
    puedeVerNomina: true,
    puedeGestionarNomina: false,
    activo: true,
    tenantFeatureKey: 'prenomina'
  },
  {
    nombre: 'Nómina operativa',
    descripcion:
      'Operación de nómina formal: abrir período, calcular, cerrar, editar conceptos y configuración fiscal.',
    puedeGestionarNomina: true,
    puedeVerNomina: true,
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'nomina'
  },
  {
    nombre: 'Consulta nómina',
    descripcion: 'Solo lectura de conceptos y configuración de nómina',
    puedeVerNomina: true,
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'nomina'
  },
  {
    nombre: 'Integraciones',
    descripcion: 'Exportación a nómina externa, sincronización ABC y dispositivos',
    puedeGestionarIntegraciones: true,
    puedeVerReportes: true,
    activo: true,
    tenantFeatureKey: 'integraciones'
  }
];

async function seedRoles(conn) {
  const Role = conn.model('Rol', new mongoose.Schema({}, { strict: false }), COLLECTION_ROLES);
  for (const r of ROLES) {
    await Role.updateOne({ nombre: r.nombre }, { $set: r }, { upsert: true });
  }
  console.log('✓ Roles sembrados');
  return Role.findOne({ nombre: 'Admin Completo' }).lean();
}

async function seedMenus(conn, adminRoleId) {
  const Menu = conn.model('Menu', menuSchema, 'mainmenu');
  const count = await Menu.countDocuments();
  if (count > 0) {
    console.log('· Menús base ya existen, verificando módulo Personal…');
    await seedCatalogosOrganizacionales(Menu);
    await seedPersonalMenus(Menu, adminRoleId);
    await seedAsistenciaMenus(Menu, adminRoleId);
    await seedIncidenciasMenus(Menu, adminRoleId);
    await seedPrenominaMenus(Menu, adminRoleId);
    await seedNominaMenus(Menu, adminRoleId);
    await seedIntegracionesMenus(Menu, adminRoleId);
    await seedReportesMenus(Menu, adminRoleId);
    await seedAyudaMenus(Menu);
    await cleanupLegacyCatalogMenus(Menu);
    await syncOperationalMenuRoles(Menu, adminRoleId);
    return;
  }

  const configCat = await Menu.create({
    menuPrincipal: 'Configuración',
    esCategoria: true,
    orden: 100,
    activo: true,
    requiredFeatureKeys: ['config_admin'],
    roles: adminRoleId ? [adminRoleId] : []
  });

  const items = [
    { menuPrincipal: 'Inicio', rutaApp: '/dashboard', icono: 'home', orden: 1, requiredFeatureKeys: ['core'] },
    { menuPrincipal: 'Usuarios', rutaApp: '/config-users', orden: 101, parentId: configCat._id, requiredFeatureKeys: ['config_admin'], roles: adminRoleId ? [adminRoleId] : [] },
    { menuPrincipal: 'Roles', rutaApp: '/config-roles', orden: 102, parentId: configCat._id, requiredFeatureKeys: ['config_admin'], roles: adminRoleId ? [adminRoleId] : [] },
    { menuPrincipal: 'Subsidiarias', rutaApp: '/config-subsidiarias', orden: 103, parentId: configCat._id, requiredFeatureKeys: ['config_admin'], roles: adminRoleId ? [adminRoleId] : [] }
  ];

  await Menu.insertMany(items);
  await seedCatalogosOrganizacionales(Menu);
  await seedPersonalMenus(Menu, adminRoleId);
  await seedAsistenciaMenus(Menu, adminRoleId);
  await seedIncidenciasMenus(Menu, adminRoleId);
  await seedPrenominaMenus(Menu, adminRoleId);
  await seedNominaMenus(Menu, adminRoleId);
  await seedIntegracionesMenus(Menu, adminRoleId);
  await seedReportesMenus(Menu, adminRoleId);
  await seedAyudaMenus(Menu);
  await cleanupLegacyCatalogMenus(Menu);
  await syncOperationalMenuRoles(Menu, adminRoleId);
  console.log('✓ Menús sembrados');
}

async function seedReportesMenus(Menu, adminRoleId) {
  void adminRoleId;
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Reportes',
    esCategoria: true,
    orden: 20,
    activo: true,
    requiredFeatureKeys: ['reportes'],
    roles: []
  });

  const common = { activo: true, requiredFeatureKeys: ['reportes'], roles: [] };
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Dashboard KPIs', rutaApp: '/reportes/kpis', parentId: catId, orden: 21 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Centro de reportes', rutaApp: '/reportes', parentId: catId, orden: 22 });
}

async function seedIncidenciasMenus(Menu, adminRoleId) {
  void adminRoleId;
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Incidencias',
    esCategoria: true,
    orden: 35,
    activo: true,
    requiredFeatureKeys: ['incidencias'],
    roles: []
  });

  const items = [
    { menuPrincipal: 'Incidencias', rutaApp: '/incidencias', orden: 36, requiredFeatureKeys: ['incidencias'] },
    { menuPrincipal: 'Pendientes', rutaApp: '/incidencias/pendientes', orden: 37, requiredFeatureKeys: ['incidencias'] },
    { menuPrincipal: 'Vacaciones', rutaApp: '/incidencias/vacaciones', orden: 38, requiredFeatureKeys: ['incidencias'] },
    { menuPrincipal: 'Tipos de incidencia', rutaApp: '/incidencias/tipos', orden: 39, requiredFeatureKeys: ['incidencias'] },
    { menuPrincipal: 'Portal empleado', rutaApp: '/portal', orden: 40, requiredFeatureKeys: ['core'] }
  ];

  for (const item of items) {
    await upsertMenuNode(Menu, {
      ...item,
      parentId: catId,
      activo: true,
      roles: []
    });
  }
}

async function seedAsistenciaMenus(Menu, adminRoleId) {
  let asistenciaCat = await Menu.findOne({ menuPrincipal: 'Asistencia', esCategoria: true }).lean();

  if (!asistenciaCat) {
    asistenciaCat = await Menu.create({
      menuPrincipal: 'Asistencia',
      esCategoria: true,
      orden: 40,
      activo: true,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
    console.log('✓ Categoría Asistencia creada');
  } else {
    await Menu.updateOne(
      { _id: asistenciaCat._id },
      { $set: { activo: true, requiredFeatureKeys: ['asistencia'], roles: [], orden: 40 } }
    );
  }

  const items = [
    { menuPrincipal: 'Turnos', rutaApp: '/asistencia-turnos', orden: 41 },
    { menuPrincipal: 'Plantillas de horario', rutaApp: '/asistencia-rotaciones', orden: 42 },
    { menuPrincipal: 'Asignaciones plantilla', rutaApp: '/asistencia-rotaciones/asignaciones', orden: 43 },
    { menuPrincipal: 'Cambios de turno', rutaApp: '/asistencia-rotaciones/cambios', orden: 44 },
    { menuPrincipal: 'Vista calendario', rutaApp: '/asistencia-rotaciones/matriz', orden: 45 },
    { menuPrincipal: 'Marcaciones', rutaApp: '/asistencia-marcaciones', orden: 46 },
    { menuPrincipal: 'Asistencia del día', rutaApp: '/asistencia-diaria', orden: 47 },
    { menuPrincipal: 'Registro de jornada', rutaApp: '/asistencia-registro-jornada', orden: 48 }
  ];

  for (const item of items) {
    const exists = await Menu.findOne({ rutaApp: item.rutaApp }).lean();
    if (exists) {
      await Menu.updateOne(
        { _id: exists._id },
        {
          $set: {
            menuPrincipal: item.menuPrincipal,
            orden: item.orden,
            parentId: asistenciaCat._id,
            activo: true,
            requiredFeatureKeys: ['asistencia'],
            roles: []
          }
        }
      );
      if (exists.menuPrincipal !== item.menuPrincipal || exists.orden !== item.orden) {
        console.log(`✓ Menú ${item.menuPrincipal} actualizado`);
      }
      continue;
    }
    await Menu.create({
      ...item,
      parentId: asistenciaCat._id,
      activo: true,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
    console.log(`✓ Menú ${item.menuPrincipal} sembrado`);
  }

  const asistenciaCommon = { activo: true, requiredFeatureKeys: ['asistencia'], roles: [] };
  await upsertMenuNode(Menu, {
    ...asistenciaCommon,
    menuPrincipal: 'Catálogos',
    esCategoria: true,
    parentId: asistenciaCat._id,
    orden: 48,
    activo: false
  });
}

async function seedIntegracionesMenus(Menu, adminRoleId) {
  void adminRoleId;
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Integraciones',
    esCategoria: true,
    orden: 25,
    activo: true,
    requiredFeatureKeys: ['integraciones'],
    roles: []
  });

  const items = [
    { menuPrincipal: 'Perfiles', rutaApp: '/integraciones/perfiles', orden: 26 },
    { menuPrincipal: 'Exportar pre-nómina', rutaApp: '/integraciones/exportacion', orden: 27 },
    { menuPrincipal: 'Sync ABC', rutaApp: '/integraciones/abc', orden: 28 },
    { menuPrincipal: 'Logs', rutaApp: '/integraciones/logs', orden: 29 },
    { menuPrincipal: 'Dispositivos', rutaApp: '/integraciones/dispositivos', orden: 30 },
    { menuPrincipal: 'Grupos dispositivos', rutaApp: '/integraciones/grupos-dispositivos', orden: 31 }
  ];

  const common = { activo: true, requiredFeatureKeys: ['integraciones'], roles: [] };
  for (const item of items) {
    await upsertMenuNode(Menu, { ...common, ...item, parentId: catId });
  }
}

async function upsertMenuNode(Menu, data) {
  const filter = {
    menuPrincipal: data.menuPrincipal,
    parentId: data.parentId || null
  };
  const existing = await Menu.findOne(filter).lean();
  if (existing) {
    await Menu.updateOne({ _id: existing._id }, { $set: data });
    return existing._id;
  }
  const created = await Menu.create(data);
  return created._id;
}

async function deactivateLegacyMenus(Menu, parentId, keepNames = []) {
  const keep = new Set(keepNames);
  await Menu.updateMany(
    { parentId, menuPrincipal: { $nin: [...keep] } },
    { $set: { activo: false } }
  );
}

async function deactivateFlatCatalogLeaves(Menu, parentId, names) {
  await Menu.updateMany(
    {
      parentId,
      menuPrincipal: { $in: names },
      esCategoria: { $ne: true },
      rutaApp: { $exists: true, $ne: '' }
    },
    { $set: { activo: false } }
  );
}

const CATALOGOS_ORG_FEATURES = ['personal', 'prenomina', 'nomina', 'asistencia'];

const CATALOGOS_COMPARTIDOS = [
  {
    name: 'Departamentos',
    lista: '/personal-departamentos',
    nuevo: '/personal-departamentos/nuevo'
  },
  {
    name: 'Centro de costos',
    lista: '/prenomina/centros-costo',
    nuevo: '/prenomina/centros-costo/nuevo'
  },
  {
    name: 'Tipos de período',
    lista: '/prenomina/tipos-periodo',
    nuevo: '/prenomina/tipos-periodo/nuevo'
  }
];

async function seedCatalogosOrganizacionales(Menu) {
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Catálogos organizacionales',
    esCategoria: true,
    orden: 27,
    activo: true,
    requiredFeatureKeysAny: CATALOGOS_ORG_FEATURES,
    roles: []
  });

  const common = {
    activo: true,
    requiredFeatureKeysAny: CATALOGOS_ORG_FEATURES,
    roles: []
  };

  await seedCatalogosCompartidosFlat(Menu, catId, common, 271);
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Empleados',
    rutaApp: '/personal-empleados',
    parentId: catId,
    orden: 274
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Períodos',
    rutaApp: '/catalogos/periodos',
    parentId: catId,
    orden: 275
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Generar períodos',
    rutaApp: '/catalogos/periodos/generar',
    parentId: catId,
    orden: 276
  });
}

/** Enlace directo a la lista; "Nuevo" vive en el botón de la pantalla (máx. 3 niveles en sidebar). */
async function seedCatalogosCompartidosFlat(Menu, parentId, common, baseOrden) {
  for (let i = 0; i < CATALOGOS_COMPARTIDOS.length; i++) {
    const cat = CATALOGOS_COMPARTIDOS[i];
    await upsertMenuNode(Menu, {
      ...common,
      menuPrincipal: cat.name,
      rutaApp: cat.lista,
      parentId,
      orden: baseOrden + i,
      esCategoria: false
    });
  }
}

async function cleanupLegacyCatalogMenus(Menu) {
  await Menu.updateMany(
    { menuPrincipal: { $in: ['Lista', 'Nuevo'] }, activo: true },
    { $set: { activo: false } }
  );

  const prenominaCat = await Menu.findOne({ menuPrincipal: 'Pre-nómina', esCategoria: true }).lean();
  if (prenominaCat) {
    await Menu.updateMany(
      { parentId: prenominaCat._id, menuPrincipal: 'Catálogos' },
      { $set: { activo: false } }
    );
    await Menu.updateMany(
      { parentId: prenominaCat._id, menuPrincipal: 'Interfaces' },
      { $set: { activo: false } }
    );
    const configPrenom = await Menu.findOne({
      parentId: prenominaCat._id,
      menuPrincipal: 'Configuraciones',
      esCategoria: true
    }).lean();
    if (configPrenom) {
      await Menu.updateMany(
        {
          parentId: configPrenom._id,
          menuPrincipal: { $in: ['Dispositivos', 'Grupos de dispositivos', 'Logs'] }
        },
        { $set: { activo: false } }
      );
    }
  }

  const asistenciaCat = await Menu.findOne({
    menuPrincipal: 'Asistencia',
    esCategoria: true,
    requiredFeatureKeys: 'asistencia'
  }).lean();
  const asistenciaCat2 = asistenciaCat || (await Menu.findOne({ menuPrincipal: 'Asistencia', esCategoria: true, orden: 40 }).lean());
  if (asistenciaCat2) {
    await Menu.updateMany(
      { parentId: asistenciaCat2._id, menuPrincipal: 'Catálogos' },
      { $set: { activo: false } }
    );
  }

  for (const cat of CATALOGOS_COMPARTIDOS) {
    await Menu.updateMany(
      {
        menuPrincipal: cat.name,
        esCategoria: true,
        activo: true,
        rutaApp: { $in: [null, ''] }
      },
      { $set: { activo: false } }
    );
    await Menu.updateMany(
      {
        menuPrincipal: cat.name,
        rutaApp: { $in: [cat.lista] },
        requiredFeatureKeys: { $eq: ['prenomina'] },
        activo: true
      },
      { $set: { activo: false } }
    );
  }

  await Menu.updateMany(
    { menuPrincipal: 'Sync ABC', rutaApp: '/integraciones/abc', activo: true, requiredFeatureKeys: ['prenomina'] },
    { $set: { activo: false } }
  );

  await Menu.updateMany(
    { menuPrincipal: 'Empleados', rutaApp: '/personal-empleados', requiredFeatureKeys: ['prenomina'], activo: true },
    { $set: { activo: false } }
  );

  const nominaCat = await Menu.findOne({ menuPrincipal: 'Nómina', esCategoria: true }).lean();
  if (nominaCat) {
    const calculoId = await Menu.findOne({
      parentId: nominaCat._id,
      menuPrincipal: 'Cálculo',
      esCategoria: true
    }).lean();
    if (calculoId) {
      await Menu.updateMany(
        {
          parentId: calculoId._id,
          menuPrincipal: 'Cálculo',
          rutaApp: '/nomina/periodos',
          activo: true
        },
        { $set: { activo: false } }
      );
    }
  }

  await deactivateChildrenOfInactiveParents(Menu);
}

/** Evita ítems sueltos al pie del sidebar cuando su padre quedó inactivo. */
async function deactivateChildrenOfInactiveParents(Menu) {
  const inactive = await Menu.find({ activo: false }).select('_id').lean();
  if (!inactive.length) return;
  const ids = inactive.map((m) => m._id);
  let batch = ids;
  for (let round = 0; round < 5 && batch.length; round++) {
    const result = await Menu.updateMany(
      { parentId: { $in: batch }, activo: true },
      { $set: { activo: false } }
    );
    if (!result.modifiedCount) break;
    const newInactive = await Menu.find({ parentId: { $in: batch }, activo: false }).select('_id').lean();
    batch = newInactive.map((m) => m._id);
  }
}

async function seedCatalogosCompartidos(Menu, parentId, common, baseOrden) {
  for (let i = 0; i < CATALOGOS_COMPARTIDOS.length; i++) {
    const cat = CATALOGOS_COMPARTIDOS[i];
    const orden = baseOrden + i;
    const catId = await upsertMenuNode(Menu, {
      ...common,
      menuPrincipal: cat.name,
      esCategoria: true,
      parentId,
      orden
    });
    await upsertMenuNode(Menu, {
      ...common,
      menuPrincipal: 'Lista',
      rutaApp: cat.lista,
      parentId: catId,
      orden: orden * 10 + 1
    });
    await upsertMenuNode(Menu, {
      ...common,
      menuPrincipal: 'Nuevo',
      rutaApp: cat.nuevo,
      parentId: catId,
      orden: orden * 10 + 2
    });
  }
  await deactivateFlatCatalogLeaves(
    Menu,
    parentId,
    CATALOGOS_COMPARTIDOS.map((c) => c.name)
  );
}

async function seedConceptosSubmenu(Menu, parentId, common, baseOrden, listaRuta, nuevoRuta) {
  const catId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Conceptos',
    esCategoria: true,
    parentId,
    orden: baseOrden
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Lista',
    rutaApp: listaRuta,
    parentId: catId,
    orden: baseOrden * 10 + 1
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Nuevo',
    rutaApp: nuevoRuta,
    parentId: catId,
    orden: baseOrden * 10 + 2
  });
  await deactivateFlatCatalogLeaves(Menu, parentId, ['Conceptos']);
}

async function seedPrenominaMenus(Menu, adminRoleId) {
  void adminRoleId;
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Pre-nómina',
    esCategoria: true,
    orden: 30,
    activo: true,
    requiredFeatureKeys: ['prenomina'],
    roles: []
  });

  const common = {
    activo: true,
    requiredFeatureKeys: ['prenomina'],
    roles: []
  };

  const reportesId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Reportes',
    esCategoria: true,
    parentId: catId,
    orden: 31
  });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Dashboard gerencial', rutaApp: '/reportes/kpis', parentId: reportesId, orden: 311 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Reportes y analítica', rutaApp: '/reportes', parentId: reportesId, orden: 312 });

  const catalogosId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Catálogos',
    esCategoria: true,
    parentId: catId,
    orden: 32,
    activo: false
  });
  void catalogosId;

  const configId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Configuraciones',
    esCategoria: true,
    parentId: catId,
    orden: 33
  });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Conceptos', rutaApp: '/prenomina-conceptos', parentId: configId, orden: 334 });

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Interfaces',
    esCategoria: true,
    parentId: catId,
    orden: 34,
    activo: false
  });

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Movimientos',
    rutaApp: '/prenomina/movimientos',
    parentId: catId,
    orden: 35
  });

  const asistenciaId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Asistencia',
    esCategoria: true,
    parentId: catId,
    orden: 36
  });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Períodos', rutaApp: '/prenomina-periodos', parentId: asistenciaId, orden: 361 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Exportar a nómina', rutaApp: '/integraciones/exportacion', parentId: asistenciaId, orden: 362 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Pre-cálculo', rutaApp: '/prenomina-periodos', parentId: asistenciaId, orden: 363 });

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Portal de empleados',
    rutaApp: '/portal',
    parentId: catId,
    orden: 37,
    requiredFeatureKeys: ['core']
  });

  await deactivateLegacyMenus(Menu, catId, [
    'Reportes',
    'Catálogos',
    'Configuraciones',
    'Interfaces',
    'Movimientos',
    'Asistencia',
    'Portal de empleados'
  ]);

  await Menu.updateMany(
    { menuPrincipal: { $in: ['Reporte 1', 'Reporte 2'] }, parentId: reportesId },
    { $set: { activo: false } }
  );
}

async function seedNominaMenus(Menu, adminRoleId) {
  void adminRoleId;
  const catId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Nómina',
    esCategoria: true,
    orden: 33,
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  });

  const common = {
    activo: true,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Inicio nómina',
    rutaApp: '/nomina',
    parentId: catId,
    orden: 34
  });

  const configuracionesId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Configuraciones',
    esCategoria: true,
    parentId: catId,
    orden: 35
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Configuración fiscal',
    rutaApp: '/nomina/configuracion',
    parentId: configuracionesId,
    orden: 350
  });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Tablas', rutaApp: '/nomina/catalogos/tablas-fiscales', parentId: configuracionesId, orden: 351 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Variables', rutaApp: '/nomina/catalogos/parametros', parentId: configuracionesId, orden: 352 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Conceptos', rutaApp: '/nomina/conceptos', parentId: configuracionesId, orden: 353 });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Prestaciones (SDI)',
    rutaApp: '/personal/prestaciones',
    parentId: configuracionesId,
    orden: 354
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Layouts bancarios',
    rutaApp: '/nomina/layouts-bancarios',
    parentId: configuracionesId,
    orden: 356
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Enums sistema',
    rutaApp: '/config-sistema/enums',
    parentId: configuracionesId,
    orden: 355,
    requiredFeatureKeys: ['nomina']
  });
  await Menu.updateMany(
    { rutaApp: '/nomina/placeholder/plantilla' },
    { $set: { activo: false } }
  );
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Funciones de fórmula',
    rutaApp: '/nomina/catalogos/formula-functions',
    parentId: configuracionesId,
    orden: 357
  });

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Reportes',
    rutaApp: '/nomina/reportes',
    parentId: catId,
    orden: 36
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Exportación SUA',
    rutaApp: '/nomina/sua',
    parentId: catId,
    orden: 365
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Confronta Nómina–SUA–IDSE',
    rutaApp: '/nomina/confronta',
    parentId: catId,
    orden: 366
  });

  const calculoId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Cálculo',
    esCategoria: true,
    parentId: catId,
    orden: 37
  });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Períodos y cálculo', rutaApp: '/nomina/periodos', parentId: calculoId, orden: 371 });
  await upsertMenuNode(Menu, { ...common, menuPrincipal: 'Cierre', rutaApp: '/nomina/periodos', parentId: calculoId, orden: 372 });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Pago-dispersión',
    rutaApp: '/nomina/dispersion-bancaria',
    parentId: calculoId,
    orden: 373
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Finiquitos',
    rutaApp: '/nomina/finiquitos',
    parentId: calculoId,
    orden: 374,
    requiredFeatureKeys: ['nomina']
  });

  const timbradoId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Timbrado',
    esCategoria: true,
    parentId: catId,
    orden: 38
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Configuración PAC',
    rutaApp: '/nomina/pac',
    parentId: timbradoId,
    orden: 380
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Recibos PDF',
    rutaApp: '/nomina/recibos-pdf',
    parentId: timbradoId,
    orden: 381
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Timbrador',
    rutaApp: '/nomina/timbrado',
    parentId: timbradoId,
    orden: 382
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Configuración de correo',
    rutaApp: '/nomina/correo',
    parentId: timbradoId,
    orden: 383
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Envío de correo',
    rutaApp: '/nomina/envio-correo',
    parentId: timbradoId,
    orden: 384
  });

  const gestDocId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Gestión documental',
    esCategoria: true,
    parentId: catId,
    orden: 385,
    requiredFeatureKeys: ['gestion_documental']
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Cumplimiento',
    rutaApp: '/nomina/gestion-documental',
    parentId: gestDocId,
    orden: 386,
    requiredFeatureKeys: ['gestion_documental']
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Expediente',
    rutaApp: '/nomina/gestion-documental/expediente',
    parentId: gestDocId,
    orden: 387,
    requiredFeatureKeys: ['gestion_documental']
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Subir documento',
    rutaApp: '/nomina/gestion-documental/subir',
    parentId: gestDocId,
    orden: 388,
    requiredFeatureKeys: ['gestion_documental']
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Cobertura / reportes',
    rutaApp: '/nomina/gestion-documental/reporte',
    parentId: gestDocId,
    orden: 389,
    requiredFeatureKeys: ['gestion_documental']
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Config. storage',
    rutaApp: '/nomina/gestion-documental/config',
    parentId: gestDocId,
    orden: 390,
    requiredFeatureKeys: ['gestion_documental']
  });

  await Menu.updateMany(
    { rutaApp: { $in: ['/nomina/placeholder/timbrador'] }, parentId: timbradoId },
    { $set: { activo: false } }
  );

  const nominaCatalogosId = await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Catálogos',
    esCategoria: true,
    parentId: catId,
    orden: 39
  });
  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'Índice fiscal',
    rutaApp: '/nomina/catalogos',
    parentId: nominaCatalogosId,
    orden: 391
  });

  await Menu.updateMany(
    { menuPrincipal: 'Catálogos', rutaApp: '/nomina/catalogos', parentId: catId },
    { $set: { activo: false } }
  );

  await upsertMenuNode(Menu, {
    ...common,
    menuPrincipal: 'APIs',
    rutaApp: '/nomina/placeholder/apis',
    parentId: catId,
    orden: 40
  });

  await deactivateLegacyMenus(Menu, catId, [
    'Inicio nómina',
    'Configuraciones',
    'Reportes',
    'Cálculo',
    'Timbrado',
    'Gestión documental',
    'Catálogos',
    'APIs'
  ]);
}

async function seedPersonalMenus(Menu, adminRoleId) {
  void adminRoleId;
  const personalCatId = await upsertMenuNode(Menu, {
    menuPrincipal: 'Personal',
    esCategoria: true,
    orden: 50,
    activo: true,
    requiredFeatureKeys: ['personal'],
    roles: []
  });

  const personalItems = [
    { menuPrincipal: 'Tipos mov. laboral', rutaApp: '/personal/tipos-movimiento-laboral', orden: 52 },
    { menuPrincipal: 'Puestos', rutaApp: '/personal-puestos', orden: 54 },
    { menuPrincipal: 'Empresa', rutaApp: '/config-empresa', orden: 55 },
    { menuPrincipal: 'Cargas iniciales', rutaApp: '/config-empresa/cargas', orden: 56 },
    { menuPrincipal: 'Créditos / saldos (próx.)', rutaApp: '/config-empresa/cargas/creditos-saldos', orden: 57 }
  ];

  for (const item of personalItems) {
    await upsertMenuNode(Menu, {
      ...item,
      parentId: personalCatId,
      activo: true,
      requiredFeatureKeys: ['personal'],
      roles: []
    });
  }

  await Menu.updateMany(
    {
      parentId: personalCatId,
      menuPrincipal: { $in: ['Empleados', 'Departamentos'] },
      rutaApp: { $in: ['/personal-empleados', '/personal-departamentos'] }
    },
    { $set: { activo: false } }
  );
}

/**
 * Módulos operativos: visibilidad por feature flags del tenant.
 * Solo Configuración (usuarios/roles/subsidiarias) exige rol Admin.
 */
async function syncOperationalMenuRoles(Menu, adminRoleId) {
  const configAdminRoutes = ['/config-users', '/config-roles', '/config-subsidiarias'];

  await Menu.updateMany({ activo: true }, { $set: { roles: [] } });

  if (adminRoleId) {
    await Menu.updateMany(
      {
        activo: true,
        $or: [
          { rutaApp: { $in: configAdminRoutes } },
          {
            menuPrincipal: 'Configuración',
            esCategoria: true,
            requiredFeatureKeys: 'config_admin'
          }
        ]
      },
      { $set: { roles: [adminRoleId] } }
    );
  }
}

async function main() {
  const uri = dbConfig.connectionStringConfig;
  console.log('Conectando a', uri);
  await mongoose.connect(uri);
  const conn = mongoose.connection;

  const adminRole = await seedRoles(conn);
  await seedMenus(conn, adminRole?._id);

  await mongoose.disconnect();
  console.log('Seed completado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
