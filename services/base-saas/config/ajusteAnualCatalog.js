'use strict';

/** Propósito del tabulador / campaña de ajuste. */
const PROPOSITOS_AJUSTE = [
  { value: 'inflacion', label: 'Inflación / costo de vida' },
  { value: 'mercado', label: 'Alinear con mercado' },
  { value: 'retencion', label: 'Retener talento clave' },
  { value: 'combinacion', label: 'Combinación' }
];

/**
 * Cómo se calcula el incremento.
 * tipoNomina del período no aplica: la población se filtra por tipo de período de pago.
 */
const MODOS_CALCULO = [
  { value: 'porcentaje', label: 'Porcentaje uniforme' },
  { value: 'presupuesto', label: 'Presupuesto a distribuir (masa salarial)' },
  { value: 'matriz', label: 'Matriz desempeño × incremento' },
  { value: 'carga_empleado', label: 'Carga por empleado (CSV / evaluaciones)' }
];

/** Cadena de autorización (sin Director TI). */
const ETAPAS_AUTORIZACION = [
  { codigo: 'lider_equipo', nombre: 'Líder de equipo' },
  { codigo: 'rrhh', nombre: 'RRHH' },
  { codigo: 'finanzas', nombre: 'Finanzas' }
];

const ESTATUS_LOTE = [
  'borrador',
  'en_autorizacion',
  'autorizado',
  'aplicado',
  'rechazado',
  'cancelado'
];

/** % default por nivel de desempeño 1–5 (matriz). */
const MATRIZ_DESEMPENO_DEFAULT = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 10
};

const DIAS_MES_REF = 30.4;

/** Tasa patronal IMSS aproximada (sin prima RT) sobre SBC para proyección de costo. */
const TASA_IMSS_PATRONAL_BASE = 0.15;

/** INFONAVIT patronal. */
const TASA_INFONAVIT_PATRONAL = 0.05;

/** ISN estatal de referencia si la empresa no captura tasa. */
const TASA_ISN_DEFAULT = 0.025;

const CSV_PLANTILLA = `numEmpleado,desempeno,compaRatio,porcentaje,salarioDiarioNuevo
100,5,0.92,8,
101,3,1.05,,
102,4,0.88,,420.50`;

module.exports = {
  PROPOSITOS_AJUSTE,
  MODOS_CALCULO,
  ETAPAS_AUTORIZACION,
  ESTATUS_LOTE,
  MATRIZ_DESEMPENO_DEFAULT,
  DIAS_MES_REF,
  TASA_IMSS_PATRONAL_BASE,
  TASA_INFONAVIT_PATRONAL,
  TASA_ISN_DEFAULT,
  CSV_PLANTILLA
};
