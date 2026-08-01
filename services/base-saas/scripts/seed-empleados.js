#!/usr/bin/env node
'use strict';

/**
 * Seed de empleados de demostración para un tenant.
 *
 * Uso:
 *   npm run seed:empleados
 *   npm run seed:empleados -- --tenant=empresa-demo
 *   npm run seed:empleados -- --subsidiaria=SUR
 *   npm run seed:empleados -- --subsidiaria=all
 *   npm run seed:empleados -- --force
 *
 * Variables de entorno:
 *   SEED_TENANT_SLUG — slug del tenant (alternativa a --tenant)
 *   SEED_SUBSIDIARIA — MAIN | SUR | all (alternativa a --subsidiaria)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const {
  COLLECTION_EMPLEADOS,
  COLLECTION_DEPARTAMENTOS,
  COLLECTION_PUESTOS,
  COLLECTION_TURNOS
} = require('../config/constants');

const DEPARTAMENTOS = [
  'Dirección General',
  'Recursos Humanos',
  'Tecnología',
  'Operaciones',
  'Ventas'
];

const PUESTOS = [
  { nombre: 'Director General', depto: 'Dirección General' },
  { nombre: 'Gerente de RH', depto: 'Recursos Humanos' },
  { nombre: 'Analista de Nómina', depto: 'Recursos Humanos' },
  { nombre: 'Desarrollador', depto: 'Tecnología' },
  { nombre: 'Soporte TI', depto: 'Tecnología' },
  { nombre: 'Supervisor de Planta', depto: 'Operaciones' },
  { nombre: 'Operador', depto: 'Operaciones' },
  { nombre: 'Ejecutivo de Ventas', depto: 'Ventas' },
  { nombre: 'Auxiliar Administrativo', depto: 'Recursos Humanos' }
];

const EMPLEADOS = [
  {
    numEmpleado: '001',
    firstName: 'Roberto',
    lastName: 'Vargas Herrera',
    sexo: 'M',
    depto: 'Dirección General',
    puesto: 'Director General',
    salarioDiario: 850,
    fechaIngreso: '2018-03-15',
    fechaNacimiento: '1975-08-22',
    supervisorNum: null
  },
  {
    numEmpleado: '002',
    firstName: 'María',
    lastName: 'López García',
    sexo: 'F',
    depto: 'Recursos Humanos',
    puesto: 'Gerente de RH',
    salarioDiario: 620,
    fechaIngreso: '2019-01-10',
    fechaNacimiento: '1982-04-11',
    supervisorNum: '001'
  },
  {
    numEmpleado: '003',
    firstName: 'Jorge',
    lastName: 'Martínez Ruiz',
    sexo: 'M',
    depto: 'Recursos Humanos',
    puesto: 'Analista de Nómina',
    salarioDiario: 480,
    fechaIngreso: '2020-06-01',
    fechaNacimiento: '1990-11-30',
    supervisorNum: '002'
  },
  {
    numEmpleado: '004',
    firstName: 'Laura',
    lastName: 'Hernández Díaz',
    sexo: 'F',
    depto: 'Recursos Humanos',
    puesto: 'Auxiliar Administrativo',
    salarioDiario: 380,
    fechaIngreso: '2022-02-14',
    fechaNacimiento: '1995-07-08',
    supervisorNum: '002'
  },
  {
    numEmpleado: '005',
    firstName: 'Diego',
    lastName: 'Ramírez Soto',
    sexo: 'M',
    depto: 'Tecnología',
    puesto: 'Desarrollador',
    salarioDiario: 520,
    fechaIngreso: '2021-09-20',
    fechaNacimiento: '1993-02-17',
    supervisorNum: '001'
  },
  {
    numEmpleado: '006',
    firstName: 'Patricia',
    lastName: 'Morales Vega',
    sexo: 'F',
    depto: 'Tecnología',
    puesto: 'Soporte TI',
    salarioDiario: 420,
    fechaIngreso: '2023-01-09',
    fechaNacimiento: '1998-12-03',
    supervisorNum: '005'
  },
  {
    numEmpleado: '007',
    firstName: 'Fernando',
    lastName: 'Castillo Núñez',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Supervisor de Planta',
    salarioDiario: 490,
    fechaIngreso: '2017-11-05',
    fechaNacimiento: '1984-05-19',
    supervisorNum: '001'
  },
  {
    numEmpleado: '008',
    firstName: 'Sofía',
    lastName: 'Jiménez Cruz',
    sexo: 'F',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 350,
    fechaIngreso: '2024-03-18',
    fechaNacimiento: '2000-01-25',
    supervisorNum: '007'
  },
  {
    numEmpleado: '009',
    firstName: 'Ricardo',
    lastName: 'Ortega Pineda',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 350,
    fechaIngreso: '2024-05-02',
    fechaNacimiento: '1999-09-14',
    supervisorNum: '007'
  },
  {
    numEmpleado: '010',
    firstName: 'Gabriela',
    lastName: 'Torres Medina',
    sexo: 'F',
    depto: 'Ventas',
    puesto: 'Ejecutivo de Ventas',
    salarioDiario: 400,
    fechaIngreso: '2022-08-22',
    fechaNacimiento: '1994-06-07',
    supervisorNum: '001'
  },
  {
    numEmpleado: '011',
    firstName: 'Andrés',
    lastName: 'Silva Rojas',
    sexo: 'M',
    depto: 'Ventas',
    puesto: 'Ejecutivo de Ventas',
    salarioDiario: 400,
    fechaIngreso: '2023-10-16',
    fechaNacimiento: '1996-03-28',
    supervisorNum: '010'
  },
  {
    numEmpleado: '012',
    firstName: 'Valentina',
    lastName: 'Mendoza Flores',
    sexo: 'F',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 340,
    fechaIngreso: '2025-01-06',
    fechaNacimiento: '2001-10-12',
    supervisorNum: '007'
  }
];

const SUBSIDIARIAS = {
  MAIN: {
    codigo: 'MAIN',
    nombreSuffix: 'Principal',
    direccion: 'Av. Demo 100, CDMX',
    ciudad: 'Ciudad de México',
    estado: 'CDMX',
    codigoPostal: '06600'
  },
  SUR: {
    codigo: 'SUR',
    nombreSuffix: 'Planta Sur',
    direccion: 'Blvd. Industrial 450, Parque Sur',
    ciudad: 'Querétaro',
    estado: 'Qro.',
    codigoPostal: '76130'
  }
};

/** Empleados de la subsidiaria SUR (números 101+ para no chocar con MAIN). */
const EMPLEADOS_SUR = [
  {
    numEmpleado: '101',
    firstName: 'Héctor',
    lastName: 'Aguilar Mejía',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Supervisor de Planta',
    salarioDiario: 510,
    fechaIngreso: '2016-04-12',
    fechaNacimiento: '1980-02-14',
    supervisorNum: null,
    codigoExterno: 'EXT-101'
  },
  {
    numEmpleado: '102',
    firstName: 'Norma',
    lastName: 'Delgado Rivas',
    sexo: 'F',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 360,
    fechaIngreso: '2019-07-01',
    fechaNacimiento: '1992-08-30',
    supervisorNum: '101',
    codigoExterno: 'EXT-102'
  },
  {
    numEmpleado: '103',
    firstName: 'Óscar',
    lastName: 'Pérez Luna',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 355,
    fechaIngreso: '2020-11-16',
    fechaNacimiento: '1994-01-09',
    supervisorNum: '101',
    codigoExterno: 'EXT-103'
  },
  {
    numEmpleado: '104',
    firstName: 'Claudia',
    lastName: 'Ríos Mendoza',
    sexo: 'F',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 350,
    fechaIngreso: '2021-03-22',
    fechaNacimiento: '1997-05-18',
    supervisorNum: '101',
    codigoExterno: 'EXT-104'
  },
  {
    numEmpleado: '105',
    firstName: 'Miguel',
    lastName: 'Santos Ibarra',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 345,
    fechaIngreso: '2022-09-05',
    fechaNacimiento: '1999-11-02',
    supervisorNum: '101',
    codigoExterno: 'EXT-105'
  },
  {
    numEmpleado: '106',
    firstName: 'Alejandra',
    lastName: 'Vega Campos',
    sexo: 'F',
    depto: 'Tecnología',
    puesto: 'Soporte TI',
    salarioDiario: 430,
    fechaIngreso: '2020-01-20',
    fechaNacimiento: '1991-06-25',
    supervisorNum: null,
    codigoExterno: 'EXT-106'
  },
  {
    numEmpleado: '107',
    firstName: 'Raúl',
    lastName: 'Espinoza Nieto',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 340,
    fechaIngreso: '2023-04-10',
    fechaNacimiento: '2000-03-11',
    supervisorNum: '101',
    codigoExterno: 'EXT-107'
  },
  {
    numEmpleado: '108',
    firstName: 'Daniela',
    lastName: 'Cortés Salinas',
    sexo: 'F',
    depto: 'Recursos Humanos',
    puesto: 'Auxiliar Administrativo',
    salarioDiario: 390,
    fechaIngreso: '2021-08-30',
    fechaNacimiento: '1993-12-07',
    supervisorNum: null,
    codigoExterno: 'EXT-108'
  },
  {
    numEmpleado: '109',
    firstName: 'Iván',
    lastName: 'Montoya Fuentes',
    sexo: 'M',
    depto: 'Ventas',
    puesto: 'Ejecutivo de Ventas',
    salarioDiario: 410,
    fechaIngreso: '2022-02-14',
    fechaNacimiento: '1995-04-22',
    supervisorNum: null,
    codigoExterno: 'EXT-109'
  },
  {
    numEmpleado: '110',
    firstName: 'Lucía',
    lastName: 'Herrera Ponce',
    sexo: 'F',
    depto: 'Ventas',
    puesto: 'Ejecutivo de Ventas',
    salarioDiario: 405,
    fechaIngreso: '2023-06-19',
    fechaNacimiento: '1996-09-03',
    supervisorNum: '109',
    codigoExterno: 'EXT-110'
  },
  {
    numEmpleado: '111',
    firstName: 'Eduardo',
    lastName: 'Camacho Ortiz',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 338,
    fechaIngreso: '2024-01-08',
    fechaNacimiento: '2001-07-19',
    supervisorNum: '101',
    codigoExterno: 'EXT-111'
  },
  {
    numEmpleado: '112',
    firstName: 'Paola',
    lastName: 'Navarro Gil',
    sexo: 'F',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 342,
    fechaIngreso: '2024-08-26',
    fechaNacimiento: '2002-02-28',
    supervisorNum: '101',
    codigoExterno: 'EXT-112'
  },
  {
    numEmpleado: '113',
    firstName: 'Sergio',
    lastName: 'Valdez León',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 335,
    fechaIngreso: '2025-02-03',
    fechaNacimiento: '2003-10-15',
    supervisorNum: '101',
    codigoExterno: ''
  },
  {
    numEmpleado: '114',
    firstName: 'Mariana',
    lastName: 'Ochoa Prieto',
    sexo: 'F',
    depto: 'Tecnología',
    puesto: 'Desarrollador',
    salarioDiario: 530,
    fechaIngreso: '2021-05-17',
    fechaNacimiento: '1990-01-30',
    supervisorNum: '106',
    codigoExterno: 'EXT-114'
  },
  {
    numEmpleado: '115',
    firstName: 'Arturo',
    lastName: 'Meza Contreras',
    sexo: 'M',
    depto: 'Operaciones',
    puesto: 'Operador',
    salarioDiario: 348,
    fechaIngreso: '2023-11-13',
    fechaNacimiento: '1998-08-08',
    supervisorNum: '101',
    codigoExterno: 'EXT-115'
  }
];

