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
  { value: 'rfid', label: 'RFID / tarjeta' }
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
  fuera_de_rango: 'Fuera de rango'
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

const HOLGURA_DEFAULT_MIN = 180;

module.exports = {
  TIPOS_MARCACION,
  METODOS_REGISTRO,
  DIAS_SEMANA,
  ESTATUS_DIARIO,
  TIPOS_TURNO,
  MODOS_TOLERANCIA,
  HOLGURA_DEFAULT_MIN
};
