'use strict';

/**
 * Variables disponibles para layouts bancarios (header / detalle / footer).
 * path usa notación punto sobre el contexto de generación.
 */
const LAYOUT_BANCARIO_VARIABLES = {
  fecha: [
    {
      path: 'fecha.hoy',
      label: 'Hoy (fecha del sistema al generar)',
      tipo: 'date'
    },
    {
      path: 'fecha.hoyMas',
      label: 'Hoy + N días (usa columna «Días +»)',
      tipo: 'date'
    },
    {
      path: 'lote.fechaPago',
      label: 'Fecha de pago (capturada en el asistente)',
      tipo: 'date'
    },
    {
      path: 'lote.fechaGeneracion',
      label: 'Fecha de generación del archivo',
      tipo: 'date'
    }
  ],
  lote: [
    { path: 'lote.cantidadRecibos', label: 'Cantidad de recibos', tipo: 'number' },
    { path: 'lote.totalPagar', label: 'Total a pagar', tipo: 'money' },
    { path: 'lote.fechaGeneracion', label: 'Fecha generación', tipo: 'date' },
    { path: 'lote.fechaPago', label: 'Fecha de pago (captura)', tipo: 'date' },
    { path: 'lote.secuencia', label: 'Secuencia / folio archivo', tipo: 'string' }
  ],
  periodo: [
    { path: 'periodo.nombre', label: 'Nombre período', tipo: 'string' },
    { path: 'periodo.numeroPeriodo', label: 'Número período', tipo: 'number' },
    { path: 'periodo.tipoPeriodo', label: 'Tipo período', tipo: 'string' },
    { path: 'periodo.tipoNomina', label: 'Tipo nómina', tipo: 'string' },
    { path: 'periodo.fechaInicio', label: 'Fecha inicio', tipo: 'date' },
    { path: 'periodo.fechaFin', label: 'Fecha fin', tipo: 'date' },
    { path: 'periodo.anio', label: 'Año', tipo: 'number' }
  ],
  empresa: [
    { path: 'empresa.rfc', label: 'RFC empresa', tipo: 'string' },
    { path: 'empresa.razonSocial', label: 'Razón social', tipo: 'string' },
    { path: 'empresa.nombreComercial', label: 'Nombre comercial', tipo: 'string' }
  ],
  empleado: [
    { path: 'empleado.numEmpleado', label: 'No. empleado', tipo: 'string' },
    { path: 'empleado.nombre', label: 'Nombre completo', tipo: 'string' },
    { path: 'empleado.curp', label: 'CURP', tipo: 'string' },
    { path: 'empleado.rfc', label: 'RFC', tipo: 'string' },
    { path: 'empleado.banco', label: 'Código banco (3)', tipo: 'string' },
    { path: 'empleado.bancoNombre', label: 'Nombre banco', tipo: 'string' },
    { path: 'empleado.cuenta', label: 'Cuenta', tipo: 'string' },
    { path: 'empleado.clabe', label: 'CLABE', tipo: 'string' }
  ],
  recibo: [
    { path: 'recibo.neto', label: 'Neto a pagar', tipo: 'money' },
    { path: 'recibo.percepciones', label: 'Total percepciones', tipo: 'money' },
    { path: 'recibo.deducciones', label: 'Total deducciones', tipo: 'money' },
    { path: 'recibo.diasLaborados', label: 'Días laborados', tipo: 'number' },
    { path: 'recibo.calculoId', label: 'ID cálculo', tipo: 'string' }
  ]
};

const LAYOUT_BANCARIO_FORMATOS = [
  { value: 'align.izq', label: 'Texto izquierda (espacios)' },
  { value: 'align.der', label: 'Texto derecha (espacios)' },
  { value: '000', label: 'Entero con ceros a la izquierda' },
  { value: '0000000.00', label: 'Importe con decimales y ceros' },
  { value: 'ddmmaaaa', label: 'Fecha ddmmaaaa' },
  { value: 'dd-mm-aaaa', label: 'Fecha dd-mm-aaaa' },
  { value: 'aaaammdd', label: 'Fecha aaaammdd' },
  { value: 'yyyy-mm-dd', label: 'Fecha yyyy-mm-dd' },
  { value: 'space', label: 'Solo espacios' },
  { value: 'literal', label: 'Literal fijo (campo literal)' }
];

const LAYOUT_BANCARIO_MODOS = [
  { value: 'ancho_fijo', label: 'Ancho fijo' },
  { value: 'delimitado', label: 'Delimitado' },
  { value: 'xml', label: 'XML / plantilla' }
];

/** Ejemplo seed (detalle) inspirado en layouts de dispersión. */
const LAYOUT_EJEMPLO_DETALLE = [
  { path: 'empleado.curp', longitud: 18, formato: 'align.izq', orden: 1 },
  { path: 'empleado.nombre', longitud: 30, formato: 'align.der', orden: 2 },
  { path: 'periodo.nombre', longitud: 20, formato: 'align.der', orden: 3 },
  { path: 'recibo.neto', longitud: 10, formato: '0000000.00', orden: 4 },
  { path: 'empleado.banco', longitud: 3, formato: '000', orden: 5 },
  { path: 'empleado.cuenta', longitud: 18, formato: '000', orden: 6 },
  { path: 'lote.fechaPago', longitud: 8, formato: 'ddmmaaaa', orden: 7 },
  { path: 'lote.fechaPago', longitud: 8, formato: 'ddmmaaaa', orden: 8 },
  { path: '', longitud: 100, formato: 'space', orden: 9, literal: '' }
];

const LAYOUT_EJEMPLO_HEADER = [
  { path: '', longitud: 6, formato: 'literal', orden: 1, literal: 'HEADER' },
  { path: 'lote.cantidadRecibos', longitud: 6, formato: '000', orden: 2 },
  { path: 'lote.totalPagar', longitud: 14, formato: '0000000.00', orden: 3 },
  { path: 'lote.fechaPago', longitud: 8, formato: 'ddmmaaaa', orden: 4 }
];

const LAYOUT_EJEMPLO_FOOTER = [
  { path: '', longitud: 6, formato: 'literal', orden: 1, literal: 'FOOTER' },
  { path: 'lote.cantidadRecibos', longitud: 6, formato: '000', orden: 2 },
  { path: 'lote.totalPagar', longitud: 14, formato: '0000000.00', orden: 3 }
];

module.exports = {
  LAYOUT_BANCARIO_VARIABLES,
  LAYOUT_BANCARIO_FORMATOS,
  LAYOUT_BANCARIO_MODOS,
  LAYOUT_EJEMPLO_DETALLE,
  LAYOUT_EJEMPLO_HEADER,
  LAYOUT_EJEMPLO_FOOTER
};
