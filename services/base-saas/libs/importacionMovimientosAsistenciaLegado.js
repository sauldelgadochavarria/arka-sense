'use strict';

const fs = require('fs');
const path = require('path');
const { parseTsvLine } = require('./importacionConceptosLegado');
const { registrarMovimiento } = require('../services/movimientoAsistenciaNominaService');

function numOrNull(val) {
  if (val === undefined || val === null || val === '' || val === 'NULL') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function mapLegacyRowToMovimiento(row, empleadoId, empresaId, tenantId) {
  return {
    tenantId,
    empresaId,
    empleadoId,
    conceptoClave: String(row.CLA_PERDED || '').trim(),
    tipoMovimiento: String(row.TIPO_MOV || '').trim(),
    monto: numOrNull(row.MONTO) ?? 0,
    fechaMovimiento: row.FECHA_MOV ? new Date(row.FECHA_MOV) : new Date(),
    fechaNomina: row.FECHA_NOMINA && row.FECHA_NOMINA !== 'NULL' ? new Date(row.FECHA_NOMINA) : null,
    referencia: String(row.REFERENCIA || '').trim(),
    origenMovimiento: String(row.ORIGEN_MOV || 'importacion').trim(),
    claTrab: String(row.CLA_TRAB || '').trim(),
    claPerded: String(row.CLA_PERDED || '').trim(),
    folioAuto: numOrNull(row.FOL_AUTO),
    metadata: {
      legado: {
        claEmpresa: row.CLA_EMPRESA,
        claCentroCosto: row.CLA_CENTRO_COSTO,
        claPuesto: row.CLA_PUESTO,
        claUbicacion: row.CLA_UBICACION,
        claDepto: row.CLA_DEPTO,
        claTurno: row.CLA_TURNO,
        montoTope: row.MONTO_TOPE,
        fechaAplica: row.FECHA_APLICA,
        folPrestamo: row.FOL_PRESTAMO,
        claUsuario: row.CLA_USUARIO
      }
    }
  };
}

function parseMovimientosLegadoFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${abs}`);

  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('Sin filas de datos');

  const header = parseTsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseTsvLine(lines[i]);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = cols[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

async function importarMovimientosLegado(tenantId, empresaId, filePath, empleadoResolver, options = {}) {
  const { dryRun = false } = options;
  const rows = parseMovimientosLegadoFile(filePath);
  const movimientos = [];
  const omitidos = [];

  for (const row of rows) {
    const claTrab = String(row.CLA_TRAB || '').trim();
    const empleadoId = await empleadoResolver(claTrab, row);
    if (!empleadoId) {
      omitidos.push({ claTrab, motivo: 'Empleado no encontrado' });
      continue;
    }
    movimientos.push(mapLegacyRowToMovimiento(row, empleadoId, empresaId, tenantId));
  }

  if (dryRun) {
    return { dryRun: true, total: movimientos.length, omitidos, movimientos };
  }

  let insertados = 0;
  for (const m of movimientos) {
    await registrarMovimiento(m.tenantId, m.empresaId, m);
    insertados++;
  }

  return { dryRun: false, insertados, omitidos, totalFilas: rows.length };
}

module.exports = {
  mapLegacyRowToMovimiento,
  parseMovimientosLegadoFile,
  importarMovimientosLegado
};
