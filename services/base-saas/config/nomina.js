'use strict';

const MODULO_NOMINA = {
  clave: 'nomina',
  titulo: 'Nómina',
  descripcion:
    'Motor parametrizable de nómina: conceptos, fórmulas por período, tablas fiscales y cálculo con trazabilidad.',
  version: '0.2.0-motor'
};

const SECCIONES_NOMINA = [
  {
    slug: 'periodos',
    titulo: 'Períodos de nómina',
    descripcion: 'Apertura, cálculo, revisión y cierre de períodos de nómina.',
    ruta: '/nomina/periodos',
    estado: 'activo'
  },
  {
    slug: 'conceptos',
    titulo: 'Conceptos de nómina',
    descripcion: 'Catálogo, fórmulas por tipo de período y validación de dependencias.',
    ruta: '/nomina/conceptos',
    estado: 'activo'
  },
  {
    slug: 'configuracion',
    titulo: 'Configuración',
    descripcion: 'Tablas ISR, parámetros UMA, salario mínimo y catálogo SAT.',
    ruta: '/nomina/configuracion',
    estado: 'activo'
  },
  {
    slug: 'catalogos',
    titulo: 'Catálogos',
    descripcion: 'SAT, mapeo legado Fortia y parámetros fiscales editables.',
    ruta: '/nomina/catalogos',
    estado: 'activo'
  }
];

const RELACION_PRENOMINA =
  'La pre-nómina (asistencia → incidencias) alimenta insumos; este módulo ejecuta el cálculo formal con fórmulas parametrizables.';

