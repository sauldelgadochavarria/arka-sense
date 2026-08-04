'use strict';

const getEmpleadoModel = require('../../../models/empleado');
const { toNum, toDate } = require('../csvParse');

async function validateEmpleados(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const existentes = await Empleado.find({ tenantId }).select('numEmpleado').lean();
  const setExist = new Set(existentes.map((e) => String(e.numEmpleado)));
  const vistos = new Set();
  const errores = [];
  const ok = [];

  for (const { fila, data } of rows) {
    const num = String(data.numEmpleado || '').trim();
    const firstName = String(data.firstName || '').trim();
    const lastName = String(data.lastName || '').trim();
    if (!num) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Obligatorio', valor: '' });
      continue;
    }
    if (!firstName || !lastName) {
      errores.push({ fila, campo: 'nombre', mensaje: 'firstName y lastName son obligatorios', valor: `${firstName} ${lastName}` });
      continue;
    }
    if (vistos.has(num)) {
      errores.push({ fila, campo: 'numEmpleado', mensaje: 'Duplicado en el archivo', valor: num });
      continue;
    }
    vistos.add(num);
    const salario = toNum(data.salarioDiario, 0);
    if (salario == null || salario < 0) {
      errores.push({ fila, campo: 'salarioDiario', mensaje: 'Salario inválido', valor: String(data.salarioDiario || '') });
      continue;
    }
    const fechaIngreso = toDate(data.fechaIngreso);
    ok.push({
      fila,
      numEmpleado: num,
      firstName,
      lastName,
      rfc: String(data.rfc || '').trim().toUpperCase(),
      curp: String(data.curp || '').trim().toUpperCase(),
      nss: String(data.nss || '').trim(),
      email: String(data.email || '').trim().toLowerCase(),
      salarioDiario: salario,
      fechaIngreso,
      tipoContrato: String(data.tipoContrato || 'indefinido').trim() || 'indefinido',
      tipoEmpleado: String(data.tipoEmpleado || '').trim(),
      estatus: ['activo', 'baja', 'suspendido'].includes(String(data.estatus || '').trim())
        ? String(data.estatus).trim()
        : 'activo',
      existe: setExist.has(num),
      accion: setExist.has(num) ? 'actualizar' : 'crear'
    });
  }

  return {
    errores,
    validos: ok,
    resumen: {
      crear: ok.filter((r) => r.accion === 'crear').length,
      actualizar: ok.filter((r) => r.accion === 'actualizar').length
    }
  };
}

async function applyEmpleados(tenantId, empresaId, validos) {
  const Empleado = await getEmpleadoModel();
  let aplicadas = 0;
  const errores = [];

  for (const row of validos) {
    try {
      const payload = {
        firstName: row.firstName,
        lastName: row.lastName,
        rfc: row.rfc,
        curp: row.curp,
        nss: row.nss,
        email: row.email,
        salarioDiario: row.salarioDiario,
        tipoContrato: row.tipoContrato,
        tipoEmpleado: row.tipoEmpleado,
        estatus: row.estatus,
        activo: row.estatus === 'activo'
      };
      if (row.fechaIngreso) payload.fechaIngreso = row.fechaIngreso;

      await Empleado.updateOne(
        { tenantId, numEmpleado: row.numEmpleado },
        {
          $set: payload,
          $setOnInsert: {
            tenantId,
            empresaId,
            numEmpleado: row.numEmpleado
          }
        },
        { upsert: true }
      );
      aplicadas += 1;
    } catch (err) {
      errores.push({
        fila: row.fila,
        campo: 'numEmpleado',
        mensaje: err.message || 'Error al guardar',
        valor: row.numEmpleado
      });
    }
  }

  return { aplicadas, errores };
}

module.exports = { validateEmpleados, applyEmpleados };
