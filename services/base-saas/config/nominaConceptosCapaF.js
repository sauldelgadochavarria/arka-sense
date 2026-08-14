'use strict';

/**
 * Capa F: desglose IMSS CFDI
 * - IMSS_OBRERO → SAT 001 (seguridad social, sin CEAV)
 * - IMSS_RCV    → SAT 003 (cesantía y vejez)
 * - CUOTA_SINDICAL → SAT 019
 */

const VIGENCIA_CAPA_F = new Date('2026-08-12');

const CONCEPTOS_CAPA_F = [
  {
    codigo: 'IMSS_OBRERO',
    nombre: 'IMSS obrero (seguridad social)',
    tipo: 'deduccion',
    naturaleza: 'fiscal',
    ordenCalculo: 55,
    sat: { tipo: 'deduccion', clave: '001', descripcion: 'Seguridad social' },
    fiscal: {
      naturaleza: 'fiscal',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { requiereTablaFiscal: 'IMSS_CUOTAS', satRamo: 'ss' }
  },
  {
    codigo: 'IMSS_RCV',
    nombre: 'IMSS cesantía y vejez (RCV)',
    tipo: 'deduccion',
    naturaleza: 'fiscal',
    ordenCalculo: 55.5,
    sat: {
      tipo: 'deduccion',
      clave: '003',
      descripcion: 'Aportaciones a retiro, cesantía en edad avanzada y vejez'
    },
    fiscal: {
      naturaleza: 'fiscal',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { requiereTablaFiscal: 'IMSS_CUOTAS', satRamo: 'rcv' }
  },
  {
    codigo: 'CUOTA_SINDICAL',
    nombre: 'Cuota sindical',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 70,
    sat: { tipo: 'deduccion', clave: '019', descripcion: 'Cuotas sindicales' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { credito: 'sindical', voluntaria: true }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

const FORMULA_IMSS_SS = 'si(diasCotizacion > 0, imssObreroSs(sueldoDiario, diasCotizacion), 0)';
const FORMULA_IMSS_RCV = 'si(diasCotizacion > 0, imssObreroRcv(sueldoDiario, diasCotizacion), 0)';

function deduccionesTotalesCapaF() {
  return {
    formula:
      'ISR + IMSS_OBRERO + IMSS_RCV + INFONAVIT + FONACOT + CUOTA_SINDICAL + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
    dependencias: [
      'ISR',
      'IMSS_OBRERO',
      'IMSS_RCV',
      'INFONAVIT',
      'FONACOT',
      'CUOTA_SINDICAL',
      'DED_FONDO_AHORRO',
      'DED_FONDO_AHORRO_EMPRESA',
      'DED_SEGURO_VIDA',
      'DED_SGMM'
    ]
  };
}

const FORMULA_CUOTA_SINDICAL =
  'si(cuotaSindicalUsaNetoFiscal == 1, max(0, SUELDO - ISR - IMSS_OBRERO - IMSS_RCV - INFONAVIT - FONACOT) * cuotaSindicalPct / 100, cuotaSindicalDescuento)';

function buildCapaFFormulasForPeriodo(tipoPeriodo) {
  const dt = deduccionesTotalesCapaF();
  return [
    {
      conceptoCodigo: 'IMSS_OBRERO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_IMSS_SS,
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'IMSS_RCV',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_IMSS_RCV,
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'CUOTA_SINDICAL',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_CUOTA_SINDICAL,
      dependencias: ['SUELDO', 'ISR', 'IMSS_OBRERO', 'IMSS_RCV', 'INFONAVIT', 'FONACOT'],
      condicion: 'cuotaSindicalActiva == 1'
    },
    {
      conceptoCodigo: 'DEDUCCIONES_TOTALES',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: dt.formula,
      dependencias: dt.dependencias,
      condicion: ''
    }
  ];
}

const FORMULAS_CAPA_F = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaFFormulasForPeriodo(tp));

module.exports = {
  CONCEPTOS_CAPA_F,
  FORMULAS_CAPA_F,
  VIGENCIA_CAPA_F,
  FORMULA_IMSS_SS,
  FORMULA_IMSS_RCV,
  buildCapaFFormulasForPeriodo,
  deduccionesTotalesCapaF
};
