'use strict';

/**
 * Mapeo PeriodicidadPago SAT (Nómina 1.2) → tipoMotor interno.
 */
const SAT_TO_MOTOR = {
  2: { tipoMotor: 'semanal', diasPeriodo: 7, label: 'Semanal' },
  3: { tipoMotor: 'catorcenal', diasPeriodo: 14, label: 'Catorcenal' },
  4: { tipoMotor: 'quincenal', diasPeriodo: 15, label: 'Quincenal' },
  5: { tipoMotor: 'mensual', diasPeriodo: 30, label: 'Mensual' },
  10: { tipoMotor: 'decena', diasPeriodo: 10, label: 'Decena' }
};

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

function tipoNominaFromCfdi(tipoNomina) {
  return String(tipoNomina || '').toUpperCase() === 'E' ? 'extraordinaria' : 'ordinaria';
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
  normalizePeriodicidadSat,
  mapPeriodicidadSat,
  ymd,
  startOfUtcDay,
  endOfUtcDay,
  tipoNominaFromCfdi,
  periodBucketKey
};
