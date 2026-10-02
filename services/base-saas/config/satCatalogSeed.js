'use strict';

/**
 * Catálogos SAT nómina (Anexo 20 / CFDI nómina).
 * Fuente: capturas oficiales compartidas por el usuario (parcial; se completará).
 */

const VIGENCIA_2017 = new Date('2017-01-01T00:00:00Z');
const VIGENCIA_2016_11 = new Date('2016-11-01T00:00:00Z');
const VIGENCIA_2017_01_19 = new Date('2017-01-19T00:00:00Z');

/** Nombres de catálogo soportados en CatalogoSat */
const CATALOGOS_SAT_ENUM = [
  'c_TipoPercepcion',
  'c_TipoDeduccion',
  'c_TipoOtroPago',
  'c_TipoHorasExtra',
  'c_TipoHoras',
  'c_TipoNomina',
  'c_TipoContrato',
  'c_TipoJornada',
  'c_TipoIncapacidad',
  'c_TipoRegimen',
  'c_RiesgoPuesto',
  'c_PeriodicidadPago',
  'c_Banco'
];

function rows(catalogo, vigencia, pairs) {
  return pairs.map(([clave, descripcion]) => ({
    catalogo,
    clave: String(clave),
    descripcion,
    vigenciaDesde: vigencia
  }));
}

const TIPO_PERCEPCION = rows('c_TipoPercepcion', VIGENCIA_2017, [
  ['001', 'Sueldos, Salarios Rayas y Jornales'],
  ['002', 'Gratificación Anual (Aguinaldo)'],
  ['003', 'Participación de los Trabajadores en las Utilidades PTU'],
  ['004', 'Reembolso de Gastos Médicos Dentales y Hospitalarios'],
  ['005', 'Fondo de Ahorro'],
  ['006', 'Caja de ahorro'],
  ['009', 'Contribuciones a Cargo del Trabajador Pagadas por el Patrón'],
  ['010', 'Premios por puntualidad'],
  ['011', 'Prima de Seguro de vida'],
  ['012', 'Seguro de Gastos Médicos Mayores'],
  ['013', 'Cuotas Sindicales Pagadas por el Patrón'],
  ['014', 'Subsidios por incapacidad'],
  ['015', 'Becas para trabajadores y/o hijos'],
  ['019', 'Horas extra'],
  ['020', 'Prima dominical'],
  ['021', 'Prima vacacional'],
  ['022', 'Prima por antigüedad'],
  ['023', 'Pagos por separación'],
  ['024', 'Seguro de retiro'],
  ['025', 'Indemnizaciones'],
  ['026', 'Reembolso por funeral'],
  ['027', 'Cuotas de seguridad social pagadas por el patrón'],
  ['028', 'Comisiones'],
  ['029', 'Vales de despensa'],
  ['030', 'Vales de restaurante'],
  ['031', 'Vales de gasolina'],
  ['032', 'Vales de ropa'],
  ['033', 'Ayuda para renta'],
  ['034', 'Ayuda para artículos escolares'],
  ['035', 'Ayuda para anteojos'],
  ['036', 'Ayuda para transporte'],
  ['037', 'Ayuda para gastos de funeral'],
  ['038', 'Otros ingresos por salarios'],
  ['039', 'Jubilaciones, pensiones o haberes de retiro'],
  ['044', 'Jubilaciones, pensiones o haberes de retiro en parcialidades'],
  ['045', 'Ingresos en acciones o títulos valor que representan bienes'],
  ['046', 'Ingresos asimilados a salarios'],
  [
    '047',
    'Alimentación diferentes a los establecidos en el Art 94 último párrafo LISR'
  ],
  ['048', 'Habitación'],
  ['049', 'Premios por asistencia'],
  ['050', 'Viáticos'],
  [
    '051',
    'Pagos por gratificaciones, primas, compensaciones, recompensas u otros a extrabajadores derivados de jubilación en parcialidades'
  ],
  [
    '052',
    'Pagos que se realicen a extrabajadores que obtengan una jubilación en parcialidades derivados de la ejecución de resoluciones judicial o de un laudo'
  ],
  [
    '053',
    'Pagos que se realicen a extrabajadores que obtengan una jubilación en una sola exhibición derivados de la ejecución de resoluciones judicial o de un laudo'
  ]
]);

