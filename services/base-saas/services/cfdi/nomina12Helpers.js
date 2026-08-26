'use strict';

const { PERIODICIDAD_SAT } = require('../../config/tipoPeriodoDefaults');

const SAT_CLAVE_FALLBACK = {
  SUELDO: '001',
  SUELDO_DIARIO: '001',
  ISR: '002',
  IMSS_OBRERO: '001',
  IMSS: '001',
  INFONAVIT: '010',
  FONACOT: '011',
  FONDO_AHORRO: '005',
  DED_FONDO_AHORRO: '004',
  PREMIO_ASISTENCIA: '010',
  HORAS_EXTRA: '019',
  AGUINALDO: '002',
  PRIMA_VACACIONAL: '021',
  VACACIONES: '001',
  DESPENSA: '029',
  SUBSIDIO_EMPLEO: '002',
  OTRO_PAGO_SUBSIDIO: '002',
  // Finiquito / liquidación
  FIN_SALARIO_PENDIENTE: '001',
  FIN_AGUINALDO_PROPORCIONAL: '002',
  FIN_VACACIONES_PENDIENTES: '001',
  FIN_VACACIONES_PROPORCIONALES: '001',
  FIN_PRIMA_VACACIONAL: '021',
  FIN_PRIMA_ANTIGUEDAD: '022',
  FIN_INDEMNIZACION_3_MESES: '025',
  FIN_INDEMNIZACION_20_DIAS: '025',
  FIN_SALARIOS_VENCIDOS: '025',
  FIN_DED_ISR_NOMINA: '002',
  FIN_DED_IMSS_SS: '001',
  FIN_DED_IMSS_RCV: '001',
  FIN_DED_INFONAVIT: '010',
  FIN_DED_FONACOT: '011',
  FIN_DED_FONDO_AHORRO: '004',
  FIN_DED_EMPRESA: '004',
  FIN_DED_ISR_FINIQUITO: '002',
  FIN_DED_ISR_SEPARACION: '002'
};

/** Clave interna del patrón en Nómina 1.2 (3–15 caracteres). */
const CLAVE_INTERNA_FALLBACK = {
  FIN_SALARIO_PENDIENTE: '00100',
  FIN_AGUINALDO_PROPORCIONAL: '00200',
  FIN_VACACIONES_PENDIENTES: '00110',
  FIN_VACACIONES_PROPORCIONALES: '00120',
  FIN_PRIMA_VACACIONAL: '02100',
  FIN_PRIMA_ANTIGUEDAD: '02200',
  FIN_INDEMNIZACION_3_MESES: '02500',
  FIN_INDEMNIZACION_20_DIAS: '02510',
  FIN_SALARIOS_VENCIDOS: '02520',
  FIN_DED_ISR_NOMINA: '00201',
  FIN_DED_IMSS_SS: '00101',
  FIN_DED_IMSS_RCV: '00102',
  FIN_DED_INFONAVIT: '01000',
  FIN_DED_FONACOT: '01100',
  FIN_DED_FONDO_AHORRO: '00401',
  FIN_DED_EMPRESA: '00402',
  FIN_DED_ISR_FINIQUITO: '00202',
  FIN_DED_ISR_SEPARACION: '00203'
};

const TIPO_CONTRATO_SAT = {
  indefinido: '01',
  temporal: '03',
  eventual: '05',
  proyecto: '05',
  capacitacion: '07',
  determinado: '03',
  obra: '05',
  temporada: '08',
  prueba: '07'
};

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function moneyStr(n) {
  return money(n).toFixed(2);
}

function ymd(d) {
  const x = d instanceof Date ? d : d ? new Date(d) : new Date();
  if (Number.isNaN(x.getTime())) return new Date().toISOString().slice(0, 10);
  return x.toISOString().slice(0, 10);
}

/** Fecha CFDI 4.0 sin zona (local MX aproximada vía ISO slice). */
function cfdiFecha(d) {
  const x = d instanceof Date ? d : new Date();
  return x.toISOString().slice(0, 19);
}