const EMPLEADOS_BY_SUBSIDIARIA = {
  MAIN: EMPLEADOS,
  SUR: EMPLEADOS_SUR
};

function parseArgs(argv) {
  const out = {
    tenantSlug: process.env.SEED_TENANT_SLUG || '',
    subsidiaria: (process.env.SEED_SUBSIDIARIA || 'MAIN').toUpperCase(),
    force: false
  };
  for (const arg of argv) {
    if (arg === '--force') out.force = true;
    else if (arg.startsWith('--tenant=')) out.tenantSlug = arg.slice(9).trim();
    else if (arg.startsWith('--subsidiaria=')) out.subsidiaria = arg.slice(14).trim().toUpperCase();
  }
  return out;
}

function demoCurp(seed) {
  return `SEED${seed}HDFXXX00`.slice(0, 18);
}

function demoRfc(seed) {
  return `SEED${seed}000`.slice(0, 13);
}

function demoNss(seed) {
  return String(10000000000 + Number(seed)).slice(0, 11);
}

async function resolveTenant(db, slug) {
  const tenants = db.collection('tenants');
  if (slug) {
    const t = await tenants.findOne({ slug: slug.toLowerCase() });
    if (!t) throw new Error(`Tenant no encontrado con slug «${slug}»`);
    return t;
  }
  const t = await tenants.findOne({ status: 'active' }, { sort: { createdAt: 1 } });
  if (!t) {
    const any = await tenants.findOne({}, { sort: { createdAt: 1 } });
    if (!any) throw new Error('No hay tenants en la base de datos. Crea uno desde el admin.');
    console.warn(`· No hay tenant activo; usando «${any.slug}»`);
    return any;
  }
  return t;
}