const TIPO_DEDUCCION = rows('c_TipoDeduccion', VIGENCIA_2017, [
  ['001', 'Seguridad social'],
  ['002', 'ISR'],
  ['003', 'Aportaciones a retiro, cesantía en edad avanzada y vejez.'],
  ['004', 'Otros'],
  ['005', 'Aportaciones a Fondo de vivienda'],
  ['006', 'Descuento por incapacidad'],
  ['007', 'Pensión alimenticia'],
  ['008', 'Renta'],
  [
    '009',
    'Préstamos provenientes del Fondo Nacional de la Vivienda para los Trabajadores'
  ],
  ['010', 'Pago por crédito de vivienda'],
  ['011', 'Pago de abonos INFONACOT'],
  ['012', 'Anticipo de salarios'],
  ['013', 'Pagos hechos con exceso al trabajador'],
  ['014', 'Errores'],
  ['015', 'Pérdidas'],
  ['016', 'Averías'],
  [
    '017',
    'Adquisición de artículos producidos por la empresa o establecimiento'
  ],
  [
    '018',
    'Cuotas para la constitución y fomento de sociedades cooperativas y de cajas de ahorro'
  ],
  ['019', 'Cuotas sindicales'],
  ['020', 'Ausencia (Ausentismo)'],
  ['021', 'Cuotas obrero patronales'],
  ['022', 'Impuestos Locales'],
  ['023', 'Aportaciones voluntarias'],
  ['024', 'Ajuste en Gratificación Anual (Aguinaldo) Exento'],
  ['025', 'Ajuste en Gratificación Anual (Aguinaldo) Gravado'],
  ['026', 'Ajuste en Participación de los Trabajadores en las Utilidades PTU Exento'],
  ['027', 'Ajuste en Participación de los Trabajadores en las Utilidades PTU Gravado'],
  ['028', 'Ajuste en Reembolso de Gastos Médicos Dentales y Hospitalarios Exento'],
  ['029', 'Ajuste en Fondo de ahorro Exento'],
  ['030', 'Ajuste en Caja de ahorro Exento'],
  ['031', 'Ajuste en Contribuciones a Seguridad Social Exento'],
  ['032', 'Ajuste en Comisiones Gravado'],
  ['033', 'Ajuste en Horas Extra Exento'],
  ['034', 'Ajuste en Horas Extra Gravado'],
  ['035', 'Ajuste en Prima dominical Exento'],
  ['036', 'Ajuste en Prima dominical Gravado'],
  ['037', 'Ajuste en Prima vacacional Exento'],
  ['038', 'Ajuste en Prima vacacional Gravado'],
  ['039', 'Ajuste en Prima por antigüedad Exento'],
  ['040', 'Ajuste en Prima por antigüedad Gravado'],
  ['041', 'Ajuste en Pagos por separación Exento'],
  ['042', 'Ajuste en Pagos por separación Gravado'],
  ['043', 'Ajuste en Seguro de retiro Exento'],
  ['044', 'Ajuste en Indemnizaciones Exento'],
  ['045', 'Ajuste en Indemnizaciones Gravado'],
  ['046', 'Ajuste en Reembolso por funeral Exento'],
  ['047', 'Ajuste en Cuotas de seguridad social pagadas por el patrón Exento'],
  ['048', 'Ajuste en Comisiones Exento'],
  ['049', 'Ajuste en Vales de despensa Exento'],
  ['050', 'Ajuste en Vales de restaurante Exento'],
  ['051', 'Ajuste en Vales de gasolina Exento'],
  ['052', 'Ajuste en Vales de ropa Exento'],
  ['053', 'Ajuste en Ayuda para renta Exento'],
  ['054', 'Ajuste en Ayuda para artículos escolares Exento'],
  ['055', 'Ajuste en Ayuda para anteojos Exento'],
  ['056', 'Ajuste en Ayuda para transporte Exento'],
  ['057', 'Ajuste en Ayuda para gastos de funeral Exento'],
  ['058', 'Ajuste en Otros ingresos por salarios Exento'],
  ['059', 'Ajuste en Otros ingresos por salarios Gravado'],
  ['060', 'Ajuste en Jubilaciones pensiones o haberes de retiro Exento'],
  ['061', 'Ajuste en Jubilaciones pensiones o haberes de retiro Gravado'],
  ['062', 'Ajuste en Pagos por separación acumulable'],
  ['063', 'Ajuste en Pagos por separación no acumulable'],
  ['064', 'Ajuste en Jubilaciones pensiones o haberes de retiro acumulable'],
  ['065', 'Ajuste en Jubilaciones pensiones o haberes de retiro no acumulable'],
  ['066', 'Ajuste al Subsidio Causado'],
  ['067', 'Ajuste a ingresos asimilados a salarios Gravado'],
  ['068', 'Ajuste a ingresos por sueldos y salarios Gravado'],
  ['069', 'Ajuste en Viáticos Gravados'],
  ['070', 'Ajuste a Viáticos Exentos'],
  ['071', 'Ajuste a Fondos de ahorro Gravado'],
  ['072', 'Ajuste a Caja de ahorro Gravado'],
  ['073', 'Ajuste a Prima de antigüedad no acumulable'],
  ['074', 'Ajuste a Pagos por separación no acumulable'],
  ['075', 'Ajuste a Indemnizaciones no acumulables'],
  ['076', 'Ajuste a Jubilaciones pensiones o haberes de retiro no acumulable'],
  ['077', 'Ajuste a Pagos por separación acumulable'],
  ['078', 'Ajuste a Indemnizaciones acumulables'],
  ['079', 'Ajuste a Jubilaciones pensiones o haberes de retiro acumulable'],
  ['080', 'Ajuste a Pagos por separación Exento'],
  ['081', 'Ajuste a Indemnizaciones Exento'],
  ['082', 'Ajuste a Jubilaciones pensiones o haberes de retiro Exento'],
  ['083', 'Ajuste a Viáticos'],
  ['084', 'Ajuste a Pagos por separación Gravado'],
  ['085', 'Ajuste a Indemnizaciones Gravado'],
  ['086', 'Ajuste a Jubilaciones pensiones o haberes de retiro Gravado'],
  ['087', 'Retención de impuesto sobre la renta'],
  ['088', 'Ajuste a Indemnizaciones no acumulable'],
  ['089', 'Ajuste a Separaciones no acumulable'],
  ['090', 'Ajuste a Separaciones acumulable'],
  ['091', 'Ajuste a Indemnizaciones acumulable'],
  ['092', 'Ajuste en Separaciones Exento'],
  ['093', 'Ajuste en Separaciones Gravado'],
  ['094', 'Ajuste a Indemnizaciones Exento'],
  ['095', 'Ajuste a Indemnizaciones Gravado'],
  ['096', 'Ajuste a Separaciones no acumulable'],
  ['097', 'Ajuste a Separaciones acumulable'],
  ['098', 'Ajuste a Separaciones Exento'],
  ['099', 'Ajuste a Separaciones Gravado'],
  ['100', 'Ajuste en Viáticos exentos'],
  ['101', 'ISR Retenido de ejercicio anterior'],
  [
    '102',
    'Ajuste en Pagos por jubilación en parcialidades derivados de resolución judicial'
  ],
  [
    '103',
    'Ajuste en Pagos por jubilación en una sola exhibición derivados de resolución judicial'
  ],
  [
    '104',
    'Ajuste en Pagos por jubilación en parcialidades derivados de laudo'
  ],
  [
    '105',
    'Ajuste en Pagos por jubilación en una sola exhibición derivados de laudo'
  ],
  ['106', 'Ajuste a Alimentos en bienes'],
  ['107', 'Ajuste al Subsidio Causado']
]);

