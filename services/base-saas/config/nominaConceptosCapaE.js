'use strict';

/**
 * Capa E: deducciones voluntarias post-fiscales (ej. cuota sindical).
 * ordenCalculo alto (~70) → después de ISR/IMSS/INFONAVIT/FONACOT.
 * El monto puede o no consumir el tope 30% según política de contrato.
 */

const VIGENCIA_CAPA_E = new Date('2026-08-12');

const CONCEPTOS_CAPA_E = [
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

function deduccionesTotalesCapaE() {
  return {
    formula:
      'ISR + IMSS_OBRERO + INFONAVIT + FONACOT + CUOTA_SINDICAL + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
    dependencias: [
      'ISR',
      'IMSS_OBRERO',
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

/**
 * Si base = neto_fiscal (flag cuotaSindicalUsaNetoFiscal=1), calcula % sobre
 * lo que queda tras retenciones de ley; si no, usa el monto ya resuelto en insumos.
 */
const FORMULA_CUOTA_SINDICAL =
  'si(cuotaSindicalUsaNetoFiscal == 1, max(0, SUELDO - ISR - IMSS_OBRERO - INFONAVIT - FONACOT) * cuotaSindicalPct / 100, cuotaSindicalDescuento)';

function buildCapaEFormulasForPeriodo(tipoPeriodo) {
  const dt = deduccionesTotalesCapaE();
  return [
    {
      conceptoCodigo: 'CUOTA_SINDICAL',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_CUOTA_SINDICAL,
      dependencias: ['SUELDO', 'ISR', 'IMSS_OBRERO', 'INFONAVIT', 'FONACOT'],
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

const FORMULAS_CAPA_E = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaEFormulasForPeriodo(tp));

module.exports = {
  CONCEPTOS_CAPA_E,
  FORMULAS_CAPA_E,
  VIGENCIA_CAPA_E,
  FORMULA_CUOTA_SINDICAL,
  buildCapaEFormulasForPeriodo,
  deduccionesTotalesCapaE
};