async function ensureEmpresa(db, tenant) {
  const empresas = db.collection('empresas');
  let empresa = await empresas.findOne({ tenantId: tenant.tenantId });
  if (empresa) return empresa;

  const now = new Date();
  const r = await empresas.insertOne({
    tenantId: tenant.tenantId,
    razonSocial: tenant.displayName || tenant.slug,
    nombreComercial: tenant.displayName || tenant.slug,
    activo: true,
    createdAt: now,
    updatedAt: now
  });
  empresa = await empresas.findOne({ _id: r.insertedId });
  console.log('✓ Empresa creada para el tenant');
  return empresa;
}

async function ensureSubsidiaria(db, empresa, tenant, subKey) {
  const def = SUBSIDIARIAS[subKey];
  if (!def) throw new Error(`Subsidiaria desconocida: ${subKey}. Usa MAIN, SUR o all.`);

  const subsidiarias = db.collection('subsidiarias');
  let sub = await subsidiarias.findOne({ empresaId: empresa._id, codigo: def.codigo });
  if (sub) return sub;

  const display = tenant.displayName || tenant.slug;
  const now = new Date();
  const r = await subsidiarias.insertOne({
    empresaId: empresa._id,
    nombre: `${display} — ${def.nombreSuffix}`,
    codigo: def.codigo,
    direccion: def.direccion,
    ciudad: def.ciudad,
    estado: def.estado || '',
    codigoPostal: def.codigoPostal || '',
    activo: true,
    createdAt: now,
    updatedAt: now
  });
  sub = await subsidiarias.findOne({ _id: r.insertedId });
  console.log(`✓ Subsidiaria «${def.codigo}» creada (${sub.nombre})`);
  return sub;
}

