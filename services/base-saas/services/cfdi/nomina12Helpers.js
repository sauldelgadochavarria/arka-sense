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
  HORAS_EXTRA_DOBLES: '019',
  HORAS_EXTRA_TRIPLES: '019',
  HORAS_EXTRA_SENCILLAS: '019',
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

/** Fecha-hora CFDI 4.0 en zona América/México_City (sin offset), p.ej. 2026-09-23T19:49:51 */
function cfdiFecha(d) {
  const x = d instanceof Date ? d : d ? new Date(d) : new Date();
  const safe = Number.isNaN(x.getTime()) ? new Date() : x;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(safe);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Dígito verificador CLABE (NOM64).
 * @returns {boolean}
 */
function isValidClabe(clabe) {
  const d = String(clabe || '').replace(/\D/g, '');
  if (d.length !== 18 || !/^\d{18}$/.test(d)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += (Number(d[i]) * weights[i % 3]) % 10;
  }
  const expected = (10 - (sum % 10)) % 10;
  return Number(d[17]) === expected;
}

/**
 * Normaliza clave numérica SAT.
 * @param {string|number} v
 * @param {string} fallback
 * @param {number} [len=3] longitud (RégimenFiscal=3; TipoContrato/TipoRegimen/TipoJornada=2)
 */
function satCode(v, fallback = '', len = 3) {
  const width = Number(len) > 0 ? Number(len) : 3;
  const digits = String(v || '')
    .trim()
    .replace(/\D/g, '');
  if (digits) return digits.padStart(width, '0').slice(-width);
  const fb = String(fallback || '').replace(/\D/g, '');
  if (fb) return fb.padStart(width, '0').slice(-width);
  return fallback || '';
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

/** Conceptos que nunca van al complemento CFDI Nómina 1.2 (informativos / acumuladores / motor). */
const CFDI_SKIP_CODIGOS = new Set([
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'IMSS_PATRONAL',
  'NETO_PAGAR',
  'PERCEPCIONES_TOTALES',
  'DEDUCCIONES_TOTALES',
  'PERCEPCIONES_GRAVADAS',
  'PERCEPCIONES_EXENTAS',
  'BASE_ISR',
  'BASE_IMSS'
]);

function esCodigoCfdiSkip(code) {
  const c = String(code || '').toUpperCase();
  if (!c) return false;
  if (CFDI_SKIP_CODIGOS.has(c)) return true;
  // Líneas del motor ISR dual (cualquier ISR_* excepto el ISR fiscal del recibo)
  if (c.startsWith('ISR_') && c !== 'ISR') return true;
  // Cuotas / aportaciones patronales (no restan del trabajador)
  if (c.includes('PATRONAL')) return true;
  return false;
}

function clasificarConcepto(c, meta = {}) {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  if (esCodigoCfdiSkip(code)) return 'skip';

  const nat = String(
    c.naturaleza ||
      c.fiscal?.naturaleza ||
      meta.naturaleza ||
      meta.fiscal?.naturaleza ||
      ''
  ).toLowerCase();
  if (
    nat === 'informativo' ||
    c.metadata?.informativo === true ||
    meta.informativo === true ||
    meta.metadata?.informativo === true
  ) {
    return 'skip';
  }

  const tipo = String(c.tipo || meta.tipo || meta.satTipo || '').toLowerCase();
  if (tipo.includes('deduc') || c.tipo === 'deduccion') return 'deduccion';
  if (tipo.includes('otro') || nat === 'otro_pago' || c.tipo === 'otro_pago') return 'otro_pago';
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
  // JSON → XML multipart (docs SW: /v4/cfdi33/issue/v4)
  if (url.includes('/v3/cfdi33/issue/json/')) {
    return url.replace('/v3/cfdi33/issue/json/', '/v4/cfdi33/issue/');
  }
  if (url.includes('/v4/cfdi33/issue/json/')) {
    return url.replace('/v4/cfdi33/issue/json/', '/v4/cfdi33/issue/');
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
  esCodigoCfdiSkip,
  CFDI_SKIP_CODIGOS,
  claveSatDe,
  claveInternaDe,
  nombreConceptoDe,
  importeConcepto,
  gravadoConcepto,
  exentoConcepto,
  isValidClabe,
  urlTimbradoParaFormato
};
