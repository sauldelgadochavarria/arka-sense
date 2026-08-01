#!/usr/bin/env node
'use strict';

/**
 * Empleados demo para import legado (historial + movimientos asistencia).
 * CLA_TRAB: 1259, 2137, 2138, 2139
 * npm run seed:historial-empleados-demo -- --slug=empresa-demo
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const getTenantModel = require('../models/tenant');
const getEmpresaModel = require('../models/empresa');
const getEmpleadoModel = require('../models/empleado');
const getSubsidiariaModel = require('../models/subsidiaria');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const { resolveTenantId } = require('../libs/resolveTenantId');

const EMPLEADOS_DEMO = [
  {
    codigoExterno: '1259',
    numEmpleado: '1259',
    firstName: 'Demo',
    lastName: 'Movimientos 1259',
    codigoLegadoDepto: 28,
    codigoLegadoPuesto: 2000,
    salarioDiario: 217.47,
    fechaIngreso: new Date('2010-01-01')
  },
  {
    codigoExterno: '2137',
    numEmpleado: '2137',
    firstName: 'Demo',
    lastName: 'Historial 2137',
    codigoLegadoDepto: 25,
    codigoLegadoPuesto: 1139,
    salarioDiario: 206.13,
    fechaIngreso: new Date('1956-09-06')
  },
  {
    codigoExterno: '2138',
    numEmpleado: '2138',
    firstName: 'Demo',
    lastName: 'Historial 2138',
    codigoLegadoDepto: 99,
    codigoLegadoPuesto: 2000,
    salarioDiario: 17.16,
    fechaIngreso: new Date('2006-08-09')
  },
  {
    codigoExterno: '2139',
    numEmpleado: '2139',
    firstName: 'Demo',
    lastName: 'Historial 2139',
    codigoLegadoDepto: 30,
    codigoLegadoPuesto: 1125,
    salarioDiario: 100.77,
    fechaIngreso: new Date('2014-07-08')
  }
];

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
}

async function main() {
  const slug = argValue('slug');
  await mongoose.connect(dbConfig.connectionStringConfig);

  const Tenant = await getTenantModel();
  const tenant = slug
    ? await Tenant.findOne({ slug }).lean()
    : await Tenant.findOne({ status: 'active' }).sort({ createdAt: -1 }).lean();

  if (!tenant) {
    console.error('No se encontró tenant');
    process.exit(1);
  }

  const tenantId = resolveTenantId(tenant);
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  if (!empresa) {
    console.error('No hay empresa para el tenant');
    process.exit(1);
  }

  const Subsidiaria = await getSubsidiariaModel();
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Empleado = await getEmpleadoModel();

  let subsidiaria = await Subsidiaria.findOne({ empresaId: empresa._id, codigoLegado: 1 }).lean();
  if (!subsidiaria) {
    subsidiaria = await Subsidiaria.findOne({ empresaId: empresa._id }).lean();
  }

  for (const item of EMPLEADOS_DEMO) {
    const depto = await Departamento.findOne({ tenantId, codigoLegado: item.codigoLegadoDepto }).lean();
    const puesto = await Puesto.findOne({ tenantId, codigoLegado: item.codigoLegadoPuesto }).lean();

    const payload = {
      tenantId,
      empresaId: empresa._id,
      numEmpleado: item.numEmpleado,
      codigoExterno: item.codigoExterno,
      firstName: item.firstName,
      lastName: item.lastName,
      salarioDiario: item.salarioDiario,
      fechaIngreso: item.fechaIngreso,
      estatus: 'activo',
      activo: true,
      subsidiariaId: subsidiaria?._id || null,
      departamentoId: depto?._id || null,
      puestoId: puesto?._id || null
    };

    const existing = await Empleado.findOne({
      tenantId,
      $or: [{ numEmpleado: item.numEmpleado }, { codigoExterno: item.codigoExterno }]
    });

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      console.log(`✓ Empleado ${item.codigoExterno} actualizado`);
    } else {
      await Empleado.create(payload);
      console.log(`✓ Empleado ${item.codigoExterno} creado`);
    }
  }

  console.log('Listo. Ejecuta import:historial-legado o import:movimientos-asistencia');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
