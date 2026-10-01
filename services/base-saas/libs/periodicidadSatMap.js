'use strict';

/**
 * Mapeo PeriodicidadPago SAT (Nómina 1.2) → tipoMotor interno.
 */
const SAT_TO_MOTOR = {
  1: { tipoMotor: 'otra', diasPeriodo: 1, label: 'Diario', evitarFallbackMotor: true },
  2: { tipoMotor: 'semanal', diasPeriodo: 7, label: 'Semanal' },
  3: { tipoMotor: 'catorcenal', diasPeriodo: 14, label: 'Catorcenal' },
  4: { tipoMotor: 'quincenal', diasPeriodo: 15, label: 'Quincenal' },
  5: { tipoMotor: 'mensual', diasPeriodo: 30, label: 'Mensual' },
  6: { tipoMotor: 'otra', diasPeriodo: 60, label: 'Bimestral', evitarFallbackMotor: true },
  7: { tipoMotor: 'otra', diasPeriodo: 0, label: 'Unidad obra', evitarFallbackMotor: true },
  8: { tipoMotor: 'otra', diasPeriodo: 0, label: 'Comisión', evitarFallbackMotor: true },
  9: { tipoMotor: 'otra', diasPeriodo: 0, label: 'Precio alzado', evitarFallbackMotor: true },
  10: { tipoMotor: 'decena', diasPeriodo: 10, label: 'Decena' },
  /**
   * SAT 99 = Otra Periodicidad → nóminas extraordinarias (aguinaldo, PTU, finiquito, etc.).
   * Nunca debe reutilizar un tipo «mensual» ordinario.
   */
  99: {
    tipoMotor: 'otra',
    diasPeriodo: 0,
    label: 'Otra periodicidad',
    evitarFallbackMotor: true,
    esOtraPeriodicidad: true
  }
};

/** TipoPercepcion SAT asociados a separación / finiquito / indemnización. */
const CLAVES_SAT_FINIQUITO = new Set(['022', '023', '025']);
const CLAVES_SAT_AGUINALDO = new Set(['002']);
const CLAVES_SAT_PTU = new Set(['003']);

function clavesSatFromConceptos(conceptos = []) {
  const out = new Set();
  for (const c of conceptos) {
    const k = String(c.claveSat || c.tipoSat || '')
      .padStart(3, '0')
      .slice(-3);
    if (k && k !== '000') out.add(k);
  }
  return out;
}

/**
 * Clasifica el tipo de nómina interno a partir del CFDI (O/E + separación + claves SAT).
 * @returns {'ordinaria'|'extraordinaria'|'finiquito'|'indemnizacion'|'aguinaldo'|'ptu'}
 */
function classifyTipoNominaFromCfdi(payload = {}) {
  const tip = String(payload.tipoNomina || 'O').toUpperCase();
  if (tip !== 'E') return 'ordinaria';

  const claves = clavesSatFromConceptos(payload.conceptos);
  const tieneSep = Boolean(payload.tieneSeparacion);
  const esFiniquito =
    tieneSep || [...claves].some((k) => CLAVES_SAT_FINIQUITO.has(k));

  if (esFiniquito) {
    // Indemnización “pura” (025) sin otros conceptos de sueldos → indemnizacion
    if (claves.has('025') && !claves.has('001') && !claves.has('022') && !claves.has('023')) {
      return 'indemnizacion';
    }
    return 'finiquito';
  }
  if ([...claves].some((k) => CLAVES_SAT_PTU.has(k))) return 'ptu';
  if ([...claves].some((k) => CLAVES_SAT_AGUINALDO.has(k)) && !claves.has('001')) {
    return 'aguinaldo';
  }
  return 'extraordinaria';
}

function esNominaBajaLaboral(payload = {}) {
  const t = classifyTipoNominaFromCfdi(payload);
  return t === 'finiquito' || t === 'indemnizacion';
}

function normalizePeriodicidadSat(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function mapPeriodicidadSat(raw) {
  const code = normalizePeriodicidadSat(raw);
  if (code == null) return null;
  const mapped = SAT_TO_MOTOR[code];
  if (!mapped) {
    return {
      code,
      tipoMotor: null,
      diasPeriodo: 0,
      label: `SAT ${code}`,
      soportado: false
    };
  }
  return { code, ...mapped, soportado: true };
}

function ymd(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfUtcDay(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function endOfUtcDay(d) {
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Compat: acepta string O/E o el payload completo del parser.
 */
function tipoNominaFromCfdi(tipoNominaOrPayload) {
  if (tipoNominaOrPayload && typeof tipoNominaOrPayload === 'object') {
    return classifyTipoNominaFromCfdi(tipoNominaOrPayload);
  }
  return String(tipoNominaOrPayload || '').toUpperCase() === 'E' ? 'extraordinaria' : 'ordinaria';
}

function periodBucketKey({ tipoPeriodoId, tipoNomina, fechaInicio, fechaFin }) {
  return [
    String(tipoPeriodoId || ''),
    tipoNomina || 'ordinaria',
    ymd(fechaInicio),
    ymd(fechaFin)
  ].join('|');
}

module.exports = {
  SAT_TO_MOTOR,
  CLAVES_SAT_FINIQUITO,
  CLAVES_SAT_AGUINALDO,
  CLAVES_SAT_PTU,
  normalizePeriodicidadSat,
  mapPeriodicidadSat,
  clavesSatFromConceptos,
  classifyTipoNominaFromCfdi,
  esNominaBajaLaboral,
  ymd,
  startOfUtcDay,
  endOfUtcDay,
  tipoNominaFromCfdi,
  periodBucketKey
};
