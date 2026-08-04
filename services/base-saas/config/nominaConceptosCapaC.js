'use strict';

/**
 * Capa C: fondo de ahorro (empresa, trabajador, deducción).
 */

const VIGENCIA_CAPA_C = new Date('2026-01-01');

const MAPEO_CANONICO_CAPA_C = {
  54: 'FONDO_AHORRO_EMPRESA',
  55: 'FONDO_AHORRO_TRABAJADOR',
  402: 'DED_FONDO_AHORRO'
};

const PRIORIDAD_CAPA_C_IDS = [54, 55, 402];

const CONCEPTOS_CAPA_C = [
  {
    codigo: 'FONDO_AHORRO_EMPRESA',
    nombre: 'Fondo de ahorro empresa',
    tipo: 'percepcion',
    naturaleza: 'mixto',
    ordenCalculo: 36,
    sat: { tipo: 'percepcion', clave: '005', descripcion: 'Fondo de ahorro' },
    fiscal: {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'formula',
        formulaExento: 'fondoAhorroEmpresaExento',
        formulaGravado: 'fondoAhorroEmpresaGravado',
        codigoRegla: 'fondo_ahorro'
      }
    },
    metadata: { legadoClaPerded: 54 }
  },
  {
    codigo: 'FONDO_AHORRO_TRABAJADOR',
    nombre: 'Fondo de ahorro trabajador',
    tipo: 'percepcion',
    naturaleza: 'informativo',
    ordenCalculo: 37,
    sat: { tipo: 'percepcion', clave: '005', descripcion: 'Fondo de ahorro' },
    fiscal: {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' }
    },
    metadata: { legadoClaPerded: 55, esAportacionTrabajador: true }
  },
  {
    codigo: 'DED_FONDO_AHORRO',
    nombre: 'Deducción fondo de ahorro trabajador',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 57,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    metadata: { legadoClaPerded: 402 }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function percepcionesGravadasCapaC() {
  // Solo la parte gravada del fondo empresa entra al ISR (excedente sobre tope exento).
  return {
    formula: 'SUELDO + fondoAhorroEmpresaGravado',
    dependencias: ['SUELDO']
  };
}

function deduccionesTotalesCapaC() {
  return {
    formula: 'ISR + IMSS_OBRERO + DED_FONDO_AHORRO',
    dependencias: ['ISR', 'IMSS_OBRERO', 'DED_FONDO_AHORRO']
  };
}

/** Fórmulas editables (mathjs) — equivalentes al cálculo JS de nominaEmpleadoInsumos.
 * No usar round(x,n): el scope de nómina redefine round = Math.round (1 arg).
 * El redondeo a 2 decimales lo aplica el concepto (campo redondeo).
 */
const FORMULA_FONDO_APORTACION_MITAD =
  'aplicaFondoAhorro * (sueldoDiario * diasLaborados * porcentajeFondoAhorro / 200)';

const FORMULA_FONDO_TOPE_EXENTO =
  'min(sueldoDiario * diasLaborados * porcentajeFondoAhorro / 100, topeUmaFondoAhorro * uma * diasPeriodo)';

const FORMULA_FONDO_EMPRESA_GRAVADO =
  `max(0, (${FORMULA_FONDO_APORTACION_MITAD}) - min((${FORMULA_FONDO_APORTACION_MITAD}), ${FORMULA_FONDO_TOPE_EXENTO}))`;

function buildCapaCFormulasForPeriodo(tipoPeriodo) {
  const pg = percepcionesGravadasCapaC();
  const dt = deduccionesTotalesCapaC();

  return [
    {
      conceptoCodigo: 'FONDO_AHORRO_EMPRESA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_APORTACION_MITAD,
      dependencias: [],
      condicion: 'aplicaFondoAhorro == 1'
    },
    {
      conceptoCodigo: 'FONDO_AHORRO_TRABAJADOR',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_APORTACION_MITAD,
      dependencias: [],
      condicion: 'aplicaFondoAhorro == 1'
    },
    {
      conceptoCodigo: 'DED_FONDO_AHORRO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_APORTACION_MITAD,
      dependencias: [],
      condicion: 'aplicaFondoAhorro == 1'
    },
    {
      conceptoCodigo: 'PERCEPCIONES_GRAVADAS',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: pg.formula,
      dependencias: pg.dependencias,
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

const FORMULAS_CAPA_C = TIPOS_PERIODO_FORMULA.flatMap((tp) => buildCapaCFormulasForPeriodo(tp));

module.exports = {
  MAPEO_CANONICO_CAPA_C,
  PRIORIDAD_CAPA_C_IDS,
  CONCEPTOS_CAPA_C,
  FORMULAS_CAPA_C,
  VIGENCIA_CAPA_C,
  buildCapaCFormulasForPeriodo,
  FORMULA_FONDO_APORTACION_MITAD,
  FORMULA_FONDO_TOPE_EXENTO,
  FORMULA_FONDO_EMPRESA_GRAVADO
};
