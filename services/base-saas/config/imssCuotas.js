'use strict';

/**
 * Bases de cálculo IMSS (alineado a tabla oficial / Nominax).
 * - sbc: salario base de cotización diario × días
 * - uma: 1 UMA diaria × días (cuota fija EM)
 * - sbc_menos_3_uma: max(0, SBC − 3×UMA) × días
 * - prima_rt: SBC × días × prima de la empresa (0.5%–15%)
 * - ceav_tramo: solo en tabla IMSS_CEAV_PATRONAL (lookup por SBC)
 */
const BASES_CALCULO_IMSS = [
  { value: 'sbc', label: 'SBC (salario base de cotización)' },
  { value: 'uma', label: 'UMA (cuota fija)' },
  { value: 'sbc_menos_3_uma', label: 'Excedente SBC − 3 UMA' },
  { value: 'prima_rt', label: 'Prima RT empresa × SBC' }
];

const UNIDADES_LIMITE_CEAV = [
  { value: 'sm', label: 'Salario mínimo (SM)' },
  { value: 'uma', label: 'UMA' },
  { value: 'abs', label: 'Monto absoluto diario' }
];

module.exports = { BASES_CALCULO_IMSS, UNIDADES_LIMITE_CEAV };
