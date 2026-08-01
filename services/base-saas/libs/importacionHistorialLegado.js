'use strict';

/**
 * Importación de historial laboral Fortia (TSV).
 */

const fs = require('fs');
const path = require('path');
const { parseTsvLine } = require('./importacionConceptosLegado');
const { MAPEO_TIPO_MOV_LEGADO, TIPOS_SALARIO } = require('../config/historialLaboralDefaults');
const { registrarMovimiento, ensureTiposMovimientoForTenant } = require('../services/historialLaboralService');
const { buildOrgLegadoMaps } = require('./orgLegadoResolver');

function mapTipoSalarioLegado(val) {
  const n = Number(val);
  const found = TIPOS_SALARIO.find((t) => t.claveLegado === n);
  return found?.value || '';
}

function mapEstatusLegado(raw) {
  const estatusMap = { A: 'activo', B: 'baja', S: 'suspendido' };
  if (!raw || raw === 'NULL') return '';
  return estatusMap[raw] || raw;
}

function mapLegacyRowToHistorial(row, empleadoId, empresaId, tenantId, orgMaps = null) {
  const claTipo = Number(row.CLA_TIPO_MOV);
  const tipoCodigo = MAPEO_TIPO_MOV_LEGADO[claTipo] || 'ACTUALIZACION';

  const salarioDiario = row.SUELDO_DIA && row.SUELDO_DIA !== 'NULL' ? Number(row.SUELDO_DIA) : null;
  const salarioSemanal = row.SUELDO_SEM && row.SUELDO_SEM !== 'NULL' ? Number(row.SUELDO_SEM) : null;
  const salarioMensual = row.SUELDO_MENSUAL && row.SUELDO_MENSUAL !== 'NULL' ? Number(row.SUELDO_MENSUAL) : null;

  const resolveDepto = (cla) => (orgMaps ? orgMaps.resolveDepartamento(cla) : null);
  const resolvePuesto = (cla) => (orgMaps ? orgMaps.resolvePuesto(cla) : null);
  const resolveSub = (cla) => (orgMaps ? orgMaps.resolveSubsidiaria(cla) : null);

  const anterior = {
    subsidiariaId: resolveSub(row.CLA_UBICACION_ANT),
    departamentoId: resolveDepto(row.CLA_DEPTO_ANT),
    puestoId: resolvePuesto(row.CLA_PUESTO_ANT),
    salarioDiario:
      row.SUELDO_DIA_ANT && row.SUELDO_DIA_ANT !== 'NULL' ? Number(row.SUELDO_DIA_ANT) : null,
    salarioSemanal:
      row.SUELDO_SEM_ANT && row.SUELDO_SEM_ANT !== 'NULL' ? Number(row.SUELDO_SEM_ANT) : null,
    salarioMensual:
      row.SUELDO_MENSUAL_ANT && row.SUELDO_MENSUAL_ANT !== 'NULL'
        ? Number(row.SUELDO_MENSUAL_ANT)
        : null,
    sueldoIntegrado:
      row.SUELDO_INT_ANT && row.SUELDO_INT_ANT !== 'NULL' ? Number(row.SUELDO_INT_ANT) : null,
    tipoContrato: '',
    tipoSalario: mapTipoSalarioLegado(row.TIPO_SALARIO),
    estatus: mapEstatusLegado(row.STATUS_TRAB_ANT)
  };

  const estatusRaw = row.STATUS_TRAB && row.STATUS_TRAB !== 'NULL' ? row.STATUS_TRAB : 'A';

  return {
    tenantId,
    empresaId,
    empleadoId,
    tipoMovimientoCodigo: tipoCodigo,
    fechaMovimiento: row.FECHA_MOV ? new Date(row.FECHA_MOV) : new Date(),
    folio: row.FOL_AUTO && row.FOL_AUTO !== 'NULL' ? Number(row.FOL_AUTO) : null,
    subsidiariaId: resolveSub(row.CLA_UBICACION),
    departamentoId: resolveDepto(row.CLA_DEPTO),
    puestoId: resolvePuesto(row.CLA_PUESTO),
    salarioDiario,
    salarioSemanal,
    salarioMensual,
    sueldoIntegrado: row.SUELDO_INT && row.SUELDO_INT !== 'NULL' ? Number(row.SUELDO_INT) : null,
    tipoSalario: mapTipoSalarioLegado(row.TIPO_SALARIO),
    estatus: mapEstatusLegado(estatusRaw),
    diasContrato: row.DIAS_CONT && row.DIAS_CONT !== 'NULL' ? Number(row.DIAS_CONT) : null,
    terminoContrato: row.TERM_CONT && row.TERM_CONT !== 'NULL' ? Number(row.TERM_CONT) : null,
    observaciones: String(row.OBSERV || row.LOCALIZACION || '').trim(),
    anterior,
    origen: 'importacion',
    metadata: {
      legado: {
        claTrab: Number(row.CLA_TRAB),
        claEmpresa: Number(row.CLA_EMPRESA),
        claTipoMov: claTipo,
        claDepto: row.CLA_DEPTO,
        claPuesto: row.CLA_PUESTO,
        claUbicacion: row.CLA_UBICACION,
        claDeptoAnt: row.CLA_DEPTO_ANT,
        claPuestoAnt: row.CLA_PUESTO_ANT,
        claUbicacionAnt: row.CLA_UBICACION_ANT,
        fechaUltCambio: row.FECHA_ULT_CAMBIO,
        claUsuario: row.CLA_USUARIO
      }
    }
  };
}

function parseHistorialLegadoFile(filePath) {
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

async function importarHistorialLegado(tenantId, empresaId, filePath, empleadoResolver, options = {}) {
  const { dryRun = false } = options;
  await ensureTiposMovimientoForTenant(tenantId);

  const orgMaps = await buildOrgLegadoMaps(tenantId, empresaId);
  const rows = parseHistorialLegadoFile(filePath);
  const movimientos = [];
  const omitidos = [];

  for (const row of rows) {
    const claTrab = String(row.CLA_TRAB || '').trim();
    const empleadoId = await empleadoResolver(claTrab, row);
    if (!empleadoId) {
      omitidos.push({ claTrab, motivo: 'Empleado no encontrado' });
      continue;
    }

    const doc = mapLegacyRowToHistorial(row, empleadoId, empresaId, tenantId, orgMaps);
    movimientos.push(doc);
  }

  const faltantes = orgMaps.resumenFaltantes();

  if (dryRun) {
    return { dryRun: true, total: movimientos.length, omitidos, movimientos, faltantes };
  }

  let insertados = 0;
  for (const m of movimientos) {
    await registrarMovimiento(m.tenantId, m.empresaId, m.empleadoId, m);
    insertados++;
  }

  return { dryRun: false, insertados, omitidos, totalFilas: rows.length, faltantes };
}

module.exports = {
  mapLegacyRowToHistorial,
  parseHistorialLegadoFile,
  importarHistorialLegado
};
