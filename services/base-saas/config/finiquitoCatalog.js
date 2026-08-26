'use strict';

/**
 * Catálogo y defaults del motor de finiquitos / liquidaciones (MX).
 * Valores legales son defaults parametrizables — no quemar en fórmulas.
 */

const CAUSAS_TERMINACION = [
  { codigo: 'RENUNCIA', nombre: 'Renuncia voluntaria', grupo: 'finiquito' },
  { codigo: 'DESPIDO_JUSTIFICADO', nombre: 'Rescisión con causa', grupo: 'finiquito' },
  { codigo: 'DESPIDO_INJUSTIFICADO', nombre: 'Terminación sin causa acreditada', grupo: 'liquidacion' },
  { codigo: 'MUTUO_ACUERDO', nombre: 'Mutuo consentimiento', grupo: 'finiquito' },
  { codigo: 'TERMINO_CONTRATO', nombre: 'Vencimiento de contrato', grupo: 'finiquito' },
  { codigo: 'TERMINO_OBRA', nombre: 'Terminación de obra', grupo: 'finiquito' },
  { codigo: 'INCAPACIDAD', nombre: 'Incapacidad que imposibilita continuar', grupo: 'finiquito' },
  { codigo: 'MUERTE', nombre: 'Fallecimiento del trabajador', grupo: 'finiquito' },
  { codigo: 'JUBILACION', nombre: 'Retiro / jubilación', grupo: 'finiquito' },
  { codigo: 'CONVENIO', nombre: 'Terminación mediante convenio', grupo: 'negociacion' },
  { codigo: 'OTRO', nombre: 'Caso especial', grupo: 'finiquito' }
];

