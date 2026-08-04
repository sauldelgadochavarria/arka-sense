'use strict';

const CATALOGOS_SAT = [
  { value: 'c_TipoPercepcion', label: 'Percepciones (SAT)' },
  { value: 'c_TipoDeduccion', label: 'Deducciones (SAT)' },
  { value: 'c_TipoOtroPago', label: 'Otros pagos (SAT)' },
  { value: 'c_TipoHorasExtra', label: 'Horas extra (SAT)' }
];

const TIPOS_MAPEO_LEGADO = [
  { value: 'tipo_perded_sat', label: 'Tipo percepción/deducción legado' },
  { value: 'tipo_hora_extra_sat', label: 'Tipo hora extra legado' },
  { value: 'tipo_otro_pago_sat', label: 'Tipo otro pago legado' }
];

const PARAMETROS_FISCALES_PERMITIDOS = [
  { clave: 'UMA', label: 'UMA', descripcion: 'Unidad de Medida y Actualización (diaria; editable cada año)' },
  {
    clave: 'SALARIO_MINIMO',
    label: 'Salario mínimo',
    descripcion: 'Salario mínimo diario general'
  },
  {
    clave: 'FONDO_AHORRO_PORC',
    label: '% Fondo de ahorro',
    descripcion: 'Porcentaje máximo del salario (default 13). Tope exento = menor entre este % y 1.3×UMA anual'
  },
  {
    clave: 'FONDO_AHORRO_TOPE_UMA',
    label: 'Fondo ahorro — factor UMA',
    descripcion: 'Veces la UMA anual para tope exento (default 1.3 → ≈ 1.3×UMA×365)'
  },
  {
    clave: 'FONDO_AHORRO_DIAS_ANIO',
    label: 'Fondo ahorro — días año UMA',
    descripcion: 'Días para UMA anual (default 365)'
  },
  {
    clave: 'IMSS_TOPE_UMA',
    label: 'Tope SBC (veces UMA)',
    descripcion: 'Tope de SBC en veces UMA (default 25)'
  }
];

const CODIGOS_TABLA_FISCAL = [
  { value: 'ISR_MENSUAL', label: 'ISR mensual (Art. 96 LISR)', tipo: 'isr' },
  {
    value: 'IMSS_CUOTAS',
    label: 'IMSS cuotas obrero-patronal (ramos)',
    tipo: 'imss_cuotas'
  },
  {
    value: 'IMSS_CEAV_PATRONAL',
    label: 'IMSS CEAV patronal por tramos SBC',
    tipo: 'imss_ceav'
  },
  // Legado (se sigue mostrando si existe en BD)
  {
    value: 'IMSS_OBRERO',
    label: 'IMSS obrero (legado)',
    tipo: 'imss'
  },
  {
    value: 'IMSS_PATRONAL',
    label: 'IMSS patronal (legado)',
    tipo: 'imss'
  }
];

function tipoTablaFiscal(codigo) {
  const found = CODIGOS_TABLA_FISCAL.find((c) => c.value === String(codigo || '').toUpperCase());
  return found?.tipo || 'isr';
}

const PERIODICIDADES_TABLA = [
  { value: 'diario', label: 'Diario' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'anual', label: 'Anual' }
];

const TIPOS_HORA_EXTRA_MOTOR = [
  { value: 'DO', label: 'Dobles' },
  { value: 'TE', label: 'Triples' },
  { value: 'SIMPLE', label: 'Simples' }
];

const TIPOS_CREDITO_INFONAVIT = [
  { value: '', label: 'Sin crédito INFONAVIT' },
  { value: 'porcentaje', label: 'Porcentaje sobre sueldo integrado' },
  { value: 'vsm', label: 'Veces salario mínimo (VSM)' },
  { value: 'cuota_fija', label: 'Cuota fija semanal' }
];

module.exports = {
  CATALOGOS_SAT,
  TIPOS_MAPEO_LEGADO,
  PARAMETROS_FISCALES_PERMITIDOS,
  TIPOS_HORA_EXTRA_MOTOR,
  CODIGOS_TABLA_FISCAL,
  PERIODICIDADES_TABLA,
  TIPOS_CREDITO_INFONAVIT,
  tipoTablaFiscal
};
