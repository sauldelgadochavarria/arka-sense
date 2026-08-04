'use strict';

const getPeriodoNominaModel = require('../../models/periodoNomina');
const getReciboNominaModel = require('../../models/reciboNomina');
const getConceptoAplicadoModel = require('../../models/conceptoAplicado');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const getFormulaConceptoModel = require('../../models/formulaConcepto');
const getEmpleadoModel = require('../../models/empleado');
const { ordenarPorDependencias } = require('./dependencyResolver');
const {
  redondear,
  createFormulaScope,
  evaluateExpression,
  evaluateCondicion,
  extractVariablesUsadas
} = require('./formulaEvaluator');
const { aplicarTabla, obtenerParametrosVigentes, cargarRangosTabla, aplicarTablaSync, isrDelPeriodo, imssObreroDelPeriodo, imssPatronalDelPeriodo, sbcDiario, cargarRangosIsrParaPeriodo } = require('./tablasFiscalesService');
const { obtenerInsumosPrenomina, tieneActividadPrenomina } = require('./prenominaBridge');
const { resolverInsumosNominaEmpleado } = require('../../libs/nominaEmpleadoInsumos');
const getPayrollDetailModel = require('../../models/payrollDetail');
const { buildNamespacedContext } = require('./payrollContextBuilder');
const {
  resolveConceptosParaEmpresa,
  mergeResolvedWithLegacy
} = require('./conceptResolutionService');
const { requireEmpresaForTenant } = require('../../libs/tenantScope');
const { filterEmpleadosByTipoMotor } = require('../../libs/empleadoTipoPeriodo');
const { conceptoAplicaEnCalculo } = require('../../libs/conceptoAplicabilidad');
const { listTiposPeriodo } = require('../tipoPeriodoNominaService');
const { archivarYAcumularCierre } = require('./nominaCierreService');
const { registrarAuditoriaNomina } = require('./nominaAuditoriaService');
const { calcularDiasPagados, mergePolitica } = require('../../libs/diasPagadosMotor');
const { generateCalculoLoteId, generateCalculoId } = require('../../libs/calculoId');
const {
  calcularMotorIsrInteligente,
  lineasInformativasIsr
} = require('./isrProyeccionService');
const {
  resolveFiscalConfig,
  desglosarImporte,
  acumularBasesFiscales
} = require('./fiscalDesgloseService');
const { diasCalendarioInclusive } = require('../../libs/timeHelpers');

function calcularAntiguedadAnios(fechaIngreso, fechaReferencia) {
  if (!fechaIngreso) return 0;
  const ingreso = new Date(fechaIngreso);
  const ref = new Date(fechaReferencia);
  const diff = ref.getTime() - ingreso.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function diasEntre(inicio, fin) {
  return diasCalendarioInclusive(inicio, fin);
}

/** Fecha de vigencia de fórmulas: en períodos abiertos usa "hoy" para que un cambio reciente aplique al recalcular. */
function fechaVigenciaFormulas(periodo) {
  if (periodo?.estatus === 'cerrado') {
    return new Date(periodo.fechaCierre || periodo.fechaFin || periodo.fechaInicio || Date.now());
  }
  return new Date();
}

function elegirMejorFormula(prev, cur) {
  if (!prev) return cur;
  const prevEmp = prev.empresaId != null ? 1 : 0;
  const curEmp = cur.empresaId != null ? 1 : 0;
  if (curEmp !== prevEmp) return curEmp > prevEmp ? cur : prev;
  if ((cur.version || 0) !== (prev.version || 0)) {
    return (cur.version || 0) > (prev.version || 0) ? cur : prev;
  }
  return new Date(cur.vigenciaDesde) > new Date(prev.vigenciaDesde) ? cur : prev;
}

async function obtenerFormulasVigentes(tenantId, periodo, fechaRef = null) {
  const FormulaConcepto = await getFormulaConceptoModel();
  const ref = fechaRef ? new Date(fechaRef) : fechaVigenciaFormulas(periodo);

  const formulas = await FormulaConcepto.find({
    tenantId,
    tipoPeriodo: periodo.tipoPeriodo,
    tipoNomina: periodo.tipoNomina,
    vigenciaDesde: { $lte: ref },
    $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: ref } }],
    activo: true
  })
    .sort({ version: -1, vigenciaDesde: -1, updatedAt: -1 })
    .lean();

  const porConcepto = new Map();
  for (const f of formulas) {
    porConcepto.set(f.conceptoCodigo, elegirMejorFormula(porConcepto.get(f.conceptoCodigo), f));
  }
  return [...porConcepto.values()];
}

