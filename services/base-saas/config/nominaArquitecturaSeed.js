'use strict';

const { FORMULA_SYSTEM_FUNCTIONS } = require('./formulaSystemFunctions');

/** Semilla mínima de enums del sistema (valores en BD, no hardcode en UI). */
const SYSTEM_ENUMS_SEED = [
  {
    grupo: 'tipo_concepto',
    nombre: 'Tipo de concepto',
    descripcion: 'Percepción, deducción u otro pago',
    editable: true,
    items: [
      { value: 'percepcion', label: 'Percepción', orden: 1 },
      { value: 'deduccion', label: 'Deducción', orden: 2 },
      { value: 'otro_pago', label: 'Otro pago', orden: 3 }
    ]
  },
  {
    grupo: 'naturaleza_concepto',
    nombre: 'Naturaleza fiscal',
    descripcion: 'Tratamiento fiscal base del concepto',
    editable: true,
    items: [
      { value: 'gravado', label: 'Gravado', orden: 1 },
      { value: 'exento', label: 'Exento', orden: 2 },
      { value: 'mixto', label: 'Mixto (parte gravada / exenta)', orden: 3 },
      { value: 'fiscal', label: 'Fiscal', orden: 4 },
      { value: 'informativo', label: 'Informativo', orden: 5 }
    ]
  },
  {
    grupo: 'fase_calculo',
    nombre: 'Fase de cálculo',
    descripcion: 'Orden estructural del motor (1–4)',
    editable: false,
    items: [
      { value: '1', label: 'Fase 1 — Percepciones', descripcion: 'SUELDO, HE, premios…', orden: 1, meta: { fase: 1 } },
      { value: '2', label: 'Fase 2 — Acumuladores', descripcion: 'Bases gravadas, SBC…', orden: 2, meta: { fase: 2 } },
      { value: '3', label: 'Fase 3 — Deducciones fiscales', descripcion: 'ISR, IMSS, INFONAVIT…', orden: 3, meta: { fase: 3 } },
      { value: '4', label: 'Fase 4 — Neto y totales', descripcion: 'Neto a pagar…', orden: 4, meta: { fase: 4 } }
    ]
  },
  {
    grupo: 'tipo_aplicacion',
    nombre: 'Tipo de aplicación',
    descripcion: 'FIJO = siempre; EVENTUAL = solo si hay novedad/condición',
    editable: false,
    items: [
      { value: 'FIJO', label: 'Fijo', descripcion: 'Se calcula en cada corrida ordinaria', orden: 1 },
      { value: 'EVENTUAL', label: 'Eventual', descripcion: 'Solo si la condición / incidencia aplica', orden: 2 }
    ]
  },
  {
    grupo: 'tipo_periodo',
    nombre: 'Tipo de período',
    descripcion: 'Periodicidad de nómina',
    editable: true,
    items: [
      { value: 'semanal', label: 'Semanal', orden: 1 },
      { value: 'catorcenal', label: 'Catorcenal', orden: 2 },
      { value: 'quincenal', label: 'Quincenal', orden: 3 },
      { value: 'mensual', label: 'Mensual', orden: 4 },
      { value: 'decena', label: 'Decena', orden: 5 }
    ]
  },
  {
    grupo: 'tipo_nomina',
    nombre: 'Tipo de nómina',
    descripcion: 'Ordinaria / extraordinarias',
    editable: true,
    items: [
      { value: 'ordinaria', label: 'Ordinaria', orden: 1 },
      { value: 'extraordinaria', label: 'Extraordinaria', orden: 2 },
      { value: 'finiquito', label: 'Finiquito', orden: 3 },
      { value: 'aguinaldo', label: 'Aguinaldo', orden: 4 },
      { value: 'ptu', label: 'PTU', orden: 5 },
      { value: 'primas', label: 'Primas vacacionales', orden: 6 },
      { value: 'comisiones', label: 'Comisiones', orden: 7 },
      { value: 'indemnizacion', label: 'Indemnización', orden: 8 },
      { value: 'otro', label: 'Otro', orden: 9 }
    ]
  },
  {
    grupo: 'tipo_contrato',
    nombre: 'Tipo de contrato',
    descripcion: 'Naturaleza jurídica del contrato (duración / modalidad). No confundir con tipo de empleado.',
    editable: true,
    items: [
      { value: 'indefinido', label: 'Indefinido (planta)', orden: 1 },
      { value: 'temporal', label: 'Temporal', orden: 2 },
      { value: 'eventual', label: 'Eventual', orden: 3 },
      { value: 'proyecto', label: 'Por proyecto', orden: 4 },
      { value: 'capacitacion', label: 'Aprendizaje / capacitación', orden: 5 }
    ]
  },
  {
    grupo: 'tipo_empleado',
    nombre: 'Tipo de empleado',
    descripcion: 'Clasificación laboral (confianza / sindicalizado). Independiente del tipo de contrato.',
    editable: true,
    items: [
      { value: 'confianza', label: 'Confianza', orden: 1 },
      { value: 'sindicalizado', label: 'Sindicalizado', orden: 2 }
    ]
  },
  {
    grupo: 'ambito_concepto',
    nombre: 'Ámbito del concepto',
    descripcion: 'Dónde aplica el concepto del catálogo único',
    editable: false,
    items: [
      { value: 'nomina', label: 'Sólo nómina formal', descripcion: 'Cálculo con fórmulas / CFDI', orden: 1 },
      { value: 'prenomina', label: 'Sólo pre-nómina', descripcion: 'Asistencia → borrador de pago', orden: 2 },
      { value: 'ambos', label: 'Nómina y pre-nómina', descripcion: 'Visible/usable en ambos módulos', orden: 3 }
    ]
  },
  {
    grupo: 'categoria_concepto',
    nombre: 'Categoría del concepto',
    descripcion: 'Clasificación de negocio (previsión social, ordinario, fiscal…)',
    editable: true,
    items: [
      { value: 'ordinario', label: 'Ordinario', descripcion: 'Sueldo, HE, etc.', orden: 1 },
      {
        value: 'prevision_social',
        label: 'Previsión social',
        descripcion: 'Despensa, fondo de ahorro, seguros de previsión…',
        orden: 2
      },
      { value: 'fiscal', label: 'Fiscal', descripcion: 'ISR, IMSS, etc.', orden: 3 },
      { value: 'informativo', label: 'Informativo', descripcion: 'No afecta neto', orden: 4 },
      { value: 'otro', label: 'Otro', orden: 5 }
    ]
  },
  {
    grupo: 'formula_context_vars',
    nombre: 'Variables de contexto (fórmulas)',
    descripcion:
      'Catálogo editable de variables del motor. Agrega ítems para documentar/sugerir en el editor; el motor fusiona cualquier clave numérica extra en INCIDENCIAS/EXTRAS.',
    editable: true,
    items: [
      {
        value: 'INCIDENCIAS.faltas',
        label: 'Faltas (días)',
        descripcion: 'Días de falta en el período',
        orden: 10,
        meta: { namespace: 'INCIDENCIAS', categoria: 'periodo', ejemplo: 0 }
      },
      {
        value: 'INCIDENCIAS.minutosRetardo',
        label: 'Minutos de retardo',
        descripcion: 'Suma de minutos de llegada tarde (asistencia)',
        orden: 20,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 0 }
      },
      {
        value: 'INCIDENCIAS.llegadasTarde',
        label: 'Llegadas tarde (días)',
        descripcion: 'Días con retardo / llegada tarde en el período',
        orden: 21,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 0 }
      },
      {
        value: 'INCIDENCIAS.diasConRetardo',
        label: 'Días con retardo',
        descripcion: 'Alias de llegadasTarde',
        orden: 22,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 0 }
      },
      {
        value: 'INCIDENCIAS.sinRetardo',
        label: 'Sin retardo (0/1)',
        descripcion: '1 si no hubo minutos ni días con retardo; útil en premio de puntualidad',
        orden: 23,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 1 }
      },
      {
        value: 'INCIDENCIAS.sinFaltas',
        label: 'Sin faltas (0/1)',
        descripcion: '1 si faltas == 0',
        orden: 24,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 1 }
      },
      {
        value: 'INCIDENCIAS.minutosSalidaAnticipada',
        label: 'Minutos salida anticipada',
        descripcion: 'Suma de minutos de salida anticipada',
        orden: 25,
        meta: { namespace: 'INCIDENCIAS', categoria: 'prenomina', ejemplo: 0 }
      },
      {
        value: 'INCIDENCIAS.horasExtraDobles',
        label: 'Horas extra dobles',
        descripcion: 'Horas al doble en el período',
        orden: 30,
        meta: { namespace: 'INCIDENCIAS', categoria: 'horas_extra', ejemplo: 4 }
      },
      {
        value: 'INCIDENCIAS.horasExtraTriples',
        label: 'Horas extra triples',
        descripcion: 'Horas al triple en el período',
        orden: 31,
        meta: { namespace: 'INCIDENCIAS', categoria: 'horas_extra', ejemplo: 0 }
      },
      {
        value: 'EMPLEADO.salarioDiario',
        label: 'Salario diario',
        descripcion: 'Salario diario del empleado',
        orden: 40,
        meta: { namespace: 'EMPLEADO', categoria: 'salario', ejemplo: 500 }
      },
      {
        value: 'EMPLEADO.horasJornada',
        label: 'Horas jornada',
        descripcion: 'Horas de jornada (turno / atributos)',
        orden: 41,
        meta: { namespace: 'EMPLEADO', categoria: 'salario', ejemplo: 8 }
      },
      {
        value: 'PERIODO.diasTrabajados',
        label: 'Días trabajados',
        descripcion: 'Días laborados del período',
        orden: 50,
        meta: { namespace: 'PERIODO', categoria: 'periodo', ejemplo: 15 }
      },
      {
        value: 'PARAMETROS.uma',
        label: 'UMA',
        descripcion: 'UMA vigente',
        orden: 60,
        meta: { namespace: 'PARAMETROS', categoria: 'fiscal', ejemplo: 113.14 }
      },
      {
        value: 'pagaDespensa',
        label: 'Paga despensa (0/1)',
        descripcion: '1 si el período dispara el pago mensual de vales',
        orden: 70,
        meta: { namespace: 'PERIODO', categoria: 'prestaciones', ejemplo: 1 }
      },
      {
        value: 'despensaMonto',
        label: 'Monto despensa del período',
        descripcion: 'Insumo resuelto (fijo o % topado)',
        orden: 71,
        meta: { namespace: 'PERIODO', categoria: 'prestaciones', ejemplo: 1400 }
      },
      {
        value: 'esSegundaQuincena',
        label: '2ª quincena (0/1)',
        descripcion: '1 si fechaInicio del período es día ≥ 16',
        orden: 72,
        meta: { namespace: 'PERIODO', categoria: 'periodo', ejemplo: 1 }
      },
      {
        value: 'semanaDelMes',
        label: 'Semana del mes (1–5)',
        descripcion: 'Según día de inicio del período',
        orden: 73,
        meta: { namespace: 'PERIODO', categoria: 'periodo', ejemplo: 3 }
      }
    ]
  },
  {
    grupo: 'formula_functions',
    nombre: 'Funciones de fórmula',
    descripcion:
      'Funciones del scope mathjs (si, redondear, isrPeriodo…). Se sincroniza desde Nómina → Catálogos → Funciones de fórmula; ahí se crean las de tipo expresión.',
    editable: false,
    items: FORMULA_SYSTEM_FUNCTIONS.map((f, i) => ({
      value: f.name,
      label: f.signature || f.name,
      descripcion: f.descripcion || '',
      orden: (i + 1) * 10,
      meta: { tipo: 'nativa', ejemplo: f.ejemplo || '' }
    }))
  }
];

