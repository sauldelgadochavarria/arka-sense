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
  { value: 'indefinido', label: 'Indefinido (planta)' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'eventual', label: 'Eventual' },
  { value: 'proyecto', label: 'Por proyecto' },
  { value: 'capacitacion', label: 'Aprendizaje / capacitación' }
];

const TIPOS_EMPLEADO = [
  { value: 'confianza', label: 'Confianza' },
  { value: 'sindicalizado', label: 'Sindicalizado' }
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
  TIPOS_EMPLEADO,
  ESTATUS_EMPLEADO,
  TIPOS_REGISTRO,
  FORMULAS_CONCEPTO
};