/** Sugerencias por causa — el usuario puede sobrescribir en parámetros. */
const SUGERENCIA_COMPONENTES_POR_CAUSA = {
  RENUNCIA: {
    aplicaPrimaAntiguedadSiAnios: 15,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  DESPIDO_JUSTIFICADO: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  DESPIDO_INJUSTIFICADO: {
    aplicaPrimaAntiguedadSiAnios: 0,
    aplicaIndemnizacionTresMeses: true,
    aplica20DiasPorAnio: true,
    aplicaSalariosVencidos: false
  },
  MUTUO_ACUERDO: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  TERMINO_CONTRATO: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  TERMINO_OBRA: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  INCAPACIDAD: {
    aplicaPrimaAntiguedadSiAnios: 0,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  MUERTE: {
    aplicaPrimaAntiguedadSiAnios: 0,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  JUBILACION: {
    aplicaPrimaAntiguedadSiAnios: 0,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  CONVENIO: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  },
  OTRO: {
    aplicaPrimaAntiguedadSiAnios: null,
    aplicaIndemnizacionTresMeses: false,
    aplica20DiasPorAnio: false,
    aplicaSalariosVencidos: false
  }
};

const CONCEPTOS_FINIQUITO = [
  {
    codigo: 'FIN_SALARIO_PENDIENTE',
    nombre: 'Sueldo pendiente',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'NOMINA',
    grupo: 'finiquito',
    claveSAT: '001',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_AGUINALDO_PROPORCIONAL',
    nombre: 'Aguinaldo proporcional',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'finiquito',
    claveSAT: '002',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_VACACIONES_PENDIENTES',
    nombre: 'Vacaciones pendientes',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'finiquito',
    claveSAT: '001',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_VACACIONES_PROPORCIONALES',
    nombre: 'Vacaciones proporcionales',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'finiquito',
    claveSAT: '001',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_PRIMA_VACACIONAL',
    nombre: 'Prima vacacional',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'finiquito',
    claveSAT: '021',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_PRIMA_ANTIGUEDAD',
    nombre: 'Prima de antigüedad',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'LEY',
    grupo: 'liquidacion',
    claveSAT: '022',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_INDEMNIZACION_3_MESES',
    nombre: 'Indemnización 3 meses',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'LEY',
    grupo: 'liquidacion',
    claveSAT: '025',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_INDEMNIZACION_20_DIAS',
    nombre: 'Indemnización 20 días por año',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'LEY',
    grupo: 'liquidacion',
    claveSAT: '025',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_SALARIOS_VENCIDOS',
    nombre: 'Salarios vencidos',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'MANUAL',
    grupo: 'liquidacion',
    claveSAT: '025',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_FONDO_AHORRO',
    nombre: 'Fondo de ahorro pendiente',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'NOMINA',
    grupo: 'finiquito',
    claveSAT: '005',
    aplicaExencion90Uma: false
  },
  {
    /**
     * Bono / gratificación extraordinaria (desempeño, proyecto, etc.):
     * grava 100% ISR — NO entra a la bolsa 90×UMA.
     */
    codigo: 'FIN_GRATIFICACION',
    nombre: 'Gratificación / bono extraordinario',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'CONVENIO',
    grupo: 'negociacion',
    claveSAT: '038',
    aplicaExencion90Uma: false
  },
  {
    /** Pago por separación / mutuo acuerdo — sí participa en bolsa 90×UMA (SAT 023). */
    codigo: 'FIN_GRATIFICACION_SEPARACION',
    nombre: 'Gratificación por mutuo acuerdo (separación)',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'CONVENIO',
    grupo: 'negociacion',
    claveSAT: '023',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_CONVENIO',
    nombre: 'Ajuste de convenio (separación)',
    tipo: 'percepcion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'CONVENIO',
    grupo: 'negociacion',
    claveSAT: '023',
    aplicaExencion90Uma: true
  },
  {
    codigo: 'FIN_OTROS',
    nombre: 'Otros conceptos',
    tipo: 'percepcion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'MANUAL',
    grupo: 'finiquito',
    claveSAT: '',
    aplicaExencion90Uma: false
  },
  {
    codigo: 'FIN_PRESTAMO',
    nombre: 'Préstamo / anticipo',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'MANUAL',
    grupo: 'deduccion',
    claveSAT: '',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'manual'
  },
  {
    codigo: 'FIN_OTRAS_DEDUCCIONES',
    nombre: 'Otras deducciones',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'MANUAL',
    grupo: 'deduccion',
    claveSAT: '',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'manual'
  },
  {
    codigo: 'FIN_DED_ISR_NOMINA',
    nombre: 'ISR sobre sueldo pendiente',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'deduccion_nomina',
    claveSAT: '002',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_IMSS_SS',
    nombre: 'IMSS obrero (SS) días pendientes',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'deduccion_nomina',
    claveSAT: '001',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_IMSS_RCV',
    nombre: 'IMSS RCV (CEAV) días pendientes',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'deduccion_nomina',
    // c_TipoDeduccion 001 = Seguridad social (cuotas IMSS obrero, incl. RCV/CEAV)
    claveSAT: '001',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },

  {
    codigo: 'FIN_DED_INFONAVIT',
    nombre: 'INFONAVIT (proporcional días pendientes)',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'NOMINA',
    grupo: 'deduccion_nomina',
    claveSAT: '010',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_FONACOT',
    nombre: 'FONACOT (proporcional días pendientes)',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'NOMINA',
    grupo: 'deduccion_nomina',
    claveSAT: '011',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_FONDO_AHORRO',
    nombre: 'Fondo de ahorro trabajador (días pendientes)',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'NOMINA',
    grupo: 'deduccion_nomina',
    claveSAT: '004',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_EMPRESA',
    nombre: 'Descuento empresa / préstamo',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'MANUAL',
    grupo: 'deduccion_nomina',
    claveSAT: '004',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'nomina'
  },
  {
    codigo: 'FIN_DED_ISR_FINIQUITO',
    nombre: 'ISR sobre conceptos de finiquito',
    tipo: 'deduccion',
    tipoFiscal: 'ORDINARIO',
    origenDefault: 'LEY',
    grupo: 'deduccion_finiquito',
    claveSAT: '002',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'finiquito'
  },
  {
    codigo: 'FIN_DED_ISR_SEPARACION',
    nombre: 'ISR estimado pagos por separación (Art. 95)',
    tipo: 'deduccion',
    tipoFiscal: 'SEPARACION',
    origenDefault: 'LEY',
    grupo: 'deduccion_separacion',
    claveSAT: '002',
    aplicaExencion90Uma: false,
    bloqueDeduccion: 'separacion'
  }
];

/** Percepciones que se tratan como “nómina pendiente” (días a pagar), no como finiquito. */
const CODIGOS_BLOQUE_NOMINA = ['FIN_SALARIO_PENDIENTE'];

/** Defaults fiscales Art. 93 fr. XIII (parametrizables en parametros_generales). */
const DEFAULTS_FISCAL_SEPARACION = {
  multiplicadorExencionSeparacion: 90,
  diasRedondeoAnioLisr: 183,
  diasAnioLisr: 365
};

const ESTATUS_FINIQUITO = [
  { value: 'borrador', label: 'Borrador' },
  { value: 'calculado', label: 'Calculado' },
  { value: 'revisado', label: 'Revisado' },
  { value: 'autorizado', label: 'Autorizado' },
  { value: 'pagado', label: 'Pagado' },
  { value: 'timbrado', label: 'Timbrado' },
  { value: 'cancelado', label: 'Cancelado' }
];

const ORIGENES_CONCEPTO = ['LEY', 'CONTRATO', 'POLITICA_EMPRESA', 'NOMINA', 'CONVENIO', 'MANUAL'];

/** Defaults legales LFT (parametrizables). */
const DEFAULTS_FINIQUITO = {
  diasAguinaldo: 15,
  porcentajePrimaVacacional: 0.25,
  diasPrimaAntiguedadPorAnio: 12,
  /** Arts. 485 y 486 LFT: tope de base = N × salario mínimo de la zona. */
  vecesSalarioMinimoTopeLft: 2,
  diasMesIndemnizacion: 30,
  mesesIndemnizacion: 3,
  diasIndemnizacionPorAnio: 20,
  diasAnio: null, // null = auto (365/366)
  usarAniosProporcionalesIndemnizacion: true,
  /** Prima antigüedad: por defecto años completos (no fracción), Art. 162. */
  usarAniosProporcionalesPrima: false,
  redondeoDecimalesInternos: 6,
  redondeoDecimalesImporte: 2
};

function causaByCodigo(codigo) {
  return CAUSAS_TERMINACION.find((c) => c.codigo === String(codigo || '').toUpperCase()) || null;
}

function conceptoByCodigo(codigo) {
  return CONCEPTOS_FINIQUITO.find((c) => c.codigo === String(codigo || '').toUpperCase()) || null;
}

function sugerenciaPorCausa(codigo) {
  const key = String(codigo || '').toUpperCase();
  return SUGERENCIA_COMPONENTES_POR_CAUSA[key] || SUGERENCIA_COMPONENTES_POR_CAUSA.OTRO;
}

/** Mapeo desde textos legados de MOTIVOS_BAJA. */
function mapMotivoBajaToCausa(motivoBaja) {
  const t = String(motivoBaja || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  if (t.includes('renuncia')) return 'RENUNCIA';
  if (t.includes('injustificado')) return 'DESPIDO_INJUSTIFICADO';
  if (t.includes('justificado') || t.includes('rescision')) return 'DESPIDO_JUSTIFICADO';
  if (t.includes('contrato') || t.includes('termino')) return 'TERMINO_CONTRATO';
  if (t.includes('jubil')) return 'JUBILACION';
  if (t.includes('defunc') || t.includes('muerte') || t.includes('fallec')) return 'MUERTE';
  if (t.includes('abandono')) return 'RENUNCIA';
  if (t.includes('convenio') || t.includes('mutuo')) return 'MUTUO_ACUERDO';
  return 'OTRO';
}

module.exports = {
  CAUSAS_TERMINACION,
  SUGERENCIA_COMPONENTES_POR_CAUSA,
  CONCEPTOS_FINIQUITO,
  CODIGOS_BLOQUE_NOMINA,
  DEFAULTS_FISCAL_SEPARACION,
  ESTATUS_FINIQUITO,
  ORIGENES_CONCEPTO,
  DEFAULTS_FINIQUITO,
  causaByCodigo,
  conceptoByCodigo,
  sugerenciaPorCausa,
  mapMotivoBajaToCausa
};