/** Catálogo global único: nómina, pre-nómina o ambos + fiscal/SAT + incidencias. */
const CONCEPT_CATALOG_SEED = [
  {
    clave: 'P001',
    codigo: 'SALARIO_PERIODO',
    clavePrenomina: 'P001',
    nombre: 'Salario del período',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'prenomina',
    formulaPrenomina: 'salario_periodo',
    tiposIncidencia: [],
    insumosContexto: ['PERIODO.diasTrabajados', 'EMPLEADO.salarioDiario'],
    claveSAT: '001',
    sat: { tipo: 'percepcion', clave: '001', descripcion: 'Sueldos, salarios rayas y jornales' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: true,
      integraIMSS: true,
      integraINFONAVIT: true,
      desglose: { modo: 'todo_gravado', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'fijo',
        desglose: { modo: 'todo_integra' }
      }
    },
    ordenDefault: 1,
    descripcion: 'Pre-nómina: salario diario × días trabajados.'
  },
  {
    clave: 'P002',
    codigo: 'HE_PRENOMINA',
    clavePrenomina: 'P002',
    nombre: 'Horas extra (pre-nómina)',
    tipo: 'percepcion',
    naturaleza: 'mixto',
    fase: 1,
    aplicaEn: 'prenomina',
    formulaPrenomina: 'horas_extra',
    tiposIncidencia: ['HE'],
    insumosContexto: ['INCIDENCIAS.horasExtraDobles', 'INCIDENCIAS.horasExtraTriples'],
    claveSAT: '019',
    sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra' },
    fiscal: {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'regla_ley', topeExentoUMA: 5, codigoRegla: 'horas_extra' },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye', codigoRegla: 'horas_extra_dobles' }
      }
    },
    ordenDefault: 2,
    descripcion:
      'Pre-nómina: agrega HE del período. Fiscal formal se afina en HORAS_EXTRA_DOBLES/TRIPLES.'
  },
  {
    clave: 'D001',
    codigo: 'RETARDOS',
    clavePrenomina: 'D001',
    nombre: 'Retardos',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'prenomina',
    formulaPrenomina: 'retardos',
    tiposIncidencia: ['RET'],
    insumosContexto: ['INCIDENCIAS.minutosRetardo', 'INCIDENCIAS.llegadasTarde'],
    claveSAT: '004',
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado', codigoRegla: '' }
    },
    ordenDefault: 10,
    descripcion: 'Pre-nómina: deducción por minutos/días de retardo (incidencia RET).'
  },
  {
    clave: 'D002',
    codigo: 'FALTAS',
    clavePrenomina: 'D002',
    nombre: 'Faltas injustificadas',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'prenomina',
    formulaPrenomina: 'faltas',
    tiposIncidencia: ['FI'],
    insumosContexto: ['INCIDENCIAS.faltas'],
    claveSAT: '004',
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado', codigoRegla: '' }
    },
    ordenDefault: 11,
    descripcion: 'Pre-nómina: deducción por faltas (incidencia FI).'
  },
  {
    clave: 'D003',
    codigo: 'SALIDA_ANTICIPADA',
    clavePrenomina: 'D003',
    nombre: 'Salidas anticipadas',
    tipo: 'deduccion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'prenomina',
    formulaPrenomina: 'salida_anticipada',
    tiposIncidencia: ['SA'],
    insumosContexto: ['INCIDENCIAS.minutosSalidaAnticipada'],
    claveSAT: '004',
    sat: { tipo: 'deduccion', clave: '004', descripcion: 'Otros' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: false,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado', codigoRegla: '' }
    },
    ordenDefault: 12,
    descripcion: 'Pre-nómina: deducción por salida anticipada.'
  },
  {
    clave: 'L0001',
    codigo: 'SUELDO',
    nombre: 'Sueldo ordinario',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: [],
    insumosContexto: ['EMPLEADO.salarioDiario', 'PERIODO.diasTrabajados', 'INCIDENCIAS.faltas'],
    claveSAT: '001',
    sat: { tipo: 'percepcion', clave: '001', descripcion: 'Sueldos, salarios rayas y jornales' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: true,
      integraIMSS: true,
      integraINFONAVIT: true,
      desglose: { modo: 'todo_gravado', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'fijo',
        desglose: { modo: 'todo_integra' }
      }
    },
    ordenDefault: 100,
    descripcion: 'Nómina formal: salario diario × días laborados netos de faltas.'
  },
  {
    clave: 'L0019',
    codigo: 'HORAS_EXTRA_DOBLES',
    nombre: 'Horas extra dobles',
    tipo: 'percepcion',
    naturaleza: 'mixto',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: ['HEO', 'HED', 'HE'],
    insumosContexto: [
      'EMPLEADO.salarioDiario',
      'EMPLEADO.horasJornada',
      'INCIDENCIAS.horasExtraDobles'
    ],
    claveSAT: '019',
    sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra' },
    fiscal: {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'regla_ley',
        topeExentoUMA: 5,
        codigoRegla: 'horas_extra_dobles'
      },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye', codigoRegla: 'horas_extra_dobles' }
      }
    },
    ordenDefault: 101,
    descripcion:
      'HE dobles (≤9 h/sem, ≤3 h/día, pago al doble). ISR: 50% exento con tope 5×UMA semanales; el resto (mitad + exceso del tope) grava. No integra SBC IMSS.'
  },
  {
    clave: 'L0020',
    codigo: 'HORAS_EXTRA_TRIPLES',
    nombre: 'Horas extra triples',
    tipo: 'percepcion',
    naturaleza: 'gravado',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: ['HEF', 'HE'],
    insumosContexto: [
      'EMPLEADO.salarioDiario',
      'EMPLEADO.horasJornada',
      'INCIDENCIAS.horasExtraTriples'
    ],
    claveSAT: '019',
    sat: { tipo: 'percepcion', clave: '019', descripcion: 'Horas extra' },
    fiscal: {
      naturaleza: 'gravado',
      integraISR: true,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_gravado', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'variable',
        desglose: { modo: 'todo_integra' }
      }
    },
    ordenDefault: 102,
    descripcion:
      'HE triples (exceso de 9 h/sem o >3 h/día, pago al triple / 200% adicional). ISR 100% gravado, sin exención. Integra SBC IMSS.'
  },
  {
    clave: 'L0016',
    codigo: 'PREMIO_ASISTENCIA',
    nombre: 'Premio de asistencia',
    tipo: 'percepcion',
    naturaleza: 'exento',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: ['FI'],
    insumosContexto: ['INCIDENCIAS.sinFaltas', 'INCIDENCIAS.faltas'],
    claveSAT: '049',
    sat: { tipo: 'percepcion', clave: '049', descripcion: 'Premios por asistencia' },
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'variable',
        desglose: {
          modo: 'regla_ley',
          topeNoIntegraPctSbc: 10,
          codigoRegla: 'premio_10_sbc'
        }
      }
    },
    ordenDefault: 119,
    descripcion:
      'Premio asistencia: ISR exento típico; IMSS — hasta 10% SBC no integra, excedente variable.'
  },
  {
    clave: 'L0017',
    codigo: 'PREMIO_PUNTUALIDAD',
    nombre: 'Premio de puntualidad',
    tipo: 'percepcion',
    naturaleza: 'exento',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: ['RET'],
    insumosContexto: ['INCIDENCIAS.sinRetardo', 'INCIDENCIAS.minutosRetardo', 'INCIDENCIAS.llegadasTarde'],
    claveSAT: '010',
    sat: { tipo: 'percepcion', clave: '010', descripcion: 'Premios por puntualidad' },
    fiscal: {
      naturaleza: 'exento',
      integraISR: false,
      integraIMSS: true,
      integraINFONAVIT: false,
      desglose: { modo: 'todo_exento', codigoRegla: '' },
      imss: {
        naturalezaSdi: 'variable',
        desglose: {
          modo: 'regla_ley',
          topeNoIntegraPctSbc: 10,
          codigoRegla: 'premio_10_sbc'
        }
      }
    },
    ordenDefault: 120,
    descripcion:
      'Premio puntualidad: ISR exento típico; IMSS — hasta 10% SBC no integra, excedente variable.'
  },
  {
    clave: 'L0002',
    codigo: 'AGUINALDO',
    nombre: 'Aguinaldo',
    tipo: 'percepcion',
    naturaleza: 'mixto',
    fase: 1,
    aplicaEn: 'nomina',
    formulaPrenomina: '',
    tiposIncidencia: [],
    insumosContexto: ['EMPLEADO.salarioDiario'],
    claveSAT: '002',
    sat: { tipo: 'percepcion', clave: '002', descripcion: 'Aguinaldo' },
    aplicaTipoNomina: ['aguinaldo', 'finiquito', 'extraordinaria'],
    fiscal: {
      naturaleza: 'mixto',
      integraISR: true,
      integraIMSS: false,
      integraINFONAVIT: false,
      desglose: {
        modo: 'regla_ley',
        topeExentoUMA: 30,
        codigoRegla: 'aguinaldo'
      },
      imss: {
        naturalezaSdi: 'excluido',
        desglose: { modo: 'todo_excluye' }
      }
    },
    ordenDefault: 110,
    descripcion:
      'Pago de aguinaldo. ISR: exento hasta 30×UMA (regla aguinaldo), resto grava. IMSS excluido: los días ya van en el factor de la tabla de prestaciones (no doblar).'
  }
];