async function limpiarCalculoPeriodo(tenantId, periodoId) {
  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();
  const recibos = await ReciboNomina.find({ tenantId, periodoId }).select('_id').lean();
  const reciboIds = recibos.map((r) => r._id);
  if (reciboIds.length) {
    await ConceptoAplicado.deleteMany({ tenantId, reciboId: { $in: reciboIds } });
    await ReciboNomina.deleteMany({ tenantId, periodoId });
  }
}

async function calcularReciboEmpleado(
  empleado,
  periodo,
  ordenCalculo,
  parametros,
  tiposPorCodigo,
  informativos,
  fiscalCtx,
  conceptosByCodigo = new Map(),
  isrMotorOpts = {},
  diasOpts = {},
  calcMeta = {}
) {
  const insumos = await obtenerInsumosPrenomina(
    periodo.tenantId,
    empleado._id,
    periodo.payrollPeriodId
  );

  const diasPeriodo = periodo.diasPeriodo || diasEntre(periodo.fechaInicio, periodo.fechaFin);
  const diasLaborados =
    insumos.diasTrabajados != null ? insumos.diasTrabajados : diasPeriodo - (insumos.faltas || 0);

  const faltasInjustificadas = Number(insumos.faltas) || 0;
  const faltasJustificadas = Number(insumos.faltasJustificadas) || 0;
  const diasIncapacidad = Number(insumos.diasIncapacidad) || 0;
  const diasVacaciones = Number(insumos.diasVacaciones) || 0;
  const diasPermisoConGoce = Number(insumos.diasPermisoConGoce) || 0;

  const diasPago = calcularDiasPagados({
    periodo: { ...periodo, diasPeriodo },
    tipoPeriodoRef: diasOpts.tipoPeriodoRef || null,
    politica: diasOpts.politica || {},
    diasLaborados,
    faltasInjustificadas,
    faltasJustificadas,
    diasIncapacidad,
    diasVacaciones,
    diasPermisoConGoce
  });

  const sueldoDiario = insumos.sueldoDiario ?? empleado.salarioDiario ?? 0;
  const horasJornada = empleado.turnoHorasJornada || empleado.nominaConfig?.horasJornada || 8;

  const cfgNomina = empleado.nominaConfig || {};
  const extras = resolverInsumosNominaEmpleado(
    empleado,
    {
      diasPeriodo,
      diasLaborados: diasPago.diasLaborados,
      diasPagados: diasPago.diasPagados,
      faltas: faltasInjustificadas,
      sueldoDiario
    },
    parametros
  );

  const porcentajeFondoAhorro =
    Number(cfgNomina.porcentajeFondoAhorro) > 0
      ? Number(cfgNomina.porcentajeFondoAhorro)
      : Number(parametros.porcentajeFondoAhorro) || 13;
  const aplicaFondoAhorro = cfgNomina.aplicaFondoAhorro ? 1 : 0;

  const contexto = buildNamespacedContext({
    empleado: {
      salarioDiario: sueldoDiario,
      horasJornada,
      antiguedadAnios: calcularAntiguedadAnios(empleado.fechaIngreso, periodo.fechaInicio),
      sbc: sbcDiario(sueldoDiario, parametros.uma),
      tipoEmpleado: empleado.tipoEmpleado || '',
      atributos: { horasJornada },
      nominaConfig: cfgNomina
    },
    periodo: {
      diasPeriodo,
      diasTrabajados: diasPago.diasLaborados,
      diasLaborados: diasPago.diasLaborados,
      diasPagados: diasPago.diasPagados,
      diasCotizacion: diasPago.diasCotizacion,
      diasProgramados: diasPago.diasProgramados,
      diasDescanso: diasPago.diasDescanso,
      diasDescansoPagados: diasPago.diasDescansoPagados,
      faltas: faltasInjustificadas
    },
    incidencias: {
      faltas: faltasInjustificadas,
      faltasInjustificadas,
      faltasJustificadas,
      diasIncapacidad,
      diasVacaciones,
      diasPermisoConGoce,
      horasExtraDobles: insumos.horasExtraDobles || 0,
      horasExtraTriples: insumos.horasExtraTriples || 0,
      minutosRetardo: insumos.minutosRetardo || 0,
      minutosSalidaAnticipada: insumos.minutosSalidaAnticipada || 0,
      diasConRetardo: insumos.diasConRetardo || 0,
      llegadasTarde: insumos.llegadasTarde || insumos.diasConRetardo || 0,
      sinRetardo:
        (insumos.minutosRetardo || 0) === 0 &&
        (insumos.diasConRetardo || insumos.llegadasTarde || 0) === 0
          ? 1
          : 0,
      sinFaltas: faltasInjustificadas === 0 ? 1 : 0
    },
    parametros: {
      uma: parametros.uma,
      salarioMinimo: parametros.salarioMinimo,
      porcentajeFondoAhorro,
      topeUmaFondoAhorro: parametros.topeUmaFondoAhorro || 1.3,
      diasAnioFondoAhorro: parametros.diasAnioFondoAhorro || 365
    },
    resultadosPrevios: {
      percepcionPrenomina: insumos.percepcionPrenomina || 0,
      deduccionPrenomina: insumos.deduccionPrenomina || 0,
      tipoPeriodo: periodo.tipoPeriodo,
      aplicaFondoAhorro,
      porcentajeFondoAhorro,
      topeUmaFondoAhorro: parametros.topeUmaFondoAhorro || 1.3,
      diasAnioFondoAhorro: parametros.diasAnioFondoAhorro || 365,
      diasPagados: diasPago.diasPagados,
      diasCotizacion: diasPago.diasCotizacion,
      diasDescansoPagados: diasPago.diasDescansoPagados,
      diasProgramados: diasPago.diasProgramados,
      ...extras
    }
  });

  const scope = createFormulaScope(parametros, {
    aplicarTabla: (monto, codigoTabla) => {
      const key = String(codigoTabla).toUpperCase();
      const rangos = fiscalCtx.tablasCache[key];
      return rangos ? aplicarTablaSync(monto, rangos) : 0;
    },
    topeUMA: (valor, veces) => Math.min(Number(valor) || 0, parametros.uma * (veces || 1)),
    isrPeriodo: (gravado) =>
      isrDelPeriodo(gravado, periodo.tipoPeriodo, diasPeriodo, fiscalCtx.rangosIsr),
    imssObrero: (sdi, dias) =>
      imssObreroDelPeriodo(sdi, dias, parametros.uma, fiscalCtx.imssCtx || {}),
    imssPatronal: (sdi, dias) =>
      imssPatronalDelPeriodo(sdi, dias, parametros.uma, fiscalCtx.imssCtx || {})
  });

  const detalle = [];
  let tieneRevision = false;

  for (const formula of ordenCalculo) {
    const esEventual = String(formula.tipoAplicacion || 'FIJO').toUpperCase() === 'EVENTUAL';
    const conceptoMeta = conceptosByCodigo.get(formula.conceptoCodigo) || {};
    const fiscalCfg = resolveFiscalConfig(conceptoMeta);
    try {
      if (
        !conceptoAplicaEnCalculo(conceptoMeta, {
          tipoEmpleado: empleado.tipoEmpleado,
          tipoPeriodo: periodo.tipoPeriodo,
          tipoNomina: periodo.tipoNomina
        })
      ) {
        contexto[formula.conceptoCodigo] = 0;
        continue;
      }
      const aplica = evaluateCondicion(formula.condicion, contexto, scope);
      if (!aplica) {
        contexto[formula.conceptoCodigo] = 0;
        if (esEventual) continue;
        continue;
      }

      const valorCrudo = evaluateExpression(formula.formula, contexto, scope);
      const valor = redondear(valorCrudo, formula.redondeo ?? 2);
      contexto[formula.conceptoCodigo] = valor;

      const parted = desglosarImporte(valor, fiscalCfg, {
        uma: parametros.uma,
        contexto,
        scope
      });

      detalle.push({
        conceptoCodigo: formula.conceptoCodigo,
        formulaUsada: formula.formula,
        condicionUsada: formula.condicion || '',
        variablesUsadas: extractVariablesUsadas(formula.formula, contexto),
        importe: valor,
        gravado: parted.gravado,
        exento: parted.exento,
        desgloseModo: parted.modo,
        claveSAT: conceptoMeta.claveSAT || conceptoMeta.sat?.clave || '',
        fiscal: fiscalCfg,
        tipo: tiposPorCodigo.get(formula.conceptoCodigo) || conceptoMeta.tipo || 'percepcion',
        requiereRevision: false,
        errorCalculo: '',
        versionFormula: formula.version || 1
      });
    } catch (err) {
      tieneRevision = true;
      contexto[formula.conceptoCodigo] = null;
      detalle.push({
        conceptoCodigo: formula.conceptoCodigo,
        formulaUsada: formula.formula,
        condicionUsada: formula.condicion || '',
        variablesUsadas: {},
        importe: null,
        gravado: 0,
        exento: 0,
        desgloseModo: '',
        claveSAT: conceptoMeta.claveSAT || '',
        fiscal: fiscalCfg,
        tipo: tiposPorCodigo.get(formula.conceptoCodigo) || 'percepcion',
        requiereRevision: true,
        errorCalculo: err.message,
        versionFormula: formula.version || 1
      });
    }
  }

  const bases = acumularBasesFiscales(detalle);
  Object.assign(contexto, bases);

  let isrMotor = null;
  const isrLine = detalle.find((d) => d.conceptoCodigo === 'ISR' && !d.requiereRevision);
  const isrSatVal = isrLine ? Number(isrLine.importe) || 0 : 0;
  const gravadoPeriodo =
    Number(bases.PERCEPCIONES_GRAVADAS) ||
    Number(contexto.PERCEPCIONES_GRAVADAS) ||
    0;

  const modoIsr = isrMotorOpts.modo || 'inteligente_alerta';
  if (isrMotorOpts.activo !== false && modoIsr !== 'sat' && fiscalCtx?.rangosIsr?.length) {
    try {
      isrMotor = await calcularMotorIsrInteligente({
        tenantId: periodo.tenantId,
        empleado,
        periodo,
        gravadoPeriodo,
        isrSat: isrSatVal,
        diasLaboradosPeriodo: contexto.diasLaborados,
        rangosIsr: fiscalCtx.rangosIsr,
        rangosIsrAnual: fiscalCtx.rangosIsrAnual || [],
        modo: modoIsr === 'inteligente_retencion' ? 'retencion' : 'alerta'
      });
      const infoLines = lineasInformativasIsr(isrMotor);
      for (const line of infoLines) {
        informativos.add(line.conceptoCodigo);
        detalle.push(line);
        contexto[line.conceptoCodigo] = line.importe;
      }
    } catch (err) {
      console.warn('[isrMotor]', empleado.numEmpleado || empleado._id, err.message);
    }
  } else if (isrSatVal || gravadoPeriodo) {
    isrMotor = {
      modo: 'sat',
      motorSat: true,
      isrSat: isrSatVal,
      isrProyectado: isrSatVal,
      isrAjustado: isrSatVal,
      diferenciaPeriodo: 0,
      diferenciaAcumulada: 0,
      proyeccion: null,
      alertas: [],
      isrRetenidoCfdi: isrSatVal
    };
  }

  const totalPercepciones = redondear(
    detalle
      .filter((d) => d.tipo === 'percepcion' && !informativos.has(d.conceptoCodigo) && !d.requiereRevision)
      .reduce((s, d) => s + (d.importe || 0), 0)
  );
  const totalDeducciones = redondear(
    detalle
      .filter((d) => d.tipo === 'deduccion' && !informativos.has(d.conceptoCodigo) && !d.requiereRevision)
      .reduce((s, d) => s + (d.importe || 0), 0)
  );
  const netoPagar = redondear(totalPercepciones - totalDeducciones);

  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();

  const calculoLoteId = calcMeta.calculoLoteId || generateCalculoLoteId();
  const calculoId =
    calcMeta.calculoId || generateCalculoId(calculoLoteId, empleado.numEmpleado || empleado._id);

  const recibo = await ReciboNomina.create({
    tenantId: periodo.tenantId,
    empleadoId: empleado._id,
    periodoId: periodo._id,
    diasLaborados: diasPago.diasLaborados,
    faltas: faltasInjustificadas,
    diasPago,
    totalPercepciones,
    totalDeducciones,
    netoPagar,
    fechaCalculo: new Date(),
    calculoId,
    calculoLoteId,
    errorCalculo: tieneRevision ? 'Uno o más conceptos requieren revisión' : '',
    basesFiscales: bases,
    isrMotor,
    insumosFuente: insumos.fuente || 'default',
    insumosResumen: {
      diasTrabajados: diasPago.diasLaborados,
      diasPagados: diasPago.diasPagados,
      faltas: faltasInjustificadas,
      minutosRetardo: insumos.minutosRetardo || 0,
      horasExtraDobles: insumos.horasExtraDobles || 0,
      horasExtraTriples: insumos.horasExtraTriples || 0,
      sueldoDiario: sueldoDiario,
      payrollPeriodId: periodo.payrollPeriodId || null
    }
  });

  await ConceptoAplicado.insertMany(
    detalle.map((d) => ({
      tenantId: periodo.tenantId,
      reciboId: recibo._id,
      conceptoCodigo: d.conceptoCodigo,
      formulaUsada: d.formulaUsada,
      condicionUsada: d.condicionUsada,
      variablesUsadas: d.variablesUsadas,
      importe: d.importe == null ? 0 : d.importe,
      gravado: d.gravado || 0,
      exento: d.exento || 0,
      desgloseModo: d.desgloseModo || '',
      claveSAT: d.claveSAT || '',
      tipo: d.tipo || '',
      requiereRevision: Boolean(d.requiereRevision),
      errorCalculo: d.errorCalculo || '',
      versionFormula: d.versionFormula || 1
    }))
  );

  return recibo;
}

