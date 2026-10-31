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

async function ensureGroup(Menu, parentId, menuPrincipal, orden, extra = {}) {
  return upsertMenuNode(Menu, {
    menuPrincipal,
    esCategoria: true,
    parentId,
    orden,
    activo: true,
    rutaApp: '',
    roles: [],
    ...extra
  });
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
    const pCommon = { activo: true, requiredFeatureKeys: ['personal'], roles: [], esCategoria: false };
    const personalOps = await ensureGroup(Menu, personal._id, 'Operación', 10, {
      requiredFeatureKeys: ['personal']
    });
    const personalCfg = await ensureGroup(Menu, personal._id, 'Configuración', 40, {
      requiredFeatureKeys: ['personal']
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Empleados',
      rutaApp: '/personal-empleados',
      parentId: personalOps,
      orden: 10
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Portal de empleados',
      rutaApp: '/portal',
      parentId: personalOps,
      orden: 20,
      requiredFeatureKeys: ['core']
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Ajuste anual de sueldos',
      rutaApp: '/personal/ajuste-anual',
      parentId: personalOps,
      orden: 30
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Departamentos',
      rutaApp: '/personal-departamentos',
      parentId: personalCfg,
      orden: 10
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Puestos',
      rutaApp: '/personal-puestos',
      parentId: personalCfg,
      orden: 20
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Tipos mov. laboral',
      rutaApp: '/personal/tipos-movimiento-laboral',
      parentId: personalCfg,
      orden: 30
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Empresa',
      rutaApp: '/config-empresa',
      parentId: personalCfg,
      orden: 40
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Cargas iniciales',
      rutaApp: '/config-empresa/cargas',
      parentId: personalCfg,
      orden: 50
    });
    await upsertByRuta(Menu, {
      ...pCommon,
      menuPrincipal: 'Históricos CFDI',
      rutaApp: '/config-empresa/cargas/cfdi_nomina_zip_masivo',
      parentId: personalCfg,
      orden: 60
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
    const aCommon = { activo: true, requiredFeatureKeys: ['asistencia'], roles: [], esCategoria: false };
    const checadorCommon = {
      activo: true,
      requiredFeatureKeysAny: ['asistencia', 'integraciones'],
      requiredFeatureKeys: [],
      roles: [],
      esCategoria: false
    };
    const asistenciaOps = await ensureGroup(Menu, asistencia._id, 'Operación', 10, {
      requiredFeatureKeys: ['asistencia']
    });
    const asistenciaCfg = await ensureGroup(Menu, asistencia._id, 'Configuración', 40, {
      requiredFeatureKeys: ['asistencia']
    });
    const ops = [
      ['Inicio asistencia', '/asistencia', 10],
      ['Marcaciones', '/asistencia-marcaciones', 20],
      ['Asistencia del día', '/asistencia-diaria', 30],
      ['Autorizaciones', '/asistencia-autorizaciones', 40],
      ['Registro de jornada', '/asistencia-registro-jornada', 50]
    ];
    for (const [menuPrincipal, rutaApp, orden] of ops) {
      await upsertByRuta(Menu, { ...aCommon, menuPrincipal, rutaApp, parentId: asistenciaOps, orden });
    }
    const cfg = [
      ['Turnos', '/asistencia-turnos', 10],
      ['Plantillas de horario', '/asistencia-rotaciones', 20],
      ['Asignaciones plantilla', '/asistencia-rotaciones/asignaciones', 30],
      ['Cambios de turno', '/asistencia-rotaciones/cambios', 40],
      ['Vista calendario', '/asistencia-rotaciones/matriz', 50],
      ['Zonas', '/config-zonas', 60],
      ['Puntos de acceso', '/config-puntos-acceso', 70]
    ];
    for (const [menuPrincipal, rutaApp, orden] of cfg) {
      await upsertByRuta(Menu, { ...aCommon, menuPrincipal, rutaApp, parentId: asistenciaCfg, orden });
    }
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Dispositivos',
      rutaApp: '/integraciones/dispositivos',
      parentId: asistenciaCfg,
      orden: 80
    });
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Grupos dispositivos',
      rutaApp: '/integraciones/grupos-dispositivos',
      parentId: asistenciaCfg,
      orden: 90
    });
    await upsertByRuta(Menu, {
      ...checadorCommon,
      menuPrincipal: 'Sync ABC',
      rutaApp: '/integraciones/abc',
      parentId: asistenciaCfg,
      orden: 100
    });
  }

  // —— Incidencias: un solo portal (en Personal) ——
  if (incidencias) {
    await Menu.updateMany(
      { parentId: incidencias._id, rutaApp: '/portal' },
      { $set: { activo: false } }
    );
    const incOps = await ensureGroup(Menu, incidencias._id, 'Operación', 10, {
      requiredFeatureKeys: ['incidencias']
    });
    const incCfg = await ensureGroup(Menu, incidencias._id, 'Configuración', 40, {
      requiredFeatureKeys: ['incidencias']
    });
    const incCommon = { activo: true, requiredFeatureKeys: ['incidencias'], roles: [], esCategoria: false };
    await upsertByRuta(Menu, { ...incCommon, menuPrincipal: 'Incidencias', rutaApp: '/incidencias', parentId: incOps, orden: 10 });
    await upsertByRuta(Menu, { ...incCommon, menuPrincipal: 'Pendientes', rutaApp: '/incidencias/pendientes', parentId: incOps, orden: 20 });
    await upsertByRuta(Menu, {
      ...incCommon,
      menuPrincipal: 'Vacaciones',
      rutaApp: '/incidencias/vacaciones',
      parentId: incOps,
      orden: 30,
      requiredFeatureKeys: ['vacaciones']
    });
    await upsertByRuta(Menu, {
      ...incCommon,
      menuPrincipal: 'Tipos de incidencia',
      rutaApp: '/incidencias/tipos',
      parentId: incCfg,
      orden: 10
    });
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

    const prenOps = await ensureGroup(Menu, prenomina._id, 'Operación', 10, {
      requiredFeatureKeys: ['prenomina']
    });
    const prenCfg = await ensureGroup(Menu, prenomina._id, 'Configuración', 20, {
      requiredFeatureKeys: ['prenomina']
    });

    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Períodos',
      rutaApp: '/prenomina-periodos',
      parentId: prenOps,
      orden: 10,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Movimientos',
      rutaApp: '/prenomina/movimientos',
      parentId: prenOps,
      orden: 20,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Exportar a nómina',
      rutaApp: '/integraciones/exportacion',
      parentId: prenOps,
      orden: 30,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...prCommon,
      menuPrincipal: 'Conceptos',
      rutaApp: '/prenomina-conceptos',
      parentId: prenCfg,
      orden: 10,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Centro de costos',
      rutaApp: '/prenomina/centros-costo',
      parentId: prenCfg,
      orden: 20,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Tipos de período',
      rutaApp: '/prenomina/tipos-periodo',
      parentId: prenCfg,
      orden: 30,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Períodos (catálogo)',
      rutaApp: '/catalogos/periodos',
      parentId: prenCfg,
      orden: 40,
      esCategoria: false
    });
    await upsertByRuta(Menu, {
      ...orgAny,
      menuPrincipal: 'Generar períodos',
      rutaApp: '/catalogos/periodos/generar',
      parentId: prenCfg,
      orden: 50,
      esCategoria: false
    });

    const reportesId = await upsertMenuNode(Menu, {
      ...prCommon,
      menuPrincipal: 'Reportes',
      esCategoria: true,
      parentId: prenomina._id,
      orden: 30
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
        { $set: { menuPrincipal: 'Configuración de nómina', orden: 80, activo: true } }
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

    // Gestión documental al nivel de Nómina: el menú solo pinta dos niveles.
    const gestDocs = await Menu.find({
      menuPrincipal: 'Gestión documental',
      esCategoria: true,
      activo: true
    }).lean();
    let keeper = null;
    for (const g of gestDocs) {
      const n = await Menu.countDocuments({ parentId: g._id, activo: { $ne: false } });
      if (!keeper || n > keeper.n) keeper = { id: g._id, n };
    }
    if (keeper) {
      await Menu.updateOne(
        { _id: keeper.id },
        { $set: { parentId: nomina._id, orden: 45, activo: true, requiredFeatureKeys: ['gestion_documental'] } }
      );
      const dupIds = gestDocs.filter((g) => String(g._id) !== String(keeper.id)).map((g) => g._id);
      if (dupIds.length) await Menu.updateMany({ _id: { $in: dupIds } }, { $set: { activo: false } });
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
      { $set: { orden: 20 } }
    );
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Reportes', rutaApp: '/nomina/reportes' },
      { $set: { orden: 50 } }
    );
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Acumulados' },
      { $set: { orden: 51, parentId: nomina._id } }
    );
    if (nomConfig) {
      await upsertByRuta(Menu, {
        ...nCommon,
        menuPrincipal: 'Tipos de período',
        rutaApp: '/nomina/tipos-periodo',
        parentId: nomConfig._id,
        orden: 10,
        esCategoria: false
      });
      await upsertByRuta(Menu, {
        ...nCommon,
        menuPrincipal: 'Configuración PAC',
        rutaApp: '/nomina/pac',
        parentId: nomConfig._id,
        orden: 80,
        esCategoria: false
      });
      await upsertByRuta(Menu, {
        ...nCommon,
        menuPrincipal: 'Configuración de correo',
        rutaApp: '/nomina/correo',
        parentId: nomConfig._id,
        orden: 81,
        esCategoria: false
      });
      await upsertByRuta(Menu, {
        ...nCommon,
        menuPrincipal: 'APIs',
        rutaApp: '/nomina/placeholder/apis',
        parentId: nomConfig._id,
        orden: 90,
        esCategoria: false
      });
    }
    await Menu.updateOne(
      { parentId: nomina._id, menuPrincipal: 'Catálogos', esCategoria: true },
      { $set: { orden: 55 } }
    );
  }

  // Un solo Portal: bajo Personal
  if (personal) {
    const underPersonal = await Menu.find({ parentId: personal._id }).select('_id').lean();
    const personalIds = [personal._id, ...underPersonal.map((g) => g._id)];
    await Menu.updateMany(
      { rutaApp: '/portal', parentId: { $nin: personalIds } },
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