const TIPO_OTRO_PAGO = rows('c_TipoOtroPago', VIGENCIA_2017, [
  [
    '001',
    'Reintegro de ISR pagado en exceso (siempre que no haya sido enterado al SAT).'
  ],
  ['002', 'Subsidio para el empleo (efectivamente entregado al trabajador).'],
  ['003', 'Viáticos (entregados al trabajador).'],
  ['004', 'Aplicación de saldo a favor por compensación anual.'],
  [
    '005',
    'Reintegro de ISR retenido en exceso de ejercicio anterior (siempre que no haya sido enterado al SAT).'
  ],
  [
    '006',
    'Alimentos en bienes (Servicios de comedor y comida) Art 94 último párrafo LISR.'
  ],
  ['007', 'ISR ajustado por subsidio.'],
  [
    '008',
    'Subsidio efectivamente entregado que no correspondía (Aplica sólo cuando haya ajuste al cierre de mes en relación con el Apéndice 7 de la guía de llenado de nómina).'
  ],
  ['009', 'Reembolso de descuentos efectuados para el crédito de vivienda.'],
  [
    '999',
    'Pagos distintos a los listados y que no deben considerarse como ingreso por sueldos, salarios o ingresos asimilados.'
  ]
]);

const TIPO_HORAS = rows('c_TipoHorasExtra', VIGENCIA_2017, [
  ['01', 'Dobles'],
  ['02', 'Triples'],
  ['03', 'Simples']
]);