async function calcularPeriodo(tenantId, periodoId, options = {}) {
  const PeriodoNomina = await getPeriodoNominaModel();
  const ConceptoNomina = await getConceptoNominaModel();
  const Empleado = await getEmpleadoModel();

  const periodo = await PeriodoNomina.findOne({ tenantId, _id: periodoId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus === 'cerrado') throw new Error('El período está cerrado');

  // Corregir diasPeriodo si quedó mal por conteo con endOfDay
  const diasOk = diasCalendarioInclusive(periodo.fechaInicio, periodo.fechaFin);
  if (Number(periodo.diasPeriodo) !== diasOk) {
    await PeriodoNomina.updateOne({ _id: periodo._id }, { $set: { diasPeriodo: diasOk } });
    periodo.diasPeriodo = diasOk;
  }

  await limpiarCalculoPeriodo(tenantId, periodoId);

  const fechaFormula = fechaVigenciaFormulas(periodo);
  const legacyFormulas = await obtenerFormulasVigentes(tenantId, periodo, fechaFormula);
  let resolved = [];
  let empresaDoc = null;
  try {
    const { empresa } = await requireEmpresaForTenant(tenantId);
    empresaDoc = empresa;
    if (empresa) {
      resolved = await resolveConceptosParaEmpresa(tenantId, empresa._id, {
        tipoPeriodo: periodo.tipoPeriodo,
        tipoNomina: periodo.tipoNomina,
        fecha: fechaFormula
      });
    }
  } catch (err) {
    console.warn('[calculoNomina] resolveConceptos:', err.message);
  }

  const formulas = mergeResolvedWithLegacy(resolved, legacyFormulas);
  if (!formulas.length) throw new Error('No hay fórmulas vigentes para este tipo de período y nómina');

  const ordenCalculo = ordenarPorDependencias(formulas);
  const parametros = await obtenerParametrosVigentes(periodo.fechaInicio);
  const [
    { codigo: codigoTablaIsr, rangos: rangosIsr },
    rangosIsrAnual,
    rangosIsrMensual,
    cuotasImss,
    tramosCeav,
    cuotasLegadoObrero,
    cuotasLegadoPatronal
  ] = await Promise.all([
    cargarRangosIsrParaPeriodo(periodo.tipoPeriodo, periodo.fechaInicio),
    cargarRangosTabla('ISR_ANUAL', periodo.fechaInicio),
    cargarRangosTabla('ISR_MENSUAL', periodo.fechaInicio),
    cargarRangosTabla('IMSS_CUOTAS', periodo.fechaInicio),
    cargarRangosTabla('IMSS_CEAV_PATRONAL', periodo.fechaInicio),
    cargarRangosTabla('IMSS_OBRERO', periodo.fechaInicio),
    cargarRangosTabla('IMSS_PATRONAL', periodo.fechaInicio)
  ]);

  const primaRt =
    empresaDoc?.primaRiesgoTrabajo != null
      ? Number(empresaDoc.primaRiesgoTrabajo) || 0.00543
      : 0.00543;

  const imssCtx = {
    uma: parametros.uma,
    salarioMinimo: parametros.salarioMinimo,
    topeUma: parametros.topeUmaImss,
    cuotasImss,
    tramosCeav,
    cuotasLegadoObrero,
    cuotasLegadoPatronal,
    primaRt
  };

  const fiscalCtx = {
    rangosIsr,
    rangosIsrAnual: rangosIsrAnual || [],
    codigoTablaIsr,
    imssCtx,
    tablasCache: {
      ISR_MENSUAL: rangosIsrMensual || [],
      [codigoTablaIsr]: rangosIsr,
      ISR_ANUAL: rangosIsrAnual || [],
      IMSS_CUOTAS: cuotasImss,
      IMSS_CEAV_PATRONAL: tramosCeav
    }
  };

  const conceptos = await ConceptoNomina.find({
    tenantId,
    activo: true,
    $or: [{ aplicaEn: 'nomina' }, { aplicaEn: 'ambos' }, { aplicaEn: { $exists: false } }]
  }).lean();
  const tiposPorCodigo = new Map(conceptos.map((c) => [c.codigo, c.tipo]));
  const conceptosByCodigo = new Map(conceptos.map((c) => [c.codigo, c]));
  const informativos = new Set(
    conceptos.filter((c) => c.naturaleza === 'informativo').map((c) => c.codigo)
  );
  ['ISR_SAT', 'ISR_PROYECTADO', 'ISR_AJUSTADO', 'ISR_DIFERENCIA'].forEach((c) => informativos.add(c));

  const isrMotorOpts = {
    activo: empresaDoc?.nominaIsr?.activo !== false,
    modo: empresaDoc?.nominaIsr?.modo || 'inteligente_alerta'
  };

  const empleadosQuery = {
    tenantId,
    activo: true,
    estatus: 'activo',
    salarioDiario: { $gt: 0 }
  };

  let empleados;
  const tiposPeriodo = await listTiposPeriodo(tenantId, false);

  const politicaDias = mergePolitica(empresaDoc?.nominaDias || {});
  const tipoPeriodoRef =
    (tiposPeriodo || []).find(
      (t) => String(t.tipoMotor || '').toLowerCase() === String(periodo.tipoPeriodo || '').toLowerCase()
    ) || null;
  const diasOpts = { politica: politicaDias, tipoPeriodoRef };

  if (periodo.payrollPeriodId) {
    // Con pre-nómina vinculada: solo quien tuvo días/HE/percepciones (no “solo faltas”)
    const PayrollDetail = await getPayrollDetailModel();
    const details = await PayrollDetail.find({
      tenantId,
      periodId: periodo.payrollPeriodId
    }).lean();
    const idsActivos = details.filter(tieneActividadPrenomina).map((d) => d.empleadoId);
    empleados = idsActivos.length
      ? await Empleado.find({ ...empleadosQuery, _id: { $in: idsActivos } }).lean()
      : [];
    if (!empleados.length) {
      throw new Error(
        'La pre-nómina vinculada no tiene empleados con días trabajados, horas extra o percepciones. Revisa asistencia / pre-cálculo.'
      );
    }
  } else {
    empleados = await Empleado.find(empleadosQuery).lean();
  }

  empleados = filterEmpleadosByTipoMotor(empleados, tiposPeriodo, periodo.tipoPeriodo, {
    strict: false
  });
  if (!empleados.length) {
    throw new Error(
      `No hay empleados para tipo de período «${periodo.tipoPeriodo}». Asigna tipo de período en Personal → Empleado.`
    );
  }

  const total = empleados.length;
  let procesados = 0;
  let exitos = 0;
  let errores = 0;

  const calculoLoteId = generateCalculoLoteId();

  const resultados = [];
  for (const empleado of empleados) {
    try {
      const recibo = await calcularReciboEmpleado(
        empleado,
        periodo,
        ordenCalculo,
        parametros,
        tiposPorCodigo,
        informativos,
        fiscalCtx,
        conceptosByCodigo,
        isrMotorOpts,
        diasOpts,
        { calculoLoteId, calculoId: generateCalculoId(calculoLoteId, empleado.numEmpleado) }
      );
      exitos++;
      resultados.push({
        empleadoId: empleado._id,
        numEmpleado: empleado.numEmpleado,
        nombre: `${empleado.firstName} ${empleado.lastName}`.trim(),
        reciboId: recibo._id,
        calculoId: recibo.calculoId,
        calculoLoteId,
        ok: true
      });
    } catch (err) {
      errores++;
      resultados.push({
        empleadoId: empleado._id,
        numEmpleado: empleado.numEmpleado,
        nombre: `${empleado.firstName} ${empleado.lastName}`.trim(),
        error: err.message,
        ok: false
      });
    }
    procesados++;
    if (options.onProgress) {
      await options.onProgress({ total, procesados, exitos, errores, calculoLoteId });
    }
  }

  const recibosOk = resultados.filter((r) => r.ok);
  const ReciboNomina = await getReciboNominaModel();
  const recibos = await ReciboNomina.find({
    _id: { $in: recibosOk.map((r) => r.reciboId) }
  }).lean();

  const totales = {
    empleados: recibos.length,
    empleadosConError: resultados.filter((r) => !r.ok).length,
    percepciones: redondear(recibos.reduce((s, r) => s + r.totalPercepciones, 0)),
    deducciones: redondear(recibos.reduce((s, r) => s + r.totalDeducciones, 0)),
    neto: redondear(recibos.reduce((s, r) => s + r.netoPagar, 0))
  };

  const now = new Date();
  const userId = options.userId || '';
  const userLabel =
    options.userLabel ||
    (await require('../../libs/userLabel').resolveUserLabel(userId));

  await PeriodoNomina.updateOne(
    { _id: periodoId },
    {
      $set: {
        estatus: 'calculado',
        calculadoAt: now,
        fechaCalculo: now,
        calculoLoteId,
        calculadoPorUserId: userId,
        calculadoPorLabel: userLabel,
        totales
      }
    }
  );

  await registrarAuditoriaNomina({
    tenantId,
    accion: 'PERIODO_CALCULAR_OK',
    entidad: 'periodo',
    periodoId,
    userId,
    userLabel,
    mensaje: `Cálculo completado: ${totales.empleados} recibos, neto ${totales.neto}`,
    detalle: {
      totales,
      errores: totales.empleadosConError || 0,
      calculoLoteId,
      calculoIds: recibosOk.map((r) => r.calculoId).filter(Boolean)
    }
  });

  return { resultados, totales, calculoLoteId };
}

async function cerrarPeriodo(tenantId, periodoId, userId = '', userLabel = '') {
  const PeriodoNomina = await getPeriodoNominaModel();
  const periodo = await PeriodoNomina.findOne({ tenantId, _id: periodoId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'calculado') {
    throw new Error('Solo se pueden cerrar períodos en estatus calculado');
  }

  const label =
    userLabel || (await require('../../libs/userLabel').resolveUserLabel(userId));
  const cierre = await archivarYAcumularCierre({
    tenantId,
    periodo,
    userId,
    userLabel: label
  });
  const fechaCierre = cierre.fechaCierre || new Date();

  await PeriodoNomina.updateOne(
    { _id: periodoId },
    {
      $set: {
        estatus: 'cerrado',
        cerradoAt: fechaCierre,
        fechaCierre,
        cerradoPorUserId: userId || '',
        cerradoPorLabel: label,
        cierreResumen: {
          recibosArchivados: cierre.archivados || 0,
          conceptosAcumulados: cierre.conceptosAcumulados || 0
        }
      }
    }
  );

  await registrarAuditoriaNomina({
    tenantId,
    accion: 'PERIODO_CERRAR',
    entidad: 'periodo',
    periodoId,
    userId,
    userLabel: label,
    mensaje: `Período cerrado: ${cierre.archivados || 0} recibos archivados, ${cierre.conceptosAcumulados || 0} líneas a acumulados`,
    detalle: {
      archivados: cierre.archivados,
      conceptosAcumulados: cierre.conceptosAcumulados,
      totales: periodo.totales || {}
    }
  });

  return cierre;
}

module.exports = {
  calcularPeriodo,
  calcularReciboEmpleado,
  cerrarPeriodo,
  obtenerFormulasVigentes,
  limpiarCalculoPeriodo
};
