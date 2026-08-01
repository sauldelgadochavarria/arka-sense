'use strict';

/**
 * Parser y mapeo de catálogo Fortia/Ingenios (TSV) → modelo PayPilot.
 * Capa A: metadatos sin fórmulas SQL.
 */

const fs = require('fs');
const path = require('path');

const SAT_POR_TIPO_LEGACY = {
  percepcion: {
    1: { clave: '001', descripcion: 'Sueldos, salarios y rayas' },
    2: { clave: '002', descripcion: 'Aguinaldo' },
    3: { clave: '003', descripcion: 'PTU' },
    20: { clave: '020', descripcion: 'Prima dominical' },
    21: { clave: '021', descripcion: 'Prima vacacional' },
    38: { clave: '038', descripcion: 'Otros ingresos por salarios' }
  },
  deduccion: {
    1: { clave: '001', descripcion: 'Seguridad social' },
    2: { clave: '002', descripcion: 'ISR' },
    4: { clave: '004', descripcion: 'Otros' },
    10: { clave: '010', descripcion: 'Pago por crédito de vivienda' }
  },
  otro_pago: {
    2: { clave: '002', descripcion: 'Subsidio para el empleo' }
  }
};

const HORA_EXTRA_LEGACY = {
  1: 'SIMPLE',
  2: 'DO',
  3: 'TE'
};

function legacyCodigo(claPerded) {
  return `L${String(claPerded).padStart(4, '0')}`;
}

function parseTsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '\t' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else cur += ch;
  }
  result.push(cur);
  return result.map((s) => s.replace(/^"|"$/g, '').trim());
}

function parseConceptosLegadoFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Archivo no encontrado: ${abs}`);
  }
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error('El archivo no contiene filas de datos');
  }

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

function flagActivo(val) {
  const v = String(val || '').trim().toUpperCase();
  return v === 'A' || v === '1';
}

function intFlag(val) {
  return String(val || '').trim() === '1';
}

function mapTipoConcepto(row) {
  const otroPago = row.TIPO_OTRO_PAGO_SAT;
  if (otroPago && otroPago !== 'NULL' && otroPago !== '0') {
    return 'otro_pago';
  }
  const tipo = Number(row.TIPO_PERDED);
  if (tipo === 50) return 'deduccion';
  if (tipo === 10) return 'percepcion';
  return 'percepcion';
}

function mapAplicaTipoNomina(row) {
  const tipos = [];
  if (intFlag(row.NOM_NOR)) tipos.push('ordinaria');
  if (intFlag(row.NOM_AGUI)) tipos.push('aguinaldo');
  if (intFlag(row.NOM_PTU) || intFlag(row.NOM_ESP)) tipos.push('extraordinaria');
  if (intFlag(row.NOM_FIN)) tipos.push('finiquito');
  if (intFlag(row.NOM_VAC) && !tipos.includes('extraordinaria')) {
    tipos.push('extraordinaria');
  }
  return tipos.length ? tipos : ['ordinaria'];
}

function mapNaturaleza(row, tipo) {
  const nombre = String(row.NOM_PERDED || '').toUpperCase();
  if (intFlag(row.ES_NETO) || intFlag(row.NO_AFECTAR_NETO)) return 'informativo';
  if (tipo === 'deduccion' && (nombre.includes('I.S.R') || nombre.includes('IMSS') || nombre.includes('I.M.S.S'))) {
    return 'fiscal';
  }
  if (row.EXENCION && row.EXENCION !== 'NULL') return 'gravado';
  if (String(row.TRATA_FISCAL || '').toUpperCase() === 'T') return 'exento';
  return 'gravado';
}

function mapSatFromLegacy(row, tipo, mapeos = null) {
  const otroPago = row.TIPO_OTRO_PAGO_SAT;
  if (otroPago && otroPago !== 'NULL' && otroPago !== '0') {
    const mapaOtro = mapeos?.porOtroPago?.get(String(otroPago));
    if (mapaOtro) {
      return {
        tipo: 'otro_pago',
        clave: mapaOtro.clave,
        descripcion: mapaOtro.descripcion,
        gravado: true,
        exentoLeyMonto: 0,
        tipoHoraExtra: ''
      };
    }
  }

  const tipoSat = row.TIPO_PERDED_SAT;
  const bucket = mapeos?.porTipoPerded?.[tipo];
  const entrada = bucket?.get(String(tipoSat));
  const sat = {
    tipo,
    clave: entrada?.clave || '',
    descripcion: entrada?.descripcion || '',
    gravado: mapNaturaleza(row, tipo) !== 'exento',
    exentoLeyMonto: 0,
    tipoHoraExtra: ''
  };

  const he = row.TIPO_HORA_EXTRA_SAT;
  if (he && he !== 'NULL') {
    const mapaHe = mapeos?.porHoraExtra?.get(String(he));
    if (mapaHe) {
      sat.tipoHoraExtra = mapaHe.tipoHoraExtra || HORA_EXTRA_LEGACY[Number(he)] || String(he);
      if (!sat.clave) sat.clave = mapaHe.clave || '019';
      if (!sat.descripcion) sat.descripcion = mapaHe.descripcion || 'Horas extra';
    } else {
      sat.tipoHoraExtra = HORA_EXTRA_LEGACY[Number(he)] || String(he);
      if (!sat.clave) sat.clave = '019';
      if (!sat.descripcion) sat.descripcion = 'Horas extra';
    }
  }

  return sat;
}

function extractDependenciasLegado(formula) {
  if (!formula || formula === 'NULL') return [];
  const deps = new Set();
  const refConcepto = formula.match(/@C(\d+)/gi) || [];
  for (const m of refConcepto) {
    const id = m.replace(/@C/i, '');
    deps.add(legacyCodigo(id));
  }
  return [...deps];
}

function mapLegacyRowToConcepto(row, tenantId, empresaId, options = {}) {
  const claPerded = Number(row.CLA_PERDED);
  if (!Number.isFinite(claPerded)) return null;

  const soloActivos = options.soloActivos !== false;
  if (soloActivos && !flagActivo(row.STATUS)) return null;

  if (options.claEmpresa != null && Number(row.CLA_EMPRESA) !== Number(options.claEmpresa)) {
    return null;
  }

  const tipo = mapTipoConcepto(row);
  const codigo = legacyCodigo(claPerded);
  const nombre = String(row.NOM_PERDED || '').trim() || `Concepto ${claPerded}`;
  const sat = mapSatFromLegacy(row, tipo, options.mapeos || null);

  return {
    tenantId,
    empresaId,
    codigo,
    nombre,
    tipo,
    naturaleza: mapNaturaleza(row, tipo),
    claveSAT: sat.clave,
    gravado: sat.gravado,
    aplicaTipoNomina: mapAplicaTipoNomina(row),
    ordenCalculo: Number(row.ORDEN) || 100,
    dependientes: [],
    activo: flagActivo(row.STATUS),
    sat,
    metadata: {
      legado: {
        fuente: 'fortia',
        claPerded,
        claEmpresa: Number(row.CLA_EMPRESA),
        nomCorto: String(row.NOM_CORTO || '').trim(),
        formulaLogica: String(row.FORMULA || '').trim(),
        formulaSql: String(row.FORMULA_SQL || '').trim(),
        exencion: String(row.EXENCION || '').trim(),
        topeExen: String(row.TOPE_EXEN || '').trim(),
        whereSql: String(row.AVANZADO_WHERE_SQL || '').trim(),
        bases: {
          imss: intFlag(row.ESBASE_IMSS),
          nomina: intFlag(row.ESBASE_NOMINA),
          infonavit: intFlag(row.ESBASE_INFON),
          ptu: intFlag(row.ESBASE_PTU),
          isr: intFlag(row.ESBASE_ISPT)
        },
        dependenciasLegado: extractDependenciasLegado(row.FORMULA),
        redondeo: Number(row.DECIMALES) || 2,
        importadoEn: new Date().toISOString()
      }
    }
  };
}

function resumirImportacion(conceptos) {
  const porTipo = { percepcion: 0, deduccion: 0, otro_pago: 0 };
  for (const c of conceptos) {
    porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1;
  }
  return {
    total: conceptos.length,
    porTipo,
    ordenMin: Math.min(...conceptos.map((c) => c.ordenCalculo)),
    ordenMax: Math.max(...conceptos.map((c) => c.ordenCalculo))
  };
}

module.exports = {
  legacyCodigo,
  parseTsvLine,
  parseConceptosLegadoFile,
  mapLegacyRowToConcepto,
  resumirImportacion,
  SAT_POR_TIPO_LEGACY,
  HORA_EXTRA_LEGACY
};
