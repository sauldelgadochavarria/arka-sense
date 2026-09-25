'use strict';

/**
 * Reorganiza menús según paquetes comerciales.
 * Idempotente: se invoca desde seed.js en cada corrida.
 */

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

/** Mueve o crea por rutaApp (evita duplicados al cambiar de padre). */
async function upsertByRuta(Menu, data) {
  if (!data.rutaApp) return upsertMenuNode(Menu, data);
  const byRuta = await Menu.findOne({ rutaApp: data.rutaApp, activo: { $ne: false } }).lean();
  const any = byRuta || (await Menu.findOne({ rutaApp: data.rutaApp }).lean());
  if (any) {
    await Menu.updateOne({ _id: any._id }, { $set: data });
    return any._id;
  }
  return upsertMenuNode(Menu, data);
}

async function setRootMeta(Menu, name, meta) {
  await Menu.updateMany(
    { menuPrincipal: name, esCategoria: true, parentId: null },
    { $set: meta }
  );
}

async function reorganizeMenuPackages(Menu, adminRoleId) {
  // —— Metadatos de raíces ——
  await setRootMeta(Menu, 'Inicio', { orden: 1, modulePackage: 'nucleo', activo: true, requiredFeatureKeys: ['core'] });
  await setRootMeta(Menu, 'Personal', {
    orden: 10,
    modulePackage: 'nucleo',
    activo: true,
    requiredFeatureKeys: ['personal']
  });
  await setRootMeta(Menu, 'Asistencia', {
    orden: 20,
    modulePackage: 'asistencia_prenomina',
    activo: true,
    requiredFeatureKeys: ['asistencia']
  });
  await setRootMeta(Menu, 'Pre-nómina', {
    orden: 21,
    modulePackage: 'asistencia_prenomina',
    activo: true,
    requiredFeatureKeys: ['prenomina']
  });
  await setRootMeta(Menu, 'Incidencias', {
    orden: 22,
    modulePackage: 'asistencia_prenomina',
    activo: true,
    requiredFeatureKeys: ['incidencias']
  });
  await setRootMeta(Menu, 'Nómina', {
    orden: 30,
    modulePackage: 'nomina',
    activo: true,
    requiredFeatureKeys: ['nomina']
  });
  // Núcleo administrativo al final del sidebar
  await setRootMeta(Menu, 'Configuración', {
    orden: 90,
    modulePackage: 'nucleo',
    activo: true,
    requiredFeatureKeys: ['config_admin']
  });
  await setRootMeta(Menu, 'Integraciones', {
    orden: 91,
    modulePackage: 'nucleo',
    activo: true,
    requiredFeatureKeys: ['integraciones']
  });
  await setRootMeta(Menu, 'Ayuda', {
    orden: 92,
    modulePackage: 'nucleo',
    activo: true,
    requiredFeatureKeys: ['core']
  });

  // Raíz Reportes y Catálogos org → desactivar (contenido vive en Pre-nómina / Personal)
  await setRootMeta(Menu, 'Reportes', { activo: false, orden: 999 });
  await setRootMeta(Menu, 'Catálogos organizacionales', { activo: false, orden: 998 });

  const personal = await Menu.findOne({ menuPrincipal: 'Personal', esCategoria: true, parentId: null }).lean();
  const config = await Menu.findOne({ menuPrincipal: 'Configuración', esCategoria: true, parentId: null }).lean();
  const integraciones = await Menu.findOne({ menuPrincipal: 'Integraciones', esCategoria: true, parentId: null }).lean();
  const asistencia = await Menu.findOne({ menuPrincipal: 'Asistencia', esCategoria: true, parentId: null }).lean();
  const incidencias = await Menu.findOne({ menuPrincipal: 'Incidencias', esCategoria: true, parentId: null }).lean();
  const prenomina = await Menu.findOne({ menuPrincipal: 'Pre-nómina', esCategoria: true, parentId: null }).lean();
  const nomina = await Menu.findOne({ menuPrincipal: 'Nómina', esCategoria: true, parentId: null }).lean();

  // —— Personal / Organización ——
  if (personal) {
    const pCommon = { activo: true, requiredFeatureKeys: ['personal'], roles: [] };
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Empleados',
      rutaApp: '/personal-empleados',
      parentId: personal._id,
      orden: 10,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Departamentos',
      rutaApp: '/personal-departamentos',
      parentId: personal._id,
      orden: 11
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Puestos',
      rutaApp: '/personal-puestos',
      parentId: personal._id,
      orden: 12
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Empresa',
      rutaApp: '/config-empresa',
      parentId: personal._id,
      orden: 13
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Cargas iniciales',
      rutaApp: '/config-empresa/cargas',
      parentId: personal._id,
      orden: 14
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Tipos mov. laboral',
      rutaApp: '/personal/tipos-movimiento-laboral',
      parentId: personal._id,
      orden: 15
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Ajuste anual de sueldos',
      rutaApp: '/personal/ajuste-anual',
      parentId: personal._id,
      orden: 16
    });
    await upsertByRuta(Menu, {
      menuPrincipal: 'Portal de empleados',
      rutaApp: '/portal',
      parentId: personal._id,
      orden: 17,
      activo: true,
      requiredFeatureKeys: ['core'],
      roles: [],
      esCategoria: false
    });
    await Menu.updateMany(
      {
        parentId: personal._id,
        menuPrincipal: 'Créditos / saldos (próx.)'
      },
      { $set: { activo: false } }
    );
  }

  // —— Configuración ——
  if (config) {
    const cCommon = {
      activo: true,
      requiredFeatureKeys: ['config_admin'],
      roles: adminRoleId ? [adminRoleId] : []
    };
    await upsertByRuta(Menu, {
      ...cCommon,
      menuPrincipal: 'Usuarios',
      rutaApp: '/config-users',
      parentId: config._id,
      orden: 10
    });
    await upsertByRuta(Menu, {
      ...cCommon,
      menuPrincipal: 'Roles',
      rutaApp: '/config-roles',
      parentId: config._id,
      orden: 11
    });
    await upsertByRuta(Menu, {
      ...cCommon,
      menuPrincipal: 'Subsidiarias',
      rutaApp: '/config-subsidiarias',
      parentId: config._id,
      orden: 12
    });
    await upsertByRuta(Menu, {
      ...cCommon,
      menuPrincipal: 'Enums sistema',
      rutaApp: '/config-sistema/enums',
      parentId: config._id,
      orden: 14,
      requiredFeatureKeys: ['config_admin']
    });
    // Puntos de acceso vive en Asistencia (no en Config)
    await Menu.updateMany(
      { parentId: config._id, menuPrincipal: 'Puntos de acceso' },
      { $set: { activo: false } }
    );
  }

  // —— Integraciones (solo genéricas) ——
  if (integraciones) {
    const iCommon = { activo: true, requiredFeatureKeys: ['integraciones'], roles: [] };
    await upsertByRuta(Menu, {
      ...iCommon,
      menuPrincipal: 'Perfiles',
      rutaApp: '/integraciones/perfiles',
      parentId: integraciones._id,
      orden: 10
    });
    await upsertByRuta(Menu, {
      ...iCommon,
      menuPrincipal: 'Logs',
      rutaApp: '/integraciones/logs',
      parentId: integraciones._id,
      orden: 11
    });
    await Menu.updateMany(
      {
        parentId: integraciones._id,
        menuPrincipal: {
          $in: ['Exportar pre-nómina', 'Sync ABC', 'Dispositivos', 'Grupos dispositivos']
        }
      },
      { $set: { activo: false } }
    );
  }

  // —— Asistencia (+ checadores / geocercas) ——
  if (asistencia) {
    const aCommon = { activo: true, requiredFeatureKeys: ['asistencia'], roles: [] };
    const checadorCommon = {
      activo: true,
      requiredFeatureKeysAny: ['asistencia', 'integraciones'],
      requiredFeatureKeys: [],
      roles: []
    };
    await upsertByRuta(Menu, {
      ...aCommon,
      menuPrincipal: 'Puntos de acceso',
      rutaApp: '/config-puntos-acceso',
      parentId: asistencia._id,
      orden: 49,
      requiredFeatureKeys: ['asistencia'],
      roles: []
    });
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Dispositivos',
      rutaApp: '/integraciones/dispositivos',
      parentId: asistencia._id,
      orden: 90
    });
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Grupos dispositivos',
      rutaApp: '/integraciones/grupos-dispositivos',
      parentId: asistencia._id,
      orden: 91
    });
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Sync ABC',
      rutaApp: '/integraciones/abc',
      parentId: asistencia._id,
      orden: 92
    });
  }

  // —— Incidencias: un solo portal (en Personal) ——
  if (incidencias) {
    await Menu.updateMany(
      { parentId: incidencias._id, rutaApp: '/portal' },
      { $set: { activo: false } }
    );
  }

  // —— Pre-nómina ——
  if (prenomina) {
    const prCommon = { activo: true, requiredFeatureKeys: ['prenomina'], roles: [] };
    const orgAny = {
      activo: true,
      requiredFeatureKeysAny: ['personal', 'prenomina', 'nomina', 'asistencia'],
      requiredFeatureKeys: [],
      roles: []
    };

    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Períodos',
      rutaApp: '/prenomina-periodos',
      parentId: prenomina._id,
      orden: 10
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Movimientos',
      rutaApp: '/prenomina/movimientos',
      parentId: prenomina._id,
      orden: 11
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Conceptos',
      rutaApp: '/prenomina-conceptos',
      parentId: prenomina._id,
      orden: 12
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Centro de costos',
      rutaApp: '/prenomina/centros-costo',
      parentId: prenomina._id,
      orden: 13
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Tipos de período',
      rutaApp: '/prenomina/tipos-periodo',
      parentId: prenomina._id,
      orden: 14
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Exportar a nómina',
      rutaApp: '/integraciones/exportacion',
      parentId: prenomina._id,
      orden: 15
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Períodos (catálogo)',
      rutaApp: '/catalogos/periodos',
      parentId: prenomina._id,
      orden: 17
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Generar períodos',
      rutaApp: '/catalogos/periodos/generar',
      parentId: prenomina._id,
      orden: 18
    });

    const reportesId = await upsertMenuNode(Menu, {
      ...prCommon,
      menuPrincipal: 'Reportes',
      esCategoria: true,
      parentId: prenomina._id,
      orden: 16
    });
    await upsertMenuNode(Menu, {
      ...prCommon,
      menuPrincipal: 'Dashboard gerencial',
      rutaApp: '/reportes/kpis',
      parentId: reportesId,
      orden: 161,
      requiredFeatureKeys: ['reportes']
    });
    await upsertMenuNode(Menu, {
      ...prCommon,
      menuPrincipal: 'Reportes y analítica',
      rutaApp: '/reportes',
      parentId: reportesId,
      orden: 162,
      requiredFeatureKeys: ['reportes']
    });

    // Desactivar subárbol legacy Pre-nómina → Asistencia / Portal / Config anidada
    await Menu.updateMany(
      {
        parentId: prenomina._id,
        menuPrincipal: { $in: ['Asistencia', 'Portal de empleados', 'Configuraciones', 'Catálogos', 'Interfaces'] }
      },
      { $set: { activo: false } }
    );
    await Menu.updateMany(
      { menuPrincipal: 'Pre-cálculo', rutaApp: '/prenomina-periodos' },
      { $set: { activo: false } }
    );
  }

  // —— Nómina ——
  if (nomina) {
    const nCommon = { activo: true, requiredFeatureKeys: ['nomina'], roles: [] };

    // Enums ya no bajo Nómina
    await Menu.updateMany(
      { parentId: { $exists: true }, rutaApp: '/config-sistema/enums', requiredFeatureKeys: ['nomina'] },
      { $set: { activo: false } }
    );
    // También desactivar el que estaba bajo Configuraciones de nómina por nombre
    const nomConfig =
      (await Menu.findOne({
        parentId: nomina._id,
        menuPrincipal: 'Configuración de nómina',
        esCategoria: true
      }).lean()) ||
      (await Menu.findOne({
        parentId: nomina._id,
        menuPrincipal: 'Configuraciones',
        esCategoria: true
      }).lean());
    if (nomConfig) {
      await Menu.updateMany(
        { parentId: nomConfig._id, menuPrincipal: 'Enums sistema' },
        { $set: { activo: false } }
      );
      await Menu.updateOne(
        { _id: nomConfig._id },
        { $set: { menuPrincipal: 'Configuración de nómina', orden: 20, activo: true } }
      );
    }

    const calculo = await Menu.findOne({
      parentId: nomina._id,
      menuPrincipal: 'Cálculo',
      esCategoria: true
    }).lean();
    if (calculo) {
      await Menu.updateMany(
        { parentId: calculo._id, menuPrincipal: 'Cierre' },
        { $set: { activo: false } }
      );
      await Menu.updateOne({ _id: calculo._id }, { $set: { orden: 10 } });
    }

    await upsertByRuta(Menu, {
      ...nCommon,
      menuPrincipal: 'Inicio nómina',
      rutaApp: '/nomina',
      parentId: nomina._id,
      orden: 1
    });

    // Cumplimiento: SUA + Confronta + gestión documental
    const cumplId = await upsertMenuNode(Menu, {
      ...nCommon,
      menuPrincipal: 'Cumplimiento',
      esCategoria: true,
      parentId: nomina._id,
      orden: 40
    });
    await upsertByRuta(Menu, {
      ...nCommon,
      menuPrincipal: 'Exportación SUA',
      rutaApp: '/nomina/sua',
      parentId: cumplId,
      orden: 41
    });
    await upsertByRuta(Menu, {
      ...nCommon,
      menuPrincipal: 'Confronta Nómina–SUA–IDSE',
      rutaApp: '/nomina/confronta',
      parentId: cumplId,
      orden: 42
    });

    // Mover hijos de Gestión documental bajo Cumplimiento (o dejar categoría anidada)
    const gestDoc = await Menu.findOne({
      parentId: nomina._id,
      menuPrincipal: 'Gestión documental',
      esCategoria: true
    }).lean();
    if (gestDoc) {
      await Menu.updateOne(
        { _id: gestDoc._id },
        { $set: { parentId: cumplId, orden: 43, requiredFeatureKeys: ['gestion_documental'] } }
      );
    }

    // Desactivar duplicados SUA/Confronta en raíz de Nómina (si quedaron)
    await Menu.updateMany(
      {
        parentId: nomina._id,
        menuPrincipal: { $in: ['Exportación SUA', 'Confronta Nómina–SUA–IDSE'] }
      },
      { $set: { activo: false } }
    );

    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Timbrado', esCategoria: true },
      { $set: { orden: 30 } }
    );
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Reportes', rutaApp: '/nomina/reportes' },
      { $set: { orden: 50 } }
    );
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'APIs' },
      { $set: { orden: 60 } }
    );
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Catálogos', esCategoria: true },
      { $set: { orden: 55 } }
    );
  }

  // Un solo Portal: bajo Personal
  if (personal) {
    await Menu.updateMany(
      { rutaApp: '/portal', parentId: { $ne: personal._id } },
      { $set: { activo: false } }
    );
  }

  // Cascada: hijos de padres inactivos
  const inactive = await Menu.find({ activo: false }).select('_id').lean();
  let batch = inactive.map((m) => m._id);
  for (let round = 0; round < 5 && batch.length; round++) {
    const result = await Menu.updateMany(
      { parentId: { $in: batch }, activo: true },
      { $set: { activo: false } }
    );
    if (!result.modifiedCount) break;
    const next = await Menu.find({ parentId: { $in: batch }, activo: false }).select('_id').lean();
    batch = next.map((m) => m._id);
  }

  console.log('✓ Menús reorganizados por paquetes (Núcleo / Asistencia-Prenómina / Nómina)');
}

module.exports = { reorganizeMenuPackages, upsertMenuNode, upsertByRuta };