async function ensureCatalogs(db, tenantId, empresaId) {
  const deptos = db.collection(COLLECTION_DEPARTAMENTOS);
  const puestos = db.collection(COLLECTION_PUESTOS);
  const turnos = db.collection(COLLECTION_TURNOS);
  const now = new Date();

  const deptoMap = new Map();
  for (const nombre of DEPARTAMENTOS) {
    await deptos.updateOne(
      { tenantId, nombre },
      {
        $set: { tenantId, empresaId, nombre, activo: true, updatedAt: now },
        $setOnInsert: { createdAt: now, descripcion: '' }
      },
      { upsert: true }
    );
    const doc = await deptos.findOne({ tenantId, nombre });
    deptoMap.set(nombre, doc._id);
  }
  console.log(`✓ ${DEPARTAMENTOS.length} departamentos listos`);

  const puestoMap = new Map();
  for (const p of PUESTOS) {
    await puestos.updateOne(
      { tenantId, nombre: p.nombre },
      {
        $set: {
          tenantId,
          empresaId,
          nombre: p.nombre,
          activo: true,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now, descripcion: '' }
      },
      { upsert: true }
    );
    const doc = await puestos.findOne({ tenantId, nombre: p.nombre });
    puestoMap.set(p.nombre, doc._id);
  }
  console.log(`✓ ${PUESTOS.length} puestos listos`);

  await turnos.updateOne(
    { tenantId, nombre: 'Matutino' },
    {
      $set: {
        tenantId,
        empresaId,
        nombre: 'Matutino',
        tipo: 'fijo',
        diasLaborables: [1, 2, 3, 4, 5],
        horaEntrada: '08:00',
        horaSalida: '17:00',
        toleranciaEntradaMin: 10,
        toleranciaSalidaMin: 5,
        tiempoComidaMin: 60,
        horasJornada: 8,
        descansaSabado: true,
        descansaDomingo: true,
        color: '#2563eb',
        activo: true,
        updatedAt: now
      },
      $setOnInsert: { createdAt: now, comidaChecada: false }
    },
    { upsert: true }
  );
  const turno = await turnos.findOne({ tenantId, nombre: 'Matutino' });
  console.log('✓ Turno «Matutino» listo');

  return { deptoMap, puestoMap, turnoId: turno._id };
}

