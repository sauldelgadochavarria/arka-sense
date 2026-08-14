'use strict';

/**
 * Capa D: créditos laborales — INFONAVIT (SAT 010) + FONACOT (SAT 011).
 * Actualiza DEDUCCIONES_TOTALES para incluir ambos.
 *
 * Montos vienen precalculados en insumos (`infonavitDescuento`, `fonacotDescuento`)
 * con tope legal FONACOT y prelación vs 30% del salario nominal.
 */

const VIGENCIA_CAPA_D = new Date('2026-08-12');

const CONCEPTOS_CAPA_D = [
  {
    codigo: 'INFONAVIT',
    nombre: 'Crédito INFONAVIT',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 54,
    sat: { tipo: 'deduccion', clave: '010', descripcion: 'Pago por crédito de vivienda' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { credito: 'infonavit' }
  },
  {
    codigo: 'FONACOT',
    nombre: 'Crédito FONACOT',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 55,
    sat: { tipo: 'deduccion', clave: '011', descripcion: 'Pago por crédito FONACOT' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: { naturalezaSdi: 'excluido', desglose: { modo: 'todo_excluye' } }
    },
    metadata: { credito: 'fonacot' }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function deduccionesTotalesCapaD() {
  return {
    formula:
      'ISR + IMSS_OBRERO + INFONAVIT + FONACOT + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
    dependencias: [
      'ISR',
      'IMSS_OBRERO',
      'INFONAVIT',
      'FONACOT',
      'DED_FONDO_AHORRO',
      'DED_FONDO_AHORRO_EMPRESA',
      'DED_SEGURO_VIDA',
      'DED_SGMM'
    ]
  };
}

function buildCapaDFormulasForPeriodo(tipoPeriodo) {
  const dt = deduccionesTotalesCapaD();
  return [
    {
      conceptoCodigo: 'INFONAVIT',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'infonavitDescuento',
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'FONACOT',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: 'fonacotDescuento',
      dependencias: [],
      condicion: ''
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

const FORMULAS_CAPA_D = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaDFormulasForPeriodo(tp));

module.exports = {
  CONCEPTOS_CAPA_D,
  FORMULAS_CAPA_D,
  VIGENCIA_CAPA_D,
  buildCapaDFormulasForPeriodo,
  deduccionesTotalesCapaD
};
