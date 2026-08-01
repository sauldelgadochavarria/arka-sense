'use strict';

/** Estatus del período de nómina/pre-nómina (ciclo de vida). */
const ESTATUS_PERIODO_NOMINA = {
  pendiente: 'Pendiente',
  abierto: 'Abierto',
  borrador: 'Borrador (calculado)',
  cerrado: 'Cerrado'
};

/** Estatus en los que se permite calcular pre-nómina / nómina. */
const ESTATUS_PERIODO_CALCULABLE = ['abierto'];

/** Estatus que bloquean otro período abierto del mismo tipo. */
const ESTATUS_PERIODO_OCUPA_VENTANA = ['abierto', 'borrador'];

const TIPOS_NOMINA_ESPECIALES = [
  { value: 'ordinaria', label: 'Ordinaria', esEspecial: false },
  { value: 'extraordinaria', label: 'Extraordinaria', esEspecial: false },
  { value: 'finiquito', label: 'Finiquito', esEspecial: true },
  { value: 'aguinaldo', label: 'Aguinaldo', esEspecial: true },
  { value: 'ptu', label: 'PTU', esEspecial: true },
  { value: 'primas', label: 'Primas vacacionales', esEspecial: true },
  { value: 'comisiones', label: 'Comisiones', esEspecial: true },
  { value: 'indemnizacion', label: 'Indemnización', esEspecial: true },
  { value: 'otro', label: 'Otro extraordinario', esEspecial: true }
];

const TIPOS_NOMINA_ORDINARIOS = TIPOS_NOMINA_ESPECIALES.filter((t) => !t.esEspecial);
const TIPOS_NOMINA_EXTRA = TIPOS_NOMINA_ESPECIALES.filter((t) => t.esEspecial);

module.exports = {
  ESTATUS_PERIODO_NOMINA,
  ESTATUS_PERIODO_CALCULABLE,
  ESTATUS_PERIODO_OCUPA_VENTANA,
  TIPOS_NOMINA_ESPECIALES,
  TIPOS_NOMINA_ORDINARIOS,
  TIPOS_NOMINA_EXTRA
};