// Alias oficial de la imagen (c_TipoHoras)
const TIPO_HORAS_ALIAS = rows('c_TipoHoras', VIGENCIA_2017, [
  ['01', 'Dobles'],
  ['02', 'Triples'],
  ['03', 'Simples']
]);

const TIPO_NOMINA = rows('c_TipoNomina', VIGENCIA_2017, [
  ['O', 'Nómina ordinaria'],
  ['E', 'Nómina extraordinaria']
]);

const TIPO_CONTRATO = rows('c_TipoContrato', VIGENCIA_2017, [
  ['01', 'Contrato de trabajo por tiempo indeterminado'],
  ['02', 'Contrato de trabajo para obra determinada'],
  ['03', 'Contrato de trabajo por tiempo determinado'],
  ['04', 'Contrato de trabajo por temporada'],
  ['05', 'Contrato de trabajo sujeto a prueba'],
  ['06', 'Contrato de trabajo con capacitación inicial'],
  ['07', 'Modalidad de contratación por pago de hora laborada'],
  ['08', 'Modalidad de trabajo por comisión laboral'],
  ['09', 'Modalidades de contratación donde no existe relación de trabajo'],
  ['10', 'Jubilación, pensión, retiro.'],
  ['99', 'Otro contrato']
]);

const TIPO_JORNADA = rows('c_TipoJornada', VIGENCIA_2017, [
  ['01', 'Diurna'],
  ['02', 'Nocturna'],
  ['03', 'Mixta'],
  ['04', 'Por hora'],
  ['05', 'Reducida'],
  ['06', 'Continuada'],
  ['07', 'Partida'],
  ['08', 'Por turnos'],
  ['99', 'Otra Jornada']
]);

const TIPO_INCAPACIDAD = rows('c_TipoIncapacidad', VIGENCIA_2017, [
  ['01', 'Riesgo de trabajo.'],
  ['02', 'Enfermedad en general.'],
  ['03', 'Maternidad.'],
  ['04', 'Licencia por cuidados médicos de hijos diagnosticados con cáncer.']
]);

const TIPO_REGIMEN = rows('c_TipoRegimen', VIGENCIA_2017, [
  ['02', 'Sueldos (Incluye ingresos señalados en la fracción I del artículo 94 de LISR)'],
  ['03', 'Jubilados'],
  ['04', 'Pensionados'],
  ['05', 'Asimilados Miembros Sociedades Cooperativas Produccion'],
  ['06', 'Asimilados Integrantes Sociedades Asociaciones Civiles'],
  ['07', 'Asimilados Miembros consejos'],
  ['08', 'Asimilados comisionistas'],
  ['09', 'Asimilados Honorarios'],
  ['10', 'Asimilados acciones'],
  ['11', 'Asimilados otros'],
  ['12', 'Jubilados o Pensionados'],
  ['13', 'Indemnización o Separación'],
  ['99', 'Otro Regimen']
]);

const RIESGO_PUESTO = rows('c_RiesgoPuesto', VIGENCIA_2017, [
  ['1', 'Clase I'],
  ['2', 'Clase II'],
  ['3', 'Clase III'],
  ['4', 'Clase IV'],
  ['5', 'Clase V'],
  ['99', 'No aplica']
]);

