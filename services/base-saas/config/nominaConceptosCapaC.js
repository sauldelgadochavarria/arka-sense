'use strict';

/**
 * Capa C: fondo de ahorro — patrón CFDI / recibo:
 *   1 percepción  → FONDO_AHORRO_EMPRESA (SAT 005)
 *   2 deducciones → DED_FONDO_AHORRO (empleado) + DED_FONDO_AHORRO_EMPRESA (empresa)
 *
 * FONDO_AHORRO_TRABAJADOR queda solo como legado/inactivo (no debe salir en el recibo
 * como segunda percepción).
 */

const VIGENCIA_CAPA_C = new Date('2026-01-01');

const MAPEO_CANONICO_CAPA_C = {
  54: 'FONDO_AHORRO_EMPRESA',
  55: 'DED_FONDO_AHORRO', // legado: aportación trabajador → deducción
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
        codigoRegla: ''
      },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye' }
      }
    },
    metadata: { legadoClaPerded: 54, rolFondo: 'percepcion_empresa' }
  },
  {
    codigo: 'DED_FONDO_AHORRO',
    nombre: 'Deducción fondo de ahorro trabajador',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 57,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye' }
      }
    },
    metadata: { legadoClaPerded: 402, rolFondo: 'deduccion_trabajador' }
  },
  {
    codigo: 'DED_FONDO_AHORRO_EMPRESA',
    nombre: 'Deducción fondo de ahorro empresa',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    ordenCalculo: 58,
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado' },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye' }
      }
    },
    metadata: { rolFondo: 'deduccion_empresa' }
  },
  /**
   * Legado: antes se usaba como percepción informativa de la aportación del trabajador.
   * Ya no debe calcularse ni imprimirse; la aportación del trabajador va en DED_FONDO_AHORRO.
   */
  {
    codigo: 'FONDO_AHORRO_TRABAJADOR',
    nombre: 'Fondo de ahorro trabajador (legado — no usar)',
    tipo: 'percepcion',
    naturaleza: 'informativo',
    ordenCalculo: 37,
    sat: { tipo: 'percepcion', clave: '005', descripcion: 'Fondo de ahorro' },
    fiscal: {
      naturaleza: 'informativo',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento' },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye' }
      }
    },
    metadata: {
      legadoClaPerded: 55,
      esAportacionTrabajador: true,
      deprecado: true,
      reemplazo: 'DED_FONDO_AHORRO'
    }
  }
];

const TIPOS_PERIODO_FORMULA = ['semanal', 'quincenal', 'catorcenal', 'mensual'];

function percepcionesGravadasCapaC() {
  // El motor (acumularBasesFiscales) sobrescribe con suma de campos gravado.
  // No sumar importes crudos: HE dobles / fondos pueden tener porción exenta.
  return {
    formula: '0',
    dependencias: []
  };
}

function deduccionesTotalesCapaC() {
  return {
    formula:
      'ISR + IMSS_OBRERO + DED_FONDO_AHORRO + DED_FONDO_AHORRO_EMPRESA + DED_SEGURO_VIDA + DED_SGMM',
    dependencias: [
      'ISR',
      'IMSS_OBRERO',
      'DED_FONDO_AHORRO',
      'DED_FONDO_AHORRO_EMPRESA',
      'DED_SEGURO_VIDA',
      'DED_SGMM'
    ]
  };
}

/** Misma mitad; `si` evita importe si el empleado no tiene fondo. */
const FORMULA_FONDO_EMPRESA = 'si(aplicaFondoAhorro == 1, fondoAhorroEmpresa, 0)';
const FORMULA_FONDO_TRABAJADOR = 'si(aplicaFondoAhorro == 1, fondoAhorroTrabajador, 0)';

/** @deprecated usar FORMULA_FONDO_EMPRESA / FORMULA_FONDO_TRABAJADOR */
const FORMULA_FONDO_APORTACION_MITAD =
  'si(aplicaFondoAhorro == 1, sueldoDiario * diasLaborados * porcentajeFondoAhorro / 200, 0)';

const FORMULA_FONDO_TOPE_EXENTO =
  'min(sueldoDiario * diasLaborados * porcentajeFondoAhorro / 100, fondoAhorroTopeExento)';

const FORMULA_FONDO_EMPRESA_GRAVADO =
  'fondoAhorroEmpresaGravado';

function buildCapaCFormulasForPeriodo(tipoPeriodo) {
  const pg = percepcionesGravadasCapaC();
  const dt = deduccionesTotalesCapaC();

  return [
    {
      conceptoCodigo: 'FONDO_AHORRO_EMPRESA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_EMPRESA,
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'DED_FONDO_AHORRO',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_TRABAJADOR,
      dependencias: [],
      condicion: ''
    },
    {
      conceptoCodigo: 'DED_FONDO_AHORRO_EMPRESA',
      tipoPeriodo,
      tipoNomina: 'ordinaria',
      formula: FORMULA_FONDO_EMPRESA,
      dependencias: [],
      condicion: ''
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
  FORMULA_FONDO_EMPRESA,
  FORMULA_FONDO_TRABAJADOR,
  FORMULA_FONDO_TOPE_EXENTO,
  FORMULA_FONDO_EMPRESA_GRAVADO
};
