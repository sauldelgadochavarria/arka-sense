'use strict';

/**
 * Semilla LFT: aguinaldo 15, prima 25%, vacaciones por antigüedad (reforma 2023).
 * Alineado con config/vacacionesLFT.js
 *
 * Otras prestaciones (SGMM, vales, fondo, etc.) NO van en el factor LFT.
 * Se clasifican por tratamiento IMSS/SDI:
 * - solo_nomina: se pagan vía conceptos; no suman al SDI (típico: SGMM, vales
 *   dentro de previsión social / exenciones LSS Art. 27).
 * - monto_diario_sdi: importe diario fijo que SÍ integra SBC (excedentes o
 *   ayudas en efectivo recurrentes).
 * - dias_factor: días de salario al año que aumentan el factor (raro; p.ej.
 *   prestación contractual tipo “X días de sueldo”).
 */
const VACACIONES_LFT_TRAMOS = [
  { aniosDesde: 1, aniosHasta: 1, diasVacaciones: 12 },
  { aniosDesde: 2, aniosHasta: 2, diasVacaciones: 14 },
  { aniosDesde: 3, aniosHasta: 3, diasVacaciones: 16 },
  { aniosDesde: 4, aniosHasta: 4, diasVacaciones: 18 },
  { aniosDesde: 5, aniosHasta: 5, diasVacaciones: 20 },
  { aniosDesde: 6, aniosHasta: 6, diasVacaciones: 22 },
  { aniosDesde: 7, aniosHasta: 7, diasVacaciones: 24 },
  { aniosDesde: 8, aniosHasta: 8, diasVacaciones: 26 },
  { aniosDesde: 9, aniosHasta: 9, diasVacaciones: 28 },
  { aniosDesde: 10, aniosHasta: 10, diasVacaciones: 30 },
  { aniosDesde: 11, aniosHasta: 15, diasVacaciones: 32 },
  { aniosDesde: 16, aniosHasta: 20, diasVacaciones: 34 },
  { aniosDesde: 21, aniosHasta: 25, diasVacaciones: 36 },
  { aniosDesde: 26, aniosHasta: null, diasVacaciones: 38 }
];

const TRATAMIENTOS_PRESTACION = [
  { value: 'solo_nomina', label: 'Solo nómina (no integra SDI)' },
  { value: 'monto_diario_sdi', label: 'Monto diario → suma al SDI' },
  { value: 'dias_factor', label: 'Días/año → suman al factor' }
];

/** Catálogo sugerido; el usuario activa/ajusta por tabla. */
const OTRAS_PRESTACIONES_CATALOGO = [
  {
    codigo: 'SGMM',
    nombre: 'Seguro de gastos médicos mayores',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: 'Prima de seguro grupal: normalmente no integra SBC (LSS Art. 27).'
  },
  {
    codigo: 'VALES_DESPENSA',
    nombre: 'Vales de despensa',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: 'En vales autorizados suele no integrar hasta el tope LSS; el excedente → monto_diario_sdi.'
  },
  {
    codigo: 'FONDO_AHORRO',
    nombre: 'Fondo de ahorro',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: 'Si cumple reglas (aportaciones iguales y topes), no integra; excedente → monto_diario_sdi.'
  },
  {
    codigo: 'VALE_GASOLINA',
    nombre: 'Vale / ayuda de gasolina',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: 'Previsión social / herramienta de trabajo según diseño; si es efectivo recurrente que integra, usa monto_diario_sdi.'
  },
  {
    codigo: 'VALE_CINE',
    nombre: 'Vales de cine / entretenimiento',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: 'Previsión social: no integra SDI; se paga vía conceptos.'
  },
  {
    codigo: 'AYUDA_TRANSPORTE',
    nombre: 'Ayuda de transporte',
    tratamiento: 'monto_diario_sdi',
    valor: 0,
    notas: 'Si es efectivo fijo recurrente que integra IMSS, captura el monto diario.'
  },
  {
    codigo: 'OTRA',
    nombre: 'Otra prestación',
    tratamiento: 'solo_nomina',
    valor: 0,
    notas: ''
  }
];

function buildTablaGlobalDefault({ tenantId, empresaId }) {
  return {
    tenantId,
    empresaId,
    nombre: 'Prestaciones LFT (global)',
    ambito: 'global',
    tipoEmpleado: '',
    departamentoId: null,
    puestoId: null,
    diasAguinaldo: 15,
    primaVacacionalPct: 25,
    vacacionesPorAntiguedad: VACACIONES_LFT_TRAMOS,
    otrasPrestaciones: [],
    activo: true,
    notas: 'Tabla base de ley. Prioridad: puesto > departamento > tipo empleado > global.'
  };
}

module.exports = {
  VACACIONES_LFT_TRAMOS,
  TRATAMIENTOS_PRESTACION,
  OTRAS_PRESTACIONES_CATALOGO,
  buildTablaGlobalDefault
};