const DEFAULT_FORMULA_TEMPLATES = [
  {
    conceptoCodigo: 'SUELDO',
    fase: 1,
    tipoAplicacion: 'FIJO',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    formula: 'EMPLEADO.salarioDiario * (PERIODO.diasTrabajados - INCIDENCIAS.faltas)',
    condicion: '',
    dependencias: []
  },
  {
    conceptoCodigo: 'HORAS_EXTRA_DOBLES',
    fase: 1,
    tipoAplicacion: 'EVENTUAL',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    formula:
      'si(INCIDENCIAS.horasExtraDobles > 0, (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraDobles * 2, 0)',
    condicion: '',
    dependencias: []
  },
  {
    conceptoCodigo: 'HORAS_EXTRA_TRIPLES',
    fase: 1,
    tipoAplicacion: 'EVENTUAL',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    formula:
      'si(INCIDENCIAS.horasExtraTriples > 0, (EMPLEADO.salarioDiario / EMPLEADO.horasJornada) * INCIDENCIAS.horasExtraTriples * 3, 0)',
    condicion: '',
    dependencias: []
  },
  {
    conceptoCodigo: 'PREMIO_ASISTENCIA',
    fase: 1,
    tipoAplicacion: 'EVENTUAL',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    formula: 'si(diasLaborados >= diasProgramados, 500, 0)',
    condicion: '',
    dependencias: []
  },
  {
    conceptoCodigo: 'PREMIO_PUNTUALIDAD',
    fase: 1,
    tipoAplicacion: 'EVENTUAL',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'ordinaria',
    formula: 'si(INCIDENCIAS.sinRetardo == 1, 500, 0)',
    condicion: '',
    dependencias: []
  },
  {
    conceptoCodigo: 'AGUINALDO',
    fase: 1,
    tipoAplicacion: 'EVENTUAL',
    tipoPeriodo: 'quincenal',
    tipoNomina: 'aguinaldo',
    formula: 'EMPLEADO.salarioDiario * 15',
    condicion: '',
    dependencias: []
  }
];

module.exports = {
  SYSTEM_ENUMS_SEED,
  CONCEPT_CATALOG_SEED,
  DEFAULT_FORMULA_TEMPLATES
};
