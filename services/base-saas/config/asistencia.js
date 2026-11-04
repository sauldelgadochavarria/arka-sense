'use strict';

const TIPOS_MARCACION = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'salida_comida', label: 'Salida a comida' },
  { value: 'regreso_comida', label: 'Regreso de comida' },
  { value: 'salida', label: 'Salida' }
];

const METODOS_REGISTRO = [
  { value: 'manual', label: 'Manual (web)' },
  { value: 'biometrico', label: 'Biométrico' },
  { value: 'movil', label: 'App móvil' },
  { value: 'rfid', label: 'RFID / tarjeta' },
  { value: 'automatico', label: 'Automática' }
];

const DIAS_SEMANA = [
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
  { value: 0, label: 'Domingo', short: 'Dom' }
];

const ESTATUS_DIARIO = {
  presente: 'Presente',
  retardo: 'Retardo',
  falta: 'Falta',
  incompleto: 'Incompleto',
  descanso: 'Descanso',
  registro_parcial: 'Registro parcial',
  fuera_de_rango: 'Fuera de rango',
  vacaciones: 'De vacaciones',
  anulada: 'Checada anulada'
};

const MODOS_TOLERANCIA = [
  { value: 'normal', label: 'Normal (retardo desde hora programada)' },
  { value: 'concorte', label: 'Concorte (retardo desde fin de tolerancia)' }
];

const TIPOS_TURNO = [
  { value: 'fijo', label: 'Turno fijo' },
  { value: 'flexible', label: 'Turno flexible' },
  { value: 'nocturno', label: 'Turno nocturno' },
  { value: 'remoto', label: 'Home office / remoto' },
  { value: 'por_horas', label: 'Por horas / medio tiempo' }
];

/** Política de geocerca en marcación móvil. `heredar` usa la del departamento. */
const POLITICAS_MARCAJE_GEO = [
  {
    value: 'heredar',
    label: 'Heredar del departamento'
  },
  {
    value: 'subsidiaria_default',
    label: 'Exigir: trabajador, si no departamento, si no subsidiaria'
  },
  {
    value: 'strict_assignment',
    label: 'Exigir: solo ubicaciones del trabajador'
  },
  {
    value: 'any_catalog_site',
    label: 'Exigir: cualquier ubicación del catálogo'
  },
  {
    value: 'open_with_flag',
    label: 'Permitir fuera de zona y marcar'
  },
  {
    value: 'disabled',
    label: 'Apagada'
  }
];

/** Interruptor del departamento. El círculo vive en la ubicación, no aquí. */
const POLITICAS_GEO_DEPARTAMENTO = [
  { value: 'subsidiaria_default', label: 'Exigir geocerca' },
  { value: 'open_with_flag', label: 'Permitir fuera de zona y marcar' },
  { value: 'disabled', label: 'Apagada' }
];

const DEFAULT_POLITICA_MARCAJE_GEO = 'open_with_flag';

const HOLGURA_DEFAULT_MIN = 180;

/** Recordatorios de checada (app móvil: locales offline + sync online). */
const RECORDATORIO_MINUTOS_ANTES_ENTRADA = Number(
  process.env.RECORDATORIO_MINUTOS_ANTES_ENTRADA || 15
);
const RECORDATORIO_MINUTOS_ANTES_SALIDA = Number(
  process.env.RECORDATORIO_MINUTOS_ANTES_SALIDA || 10
);
const RECORDATORIO_DIAS_ADELANTE = Number(process.env.RECORDATORIO_DIAS_ADELANTE || 7);

module.exports = {
  TIPOS_MARCACION,
  METODOS_REGISTRO,
  DIAS_SEMANA,
  ESTATUS_DIARIO,
  TIPOS_TURNO,
  MODOS_TOLERANCIA,
  POLITICAS_MARCAJE_GEO,
  POLITICAS_GEO_DEPARTAMENTO,
  DEFAULT_POLITICA_MARCAJE_GEO,
  HOLGURA_DEFAULT_MIN,
  RECORDATORIO_MINUTOS_ANTES_ENTRADA,
  RECORDATORIO_MINUTOS_ANTES_SALIDA,
  RECORDATORIO_DIAS_ADELANTE
};
