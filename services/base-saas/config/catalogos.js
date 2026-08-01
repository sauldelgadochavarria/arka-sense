'use strict';

const MOTIVOS_BAJA = [
  'Renuncia voluntaria',
  'Término de contrato',
  'Despido justificado',
  'Despido injustificado',
  'Abandono de empleo',
  'Jubilación',
  'Defunción',
  'Otro'
];

const TIPOS_CONTRATO = [
  { value: 'indefinido', label: 'Indefinido' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'proyecto', label: 'Por proyecto' }
];

const ESTATUS_EMPLEADO = [
  { value: 'activo', label: 'Activo' },
  { value: 'suspendido', label: 'Suspendido' },
  { value: 'baja', label: 'Baja' }
];

const TIPOS_REGISTRO = [
  { value: 'ninguno', label: 'Ninguno (solo bitácora)' },
  { value: 'rol_turnos', label: 'Rol de turnos (calificación automática)' },
  { value: 'planilla', label: 'Planilla' }
];

const FORMULAS_CONCEPTO = [
  { value: 'salario_periodo', label: 'Salario del período' },
  { value: 'horas_extra', label: 'Horas extra' },
  { value: 'retardos', label: 'Retardos' },
  { value: 'faltas', label: 'Faltas' },
  { value: 'salida_anticipada', label: 'Salida anticipada' },
  { value: 'manual', label: 'Manual / personalizado' }
];

module.exports = {
  MOTIVOS_BAJA,
  TIPOS_CONTRATO,
  ESTATUS_EMPLEADO,
  TIPOS_REGISTRO,
  FORMULAS_CONCEPTO
};
