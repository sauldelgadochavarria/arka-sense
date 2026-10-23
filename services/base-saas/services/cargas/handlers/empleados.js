'use strict';

const getEmpleadoModel = require('../../../models/empleado');
const { toNum, toDate } = require('../csvParse');
const { normalizarCorreo, mensajeCorreoDuplicado } = require('../../../libs/empleadoCorreo');

async function validateEmpleados(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const existentes = await Empleado.find({ tenantId }).select('numEmpleado email emailPersonal').lean();
  const setExist = new Set(existentes.map((e) => String(e.numEmpleado)));
  const correoDe = new Map();
  for (const e of existentes) {
    for (const campo of [e.email, e.emailPersonal]) {
      const correo = normalizarCorreo(campo);
      if (correo && !correoDe.has(correo)) correoDe.set(correo, String(e.numEmpleado));
    }
  }
  const vistos = new Set();
  const vistosCorreo = new Map();
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
    const email = normalizarCorreo(data.email);
    if (email) {
      const dueno = correoDe.get(email);
      if (dueno && dueno !== num) {
        errores.push({ fila, campo: 'email', mensaje: `Ya está en el empleado ${dueno}`, valor: email });
        continue;
      }
      const enArchivo = vistosCorreo.get(email);
      if (enArchivo && enArchivo !== num) {
        errores.push({ fila, campo: 'email', mensaje: `Duplicado en el archivo (empleado ${enArchivo})`, valor: email });
        continue;
      }
      vistosCorreo.set(email, num);
    }
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
      email: email,
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

      const actual = row.existe
        ? await Empleado.findOne({ tenantId, numEmpleado: row.numEmpleado }).select('_id').lean()
        : null;
      const dup = await mensajeCorreoDuplicado(Empleado, tenantId, { email: row.email }, actual && actual._id);
      if (dup) {
        errores.push({ fila: row.fila, campo: 'email', mensaje: dup, valor: row.email || '' });
        continue;
      }

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