const TIPOS_PERIODO = [
  { value: 'semanal', label: 'Semanal' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'catorcenal', label: 'Catorcenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'decena', label: 'Decena' }
];

const TIPOS_NOMINA = [
  { value: 'ordinaria', label: 'Ordinaria' },
  { value: 'extraordinaria', label: 'Extraordinaria' },
  { value: 'finiquito', label: 'Finiquito' },
  { value: 'aguinaldo', label: 'Aguinaldo' },
  { value: 'ptu', label: 'PTU' },
  { value: 'primas', label: 'Primas vacacionales' },
  { value: 'comisiones', label: 'Comisiones' },
  { value: 'indemnizacion', label: 'Indemnización' },
  { value: 'otro', label: 'Otro extraordinario' }
];

const TIPOS_CONCEPTO = [
  { value: 'percepcion', label: 'Percepción' },
  { value: 'deduccion', label: 'Deducción' },
  { value: 'otro_pago', label: 'Otro pago' }
];

const NATURALEZAS_CONCEPTO = [
  { value: 'fiscal', label: 'Fiscal' },
  { value: 'gravado', label: 'Gravado' },
  { value: 'exento', label: 'Exento' },
  { value: 'mixto', label: 'Mixto' },
  { value: 'informativo', label: 'Informativo' }
];

const ESTATUS_PERIODO_NOMINA = {
  abierto: 'Abierto',
  calculando: 'Calculando…',
  calculado: 'Calculado',
  cerrado: 'Cerrado'
};

/** Categorías para agrupar variables en el editor de fórmulas. */
const CATEGORIAS_VARIABLES = [
  { id: 'periodo', label: 'Período y asistencia', descripcion: 'Días, faltas y métricas del período de nómina.' },
  { id: 'salario', label: 'Salario e insumos del empleado', descripcion: 'Sueldo diario, antigüedad y datos del expediente.' },
  { id: 'fiscal', label: 'Parámetros fiscales', descripcion: 'UMA, salario mínimo y base de cotización.' },
  { id: 'horas_extra', label: 'Horas extra', descripcion: 'Cantidades de HE dobles y triples del período.' },
  { id: 'prenomina', label: 'Pre-nómina / asistencia', descripcion: 'Totales y métricas provenientes del módulo de asistencia.' },
  { id: 'prestaciones', label: 'Prestaciones e insumos especiales', descripcion: 'INFONAVIT, fondo de ahorro, prima vacacional y finiquito.' },
  { id: 'conceptos_percepcion', label: 'Conceptos — Percepciones', descripcion: 'Resultado de otros conceptos de percepción ya calculados.' },
  { id: 'conceptos_deduccion', label: 'Conceptos — Deducciones', descripcion: 'Resultado de otros conceptos de deducción ya calculados.' },
  { id: 'conceptos_otro', label: 'Conceptos — Otros pagos', descripcion: 'Resultado de conceptos tipo otro pago.' }
];

/**
 * Variables de contexto disponibles en fórmulas (además de códigos de concepto).
 * categoria → id de CATEGORIAS_VARIABLES
 */
const VARIABLES_CONTEXTO = [
  {
    key: 'diasPeriodo',
    label: 'Días del período',
    tipo: 'number',
    categoria: 'periodo',
    descripcion: 'Cantidad de días naturales del período (ej. 15 en quincena, 7 en semanal).',
    ejemplo: 15
  },
  {
    key: 'diasLaborados',
    label: 'Días laborados',
    tipo: 'number',
    categoria: 'periodo',
    descripcion: 'Días efectivamente trabajados (presente/retardo) en el período.',
    ejemplo: 14
  },
  {
    key: 'faltas',
    label: 'Faltas',
    tipo: 'number',
    categoria: 'periodo',
    descripcion: 'Días de falta injustificada en el período.',
    ejemplo: 1
  },
  {
    key: 'sueldoDiario',
    label: 'Sueldo diario',
    tipo: 'number',
    categoria: 'salario',
    descripcion: 'Salario diario del empleado (SDI / salario diario contratado).',
    ejemplo: 500
  },
  {
    key: 'antiguedadAnios',
    label: 'Antigüedad (años)',
    tipo: 'number',
    categoria: 'salario',
    descripcion: 'Años de antigüedad al cierre del período (para vacaciones, prima, etc.).',
    ejemplo: 3
  },
  {
    key: 'uma',
    label: 'UMA vigente',
    tipo: 'number',
    categoria: 'fiscal',
    descripcion: 'Unidad de Medida y Actualización vigente (parámetro fiscal).',
    ejemplo: 113.14
  },
  {
    key: 'salarioMinimo',
    label: 'Salario mínimo',
    tipo: 'number',
    categoria: 'fiscal',
    descripcion: 'Salario mínimo diario vigente (zona general o fronteriza según config).',
    ejemplo: 278.8
  },
  {
    key: 'sbc',
    label: 'Salario base de cotización',
    tipo: 'number',
    categoria: 'fiscal',
    descripcion: 'SBC diario con tope de 25 UMA, usado en IMSS.',
    ejemplo: 500
  },
  {
    key: 'horasExtraDobles',
    label: 'Horas extra dobles',
    tipo: 'number',
    categoria: 'horas_extra',
    descripcion: 'Horas extras al doble (primeras 9 semanales según LFT).',
    ejemplo: 4
  },
  {
    key: 'horasExtraTriples',
    label: 'Horas extra triples',
    tipo: 'number',
    categoria: 'horas_extra',
    descripcion: 'Horas extras al triple (excedente de las 9 semanales).',
    ejemplo: 0
  },
  {
    key: 'minutosRetardo',
    label: 'Minutos de retardo',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Suma de minutos de retardo del período (desde pre-nómina / asistencia).',
    ejemplo: 45
  },
  {
    key: 'llegadasTarde',
    label: 'Llegadas tarde (días)',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Cantidad de días con llegada tarde / retardo en el período.',
    ejemplo: 0
  },
  {
    key: 'diasConRetardo',
    label: 'Días con retardo',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Alias de llegadasTarde.',
    ejemplo: 0
  },
  {
    key: 'sinRetardo',
    label: 'Sin retardo (0/1)',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: '1 si no hubo retardos; ideal para premio de puntualidad.',
    ejemplo: 1
  },
  {
    key: 'INCIDENCIAS.minutosRetardo',
    label: 'INCIDENCIAS.minutosRetardo',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Namespace: minutos de retardo acumulados.',
    ejemplo: 0
  },
  {
    key: 'INCIDENCIAS.llegadasTarde',
    label: 'INCIDENCIAS.llegadasTarde',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Namespace: días con llegada tarde.',
    ejemplo: 0
  },
  {
    key: 'INCIDENCIAS.sinRetardo',
    label: 'INCIDENCIAS.sinRetardo',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Namespace: 1 si puntual (sin retardos).',
    ejemplo: 1
  },
  {
    key: 'percepcionPrenomina',
    label: 'Percepciones pre-nómina',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Total de percepciones calculadas en el período de pre-nómina vinculado.',
    ejemplo: 7000
  },
  {
    key: 'deduccionPrenomina',
    label: 'Deducciones pre-nómina',
    tipo: 'number',
    categoria: 'prenomina',
    descripcion: 'Total de deducciones calculadas en el período de pre-nómina vinculado.',
    ejemplo: 350
  },
  {
    key: 'infonavitDescuento',
    label: 'Descuento INFONAVIT',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Monto de descuento INFONAVIT del empleado en el período.',
    ejemplo: 800
  },
  {
    key: 'fondoAhorroEmpresa',
    label: 'Fondo de ahorro (empresa)',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Aportación patronal al fondo de ahorro del período.',
    ejemplo: 200
  },
  {
    key: 'fondoAhorroTrabajador',
    label: 'Fondo de ahorro (trabajador)',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Aportación del trabajador al fondo de ahorro del período.',
    ejemplo: 200
  },
  {
    key: 'diasPrimaVacacional',
    label: 'Días prima vacacional',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Días de vacaciones sobre los que aplica la prima vacacional.',
    ejemplo: 12
  },
  {
    key: 'proporcionAguinaldoFiniquito',
    label: 'Aguinaldo proporcional (finiquito)',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Monto de aguinaldo proporcional calculado para finiquito.',
    ejemplo: 2500
  },
  {
    key: 'fondoAhorroSaldoFiniquito',
    label: 'Saldo fondo ahorro (finiquito)',
    tipo: 'number',
    categoria: 'prestaciones',
    descripcion: 'Saldo acumulado del fondo de ahorro a entregar en finiquito.',
    ejemplo: 4800
  },
  {
    key: 'EMPLEADO.salarioDiario',
    label: 'EMPLEADO.salarioDiario',
    tipo: 'number',
    categoria: 'salario',
    descripcion: 'Namespace: salario diario del empleado (preferido en fórmulas nuevas).',
    ejemplo: 500
  },
  {
    key: 'EMPLEADO.horasJornada',
    label: 'EMPLEADO.horasJornada',
    tipo: 'number',
    categoria: 'salario',
    descripcion: 'Horas de jornada del empleado / turno (default 8).',
    ejemplo: 8
  },
  {
    key: 'PERIODO.diasTrabajados',
    label: 'PERIODO.diasTrabajados',
    tipo: 'number',
    categoria: 'periodo',
    descripcion: 'Namespace: días trabajados del período.',
    ejemplo: 14
  },
  {
    key: 'INCIDENCIAS.faltas',
    label: 'INCIDENCIAS.faltas',
    tipo: 'number',
    categoria: 'periodo',
    descripcion: 'Namespace: faltas del período.',
    ejemplo: 1
  },
  {
    key: 'INCIDENCIAS.horasExtraDobles',
    label: 'INCIDENCIAS.horasExtraDobles',
    tipo: 'number',
    categoria: 'horas_extra',
    descripcion: 'Namespace: horas extra dobles acumuladas.',
    ejemplo: 4
  },
  {
    key: 'INCIDENCIAS.horasExtraTriples',
    label: 'INCIDENCIAS.horasExtraTriples',
    tipo: 'number',
    categoria: 'horas_extra',
    descripcion: 'Namespace: horas extra triples.',
    ejemplo: 0
  },
  {
    key: 'PARAMETROS.uma',
    label: 'PARAMETROS.uma',
    tipo: 'number',
    categoria: 'fiscal',
    descripcion: 'Namespace: UMA vigente del período.',
    ejemplo: 113.14
  }
];

function groupVariablesByCategoria(variables = VARIABLES_CONTEXTO) {
  const byCat = new Map();
  for (const cat of CATEGORIAS_VARIABLES) {
    byCat.set(cat.id, { ...cat, variables: [] });
  }
  for (const v of variables) {
    const catId = v.categoria || 'periodo';
    if (!byCat.has(catId)) {
      byCat.set(catId, { id: catId, label: catId, descripcion: '', variables: [] });
    }
    byCat.get(catId).variables.push(v);
  }
  return [...byCat.values()].filter((g) => g.variables.length > 0);
}

module.exports = {
  MODULO_NOMINA,
  SECCIONES_NOMINA,
  RELACION_PRENOMINA,
  TIPOS_PERIODO,
  TIPOS_NOMINA,
  TIPOS_CONCEPTO,
  NATURALEZAS_CONCEPTO,
  ESTATUS_PERIODO_NOMINA,
  CATEGORIAS_VARIABLES,
  VARIABLES_CONTEXTO,
  groupVariablesByCategoria
};