function satCode(v, fallback = '') {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{2,3})/);
  if (m) return m[1].padStart(3, '0').slice(-3);
  if (/^\d{2,3}$/.test(s)) return s.padStart(3, '0').slice(-3);
  return fallback;
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function joinNombre(emp) {
  if (!emp) return '';
  if (emp.nombre) return String(emp.nombre).trim();
  return [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Antigüedad SAT P{n}W (semanas) — simplificado desde fecha ingreso.
 */
function antiguedadSat(fechaIngreso, fechaRef = new Date()) {
  const fi = fechaIngreso ? new Date(fechaIngreso) : null;
  const fr = fechaRef ? new Date(fechaRef) : new Date();
  if (!fi || Number.isNaN(fi.getTime()) || Number.isNaN(fr.getTime())) return 'P0W';
  const ms = Math.max(0, fr.getTime() - fi.getTime());
  const semanas = Math.floor(ms / (7 * 24 * 60 * 60 * 1000));
  return `P${semanas}W`;
}

function tipoNominaCfdi(periodo = {}) {
  const t = String(periodo.tipoNomina || '').toLowerCase();
  if (t.includes('finiquito') || t.includes('indemnizacion') || t.includes('liquidacion')) return 'E';
  return 'O';
}

function periodicidadSat(periodo = {}, empleado = {}) {
  const sat = Number(periodo.periodicidadPagoSat || periodo.periodicidadPago);
  if (Number.isFinite(sat) && sat > 0) return String(sat).padStart(2, '0');
  const tipo = String(periodo.tipoPeriodo || empleado.tipoPeriodoNombre || '').toLowerCase();
  for (const p of PERIODICIDAD_SAT || []) {
    if (tipo.includes(String(p.label || '').toLowerCase())) return String(p.value).padStart(2, '0');
  }
  if (tipo.includes('quincen')) return '04';
  if (tipo.includes('seman')) return '02';
  if (tipo.includes('mens')) return '05';
  return '04';
}

function clasificarConcepto(c, meta = {}) {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  if (['ISR_SAT', 'NETO_PAGAR', 'PERCEPCIONES_TOTALES', 'DEDUCCIONES_TOTALES'].includes(code)) {
    return 'skip';
  }
  const tipo = String(c.tipo || meta.tipo || '').toLowerCase();
  const nat = String(meta.naturaleza || '').toLowerCase();
  if (tipo.includes('deduc') || nat === 'deduccion' || c.tipo === 'deduccion') return 'deduccion';
  if (tipo.includes('otro') || nat === 'otro_pago') return 'otro_pago';
  return 'percepcion';
}

function claveSatDe(c, meta = {}) {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  // Preferir mapa explícito para códigos internos (evita claves SAT erróneas del catálogo).
  if (SAT_CLAVE_FALLBACK[code]) return SAT_CLAVE_FALLBACK[code];
  const raw = String(c.claveSAT || meta.claveSAT || c.sat?.clave || '').trim();
  if (raw) return satCode(raw, raw);
  return '001';
}

/**
 * Clave del patrón (atributo Clave en Percepcion/Deduccion): 3–15 chars.
 * No usar el código interno largo (p.ej. FIN_DED_ISR_NOMINA).
 */
function claveInternaDe(c, meta = {}, claveSat = '') {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  if (CLAVE_INTERNA_FALLBACK[code]) return CLAVE_INTERNA_FALLBACK[code];
  const fromMeta = String(meta.claveInterna || c.claveInterna || '').replace(/[^A-Za-z0-9]/g, '');
  if (fromMeta.length >= 3) return fromMeta.slice(0, 15);
  const sat = String(claveSat || claveSatDe(c, meta) || '001').padStart(3, '0');
  return sat.slice(0, 15);
}

function nombreConceptoDe(c, meta = {}) {
  return (
    String(meta.nombre || c.descripcion || c.nombre || '').trim() ||
    String(c.conceptoCodigo || c.codigo || 'Concepto').trim()
  ).slice(0, 100);
}

function importeConcepto(c) {
  if (c.importeFinal != null) return money(c.importeFinal);
  if (c.importe != null) return money(c.importe);
  return 0;
}

function gravadoConcepto(c) {
  if (c.gravadoISR != null) return money(c.gravadoISR);
  if (c.gravado != null) return money(c.gravado);
  if (c.isr?.gravado != null) return money(c.isr.gravado);
  return 0;
}

function exentoConcepto(c) {
  if (c.exentoISR != null) return money(c.exentoISR);
  if (c.exento != null) return money(c.exento);
  if (c.isr?.exento != null) return money(c.isr.exento);
  return 0;
}

function urlTimbradoParaFormato(urlTimbrado, formato) {
  const url = String(urlTimbrado || '').trim();
  if (String(formato).toUpperCase() !== 'XML') return url;
  // JSON jsontoxml (v3) → emisión XML multipart (sin prefijo v3)
  if (url.includes('/v3/cfdi33/issue/json/')) {
    return url.replace('/v3/cfdi33/issue/json/', '/cfdi33/issue/');
  }
  if (url.includes('/issue/json/')) return url.replace('/issue/json/', '/issue/');
  if (url.includes('/json/v4')) return url.replace('/json/v4', '/v4');
  return url;
}

module.exports = {
  SAT_CLAVE_FALLBACK,
  CLAVE_INTERNA_FALLBACK,
  TIPO_CONTRATO_SAT,
  money,
  moneyStr,
  ymd,
  cfdiFecha,
  satCode,
  escXml,
  joinNombre,
  antiguedadSat,
  tipoNominaCfdi,
  periodicidadSat,
  clasificarConcepto,
  claveSatDe,
  claveInternaDe,
  nombreConceptoDe,
  importeConcepto,
  gravadoConcepto,
  exentoConcepto,
  urlTimbradoParaFormato
};
