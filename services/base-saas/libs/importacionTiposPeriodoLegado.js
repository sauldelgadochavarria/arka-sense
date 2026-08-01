'use strict';

const fs = require('fs');
const path = require('path');
const { parseTsvLine } = require('./importacionConceptosLegado');

const TIPO_MOTOR_MAP = {
  2: 'semanal',
  5: 'mensual',
  4: 'quincenal',
  10: 'decena'
};

function boolFrom(val) {
  return Number(val) === 1;
}

function mapLegacyRowToTipoPeriodo(row, tenantId, empresaId) {
  const periodicidad = Number(row.PERIODICIDAD_PAGO_SAT);
  const tipoMotor = TIPO_MOTOR_MAP[periodicidad] || 'quincenal';

  return {
    tenantId,
    empresaId,
    codigoLegado: Number(row.CLA_PERIODO),
    nombre: String(row.NOM_PERIODO || '').trim(),
    tipoMotor,
    diasPeriodo: Number(row.DIAS_PER) || 0,
    esSeptimo: boolFrom(row.ES_SEPTIMO),
    diasLaborables: Number(row.DIAS_LAB) || 0,
    leyenda: String(row.LEYENDA_PER || '').trim(),
    periodicidadPagoSat: Number.isFinite(periodicidad) ? periodicidad : null,
    aplicaAsistenciaPrenomina: tipoMotor !== 'mensual',
    compartirConNomina: true,
    activo: true,
    metadata: {
      legado: {
        claEmpresa: row.CLA_EMPRESA,
        claDesglose: row.CLA_DESGLOSE,
        folioNom: row.FOLIO_NOM,
        tablaPer: row.TABLA_PER,
        tablaMen: row.TABLA_MEN,
        tablaAnu: row.TABLA_ANU,
        tipoPeriodo: row.TIPO_PERIODO,
        diasMes: row.DIAS_MES,
        diasAnio: row.DIAS_ANIO,
        fechaUltCambio: row.FECHA_ULT_CAMBIO
      }
    }
  };
}

function parseTiposPeriodoLegadoFile(filePath) {
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

async function importarTiposPeriodoLegado(tenantId, empresaId, filePath, TipoPeriodoModel, options = {}) {
  const { dryRun = false } = options;
  const rows = parseTiposPeriodoLegadoFile(filePath);
  const docs = rows.map((row) => mapLegacyRowToTipoPeriodo(row, tenantId, empresaId));

  if (dryRun) {
    return { dryRun: true, total: docs.length, docs };
  }

  let upserted = 0;
  for (const doc of docs) {
    await TipoPeriodoModel.updateOne(
      { tenantId, codigoLegado: doc.codigoLegado },
      { $set: doc },
      { upsert: true }
    );
    upserted++;
  }

  return { dryRun: false, upserted, totalFilas: rows.length };
}

module.exports = {
  mapLegacyRowToTipoPeriodo,
  parseTiposPeriodoLegadoFile,
  importarTiposPeriodoLegado
};