const PERIODICIDAD_PAGO = [
  ...rows('c_PeriodicidadPago', VIGENCIA_2016_11, [
    ['01', 'Diario'],
    ['02', 'Semanal'],
    ['03', 'Catorcenal'],
    ['04', 'Quincenal'],
    ['05', 'Mensual'],
    ['06', 'Bimestral'],
    ['07', 'Unidad obra'],
    ['08', 'Comisión'],
    ['09', 'Precio alzado'],
    ['99', 'Otra Periodicidad']
  ]),
  ...rows('c_PeriodicidadPago', VIGENCIA_2017_01_19, [['10', 'Decenal']])
];

const BANCO = rows('c_Banco', VIGENCIA_2017, [
  ['002', 'BANAMEX — Banco Nacional de México, S.A.'],
  ['006', 'BANCOMEXT — Banco Nacional de Comercio Exterior'],
  ['009', 'BANOBRAS — Banco Nacional de Obras y Servicios Públicos'],
  ['012', 'BBVA BANCOMER — BBVA Bancomer, S.A.'],
  ['014', 'SANTANDER — Banco Santander (México), S.A.'],
  ['019', 'BANJERCITO — Banco Nacional del Ejército, Fuerza Aérea y Armada'],
  ['021', 'HSBC — HSBC México, S.A.'],
  ['030', 'BAJIO — Banco del Bajío, S.A.'],
  ['044', 'SCOTIABANK — Scotiabank Inverlat, S.A.'],
  ['058', 'BANREGIO — Banco Regional de Monterrey, S.A.'],
  ['060', 'BANSI — Bansi, S.A.'],
  ['062', 'AFIRME — Banco Afirme, S.A.'],
  ['072', 'BANORTE/IXE — Banco Mercantil del Norte, S.A.'],
  ['102', 'THE ROYAL BANK — The Royal Bank of Scotland México'],
  ['103', 'AMERICAN EXPRESS — American Express Bank (México), S.A.'],
  ['110', 'JP MORGAN — Banco J.P. Morgan, S.A.'],
  ['127', 'AZTECA — Banco Azteca, S.A.'],
  ['130', 'COMPARTAMOS — Banco Compartamos, S.A.'],
  ['132', 'MULTIVA — Banco Multiva, S.A.'],
  ['133', 'ACTINVER — Banco Actinver, S.A.'],
  ['135', 'NAFIN — Nacional Financiera'],
  ['136', 'INTERCAM BANCO — Intercam Banco, S.A.'],
  ['137', 'BANCOPPEL — BanCoppel, S.A.'],
  ['140', 'CONSUBANCO — Consubanco, S.A.'],
  ['156', 'SABADELL — Banco Sabadell, S.A.'],
  ['166', 'BANSEFI — Banco del Ahorro Nacional y Servicios Financieros'],
  ['600', 'MONEXCB — Monex Casa de Bolsa, S.A. de C.V.'],
  ['616', 'FINAMEX — Casa de Bolsa Finamex, S.A. de C.V.'],
  ['623', 'SKANDIA — Skandia Vida, S.A. de C.V.'],
  ['630', 'CB INTERCAM — Intercam Casa de Bolsa, S.A. de C.V.'],
  ['646', 'STP — Sistema de Transferencias y Pagos STP, S.A. de C.V. SOFOM ENR'],
  ['647', 'TELECOMM — Telecomunicaciones de México'],
  ['901', 'CLS — Cls Bank International'],
  ['902', 'INDEVAL — SD. Indeval, S.A. de C.V.']
]);

const SAT_CATALOG_SEED = [
  ...TIPO_PERCEPCION,
  ...TIPO_DEDUCCION,
  ...TIPO_OTRO_PAGO,
  ...TIPO_HORAS,
  ...TIPO_HORAS_ALIAS,
  ...TIPO_NOMINA,
  ...TIPO_CONTRATO,
  ...TIPO_JORNADA,
  ...TIPO_INCAPACIDAD,
  ...TIPO_REGIMEN,
  ...RIESGO_PUESTO,
  ...PERIODICIDAD_PAGO,
  ...BANCO
];

module.exports = {
  CATALOGOS_SAT_ENUM,
  SAT_CATALOG_SEED,
  VIGENCIA_2017
};