async function seedEmpleados(db, tenantId, empresaId, subsidiariaId, catalogs, empleadoList, options = {}) {
  const { force = false, subLabel = '' } = options;
  const empleados = db.collection(COLLECTION_EMPLEADOS);
  const { deptoMap, puestoMap, turnoId } = catalogs;

  const existing = await empleados.countDocuments({ tenantId, subsidiariaId });
  if (existing > 0 && !force) {
    console.log(
      `· Ya hay ${existing} empleado(s) en subsidiaria ${subLabel || subsidiariaId}. Usa --force para actualizar.`
    );
    return { inserted: 0, updated: 0, skipped: true };
  }

  const now = new Date();
  const idByNum = new Map();
  let inserted = 0;
  let updated = 0;

  for (const e of empleadoList) {
    const num = e.numEmpleado.padStart(3, '0');
    const slug = num.replace(/^0+/, '') || num;
    const doc = {
      tenantId,
      empresaId,
      subsidiariaId,
      numEmpleado: num,
      firstName: e.firstName,
      lastName: e.lastName,
      curp: demoCurp(num),
      rfc: demoRfc(num),
      nss: demoNss(num),
      fechaNacimiento: new Date(e.fechaNacimiento),
      sexo: e.sexo,
      email: `${e.firstName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.${slug}@demo.local`,
      emailPersonal: '',
      telefono: `55${String(10000000 + Number(num)).slice(-8)}`,
      telefonoFijo: '',
      departamentoId: deptoMap.get(e.depto),
      puestoId: puestoMap.get(e.puesto),
      turnoId,
      tipoContrato: 'indefinido',
      tipoRegistro: 'rol_turnos',
      codigoExterno: e.codigoExterno != null ? String(e.codigoExterno) : `EXT-${num}`,
      salarioDiario: e.salarioDiario,
      fechaIngreso: new Date(e.fechaIngreso),
      fechaBaja: null,
      motivoBaja: '',
      estatus: 'activo',
      activo: true,
      updatedAt: now
    };

    const result = await empleados.updateOne(
      { tenantId, numEmpleado: num },
      { $set: doc, $setOnInsert: { createdAt: now, supervisorId: null } },
      { upsert: true }
    );

    const saved = await empleados.findOne({ tenantId, numEmpleado: num });
    idByNum.set(num, saved._id);

    if (result.upsertedCount) inserted += 1;
    else if (result.modifiedCount) updated += 1;
  }

  for (const e of empleadoList) {
    const num = e.numEmpleado.padStart(3, '0');
    const supervisorId = e.supervisorNum ? idByNum.get(e.supervisorNum.padStart(3, '0')) : null;
    await empleados.updateOne({ tenantId, numEmpleado: num }, { $set: { supervisorId } });
  }

  const tag = subLabel ? ` [${subLabel}]` : '';
  console.log(
    `✓ Empleados${tag}: ${inserted} nuevos, ${updated} actualizados (${empleadoList.length} en catálogo)`
  );
  return { inserted, updated, skipped: false };
}

async function seedSubsidiariaBatch(db, tenant, empresa, catalogs, subKey, force) {
  const subsidiaria = await ensureSubsidiaria(db, empresa, tenant, subKey);
  const list = EMPLEADOS_BY_SUBSIDIARIA[subKey];
  if (!list?.length) {
    console.warn(`· Sin catálogo de empleados para ${subKey}`);
    return;
  }
  await seedEmpleados(db, tenant.tenantId, empresa._id, subsidiaria._id, catalogs, list, {
    force,
    subLabel: subKey
  });
}

async function main() {
  const { tenantSlug, subsidiaria, force } = parseArgs(process.argv.slice(2));
  const uri = dbConfig.connectionStringConfig;

  console.log('Conectando a', uri);
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const tenant = await resolveTenant(db, tenantSlug);
  console.log(`· Tenant: ${tenant.displayName} (${tenant.slug})`);

  const empresa = await ensureEmpresa(db, tenant);
  const catalogs = await ensureCatalogs(db, tenant.tenantId, empresa._id);

  const targets =
    subsidiaria === 'ALL' ? ['MAIN', 'SUR'] : [subsidiaria];

  for (const key of targets) {
    if (!EMPLEADOS_BY_SUBSIDIARIA[key]) {
      throw new Error(`Subsidiaria «${key}» no tiene catálogo. Usa MAIN, SUR o all.`);
    }
    await seedSubsidiariaBatch(db, tenant, empresa, catalogs, key, force);
  }

  await mongoose.disconnect();
  console.log('Seed de empleados completado.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
