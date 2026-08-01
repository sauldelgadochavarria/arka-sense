'use strict';

const getEmpleadoModel = require('../models/empleado');
const getSyncLogModel = require('../models/syncLog');
const { buildCsv } = require('./integration/csvUtils');

const EXPORT_HEADERS = [
  'NUM_EMPLEADO',
  'NOMBRE',
  'APELLIDOS',
  'RFC',
  'CURP',
  'NSS',
  'EMAIL',
  'SALARIO_DIARIO',
  'FECHA_INGRESO',
  'ESTATUS'
];

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function normalizeHeaderKey(row, ...candidates) {
  for (const c of candidates) {
    const v = row[c] ?? row[c.toUpperCase()];
    if (v !== undefined && v !== '') return String(v).trim();
  }
  return '';
}

async function exportEmpleados(tenantId, empresaId, userId = '') {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId }).sort({ numEmpleado: 1 }).lean();

  const rows = empleados.map((e) => ({
    NUM_EMPLEADO: e.numEmpleado,
    NOMBRE: e.firstName,
    APELLIDOS: e.lastName,
    RFC: e.rfc || '',
    CURP: e.curp || '',
    NSS: e.nss || '',
    EMAIL: e.email || '',
    SALARIO_DIARIO: e.salarioDiario ?? 0,
    FECHA_INGRESO: e.fechaIngreso ? new Date(e.fechaIngreso).toISOString().slice(0, 10) : '',
    ESTATUS: e.estatus
  }));

  const content = buildCsv(EXPORT_HEADERS, rows);
  const filename = `empleados_abc_${new Date().toISOString().slice(0, 10)}.csv`;

  const SyncLog = await getSyncLogModel();
  await SyncLog.create({
    tenantId,
    empresaId,
    tipo: 'empleados_export',
    adaptador: 'csv',
    estatus: 'ok',
    registrosOk: rows.length,
    registrosError: 0,
    detalle: `Exportación ABC — ${rows.length} empleados`,
    archivoNombre: filename,
    archivoContenido: content,
    userId
  });

  return { content, filename, registros: rows.length };
}

async function importEmpleados(tenantId, empresaId, csvText, userId = '') {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('CSV_EMPTY');

  const Empleado = await getEmpleadoModel();
  const existentes = await Empleado.find({ tenantId }).lean();
  const byNum = new Map(existentes.map((e) => [e.numEmpleado, e]));
  const byRfc = new Map(existentes.filter((e) => e.rfc).map((e) => [e.rfc.toUpperCase(), e]));

  let registrosOk = 0;
  let registrosError = 0;
  const conflictos = [];

  for (const row of rows) {
    const numEmpleado = normalizeHeaderKey(row, 'NUM_EMPLEADO', 'NOI_EMP', 'PERNR');
    const rfc = normalizeHeaderKey(row, 'RFC', 'RFC_EMP', 'STCD1').toUpperCase();
    const firstName = normalizeHeaderKey(row, 'NOMBRE', 'NOM_EMP', 'VORNA');
    const lastName = normalizeHeaderKey(row, 'APELLIDOS', 'AP_PATERNO', 'NACHN');

    if (!numEmpleado && !rfc) {
      registrosError += 1;
      continue;
    }

    const existente = (numEmpleado && byNum.get(numEmpleado)) || (rfc && byRfc.get(rfc));

    const remoto = {
      numEmpleado: numEmpleado || existente?.numEmpleado,
      firstName: firstName || existente?.firstName || '',
      lastName: lastName || existente?.lastName || '',
      rfc: rfc || existente?.rfc || '',
      curp: normalizeHeaderKey(row, 'CURP'),
      nss: normalizeHeaderKey(row, 'NSS'),
      email: normalizeHeaderKey(row, 'EMAIL'),
      salarioDiario: Number(normalizeHeaderKey(row, 'SALARIO_DIARIO', 'SDI')) || 0
    };

    if (!existente) {
      if (!numEmpleado) {
        registrosError += 1;
        continue;
      }
      try {
        const created = await Empleado.create({
          tenantId,
          empresaId,
          ...remoto,
          estatus: 'activo',
          activo: true
        });
        byNum.set(created.numEmpleado, created.toObject());
        if (created.rfc) byRfc.set(created.rfc.toUpperCase(), created.toObject());
        registrosOk += 1;
      } catch {
        registrosError += 1;
      }
      continue;
    }

    const diffs = [];
    if (remoto.firstName && remoto.firstName !== existente.firstName) {
      diffs.push({ campo: 'firstName', local: existente.firstName, remoto: remoto.firstName });
    }
    if (remoto.lastName && remoto.lastName !== existente.lastName) {
      diffs.push({ campo: 'lastName', local: existente.lastName, remoto: remoto.lastName });
    }
    if (remoto.rfc && remoto.rfc !== (existente.rfc || '').toUpperCase()) {
      diffs.push({ campo: 'rfc', local: existente.rfc, remoto: remoto.rfc });
    }
    if (remoto.salarioDiario > 0 && remoto.salarioDiario !== existente.salarioDiario) {
      diffs.push({
        campo: 'salarioDiario',
        local: String(existente.salarioDiario ?? ''),
        remoto: String(remoto.salarioDiario)
      });
    }

    if (diffs.length) {
      for (const d of diffs) {
        conflictos.push({
          tipo: 'dato_diferente',
          empleadoId: existente._id,
          numEmpleado: existente.numEmpleado,
          campo: d.campo,
          valorLocal: d.local,
          valorRemoto: d.remoto,
          mensaje: `${d.campo}: local «${d.local}» vs remoto «${d.remoto}»`,
          resolucion: 'pendiente'
        });
      }
    } else {
      registrosOk += 1;
    }
  }

  const estatus = conflictos.length ? 'parcial' : registrosError > 0 && !registrosOk ? 'error' : 'ok';

  const SyncLog = await getSyncLogModel();
  const log = await SyncLog.create({
    tenantId,
    empresaId,
    tipo: 'empleados_import',
    adaptador: 'csv',
    estatus,
    registrosOk,
    registrosError,
    conflictos,
    detalle: `Importación ABC — ${registrosOk} ok, ${conflictos.length} conflictos, ${registrosError} errores`,
    userId
  });

  return log.toObject();
}

async function resolveConflicto(logId, tenantId, conflictoId, resolucion) {
  const SyncLog = await getSyncLogModel();
  const Empleado = await getEmpleadoModel();

  const log = await SyncLog.findOne({ _id: logId, tenantId });
  if (!log) throw new Error('LOG_NOT_FOUND');

  const conflicto = log.conflictos.id(conflictoId);
  if (!conflicto) throw new Error('CONFLICT_NOT_FOUND');
  if (conflicto.resolucion !== 'pendiente') throw new Error('ALREADY_RESOLVED');

  if (resolucion === 'aceptar_remoto' && conflicto.empleadoId) {
    const emp = await Empleado.findOne({ _id: conflicto.empleadoId, tenantId });
    if (emp) {
      const updates = {};
      if (conflicto.campo === 'salarioDiario') updates.salarioDiario = Number(conflicto.valorRemoto) || 0;
      else updates[conflicto.campo] = conflicto.valorRemoto;
      Object.assign(emp, updates);
      await emp.save();
    }
  }

  conflicto.resolucion = resolucion === 'aceptar_remoto' ? 'aceptar_remoto' : 'aceptar_local';
  await log.save();
  return log.toObject();
}

module.exports = { exportEmpleados, importEmpleados, resolveConflicto, parseCsv };
