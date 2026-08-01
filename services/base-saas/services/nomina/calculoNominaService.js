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
const { aplicarTabla, obtenerParametrosVigentes, cargarRangosTabla, aplicarTablaSync, isrDelPeriodo, imssObreroDelPeriodo, sbcDiario } = require('./tablasFiscalesService');
const { obtenerInsumosPrenomina, tieneActividadPrenomina } = require('./prenominaBridge');
const { resolverInsumosNominaEmpleado } = require('../../libs/nominaEmpleadoInsumos');
const getPayrollDetailModel = require('../../models/payrollDetail');
const { buildNamespacedContext } = require('./payrollContextBuilder');
const {
  resolveConceptosParaEmpresa,
  mergeResolvedWithLegacy
} = require('./conceptResolutionService');
const { requireEmpresaForTenant } = require('../../libs/tenantScope');
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

async function obtenerFormulasVigentes(tenantId, periodo) {
  const FormulaConcepto = await getFormulaConceptoModel();
  const ref = new Date(periodo.fechaInicio);

  const formulas = await FormulaConcepto.find({
    tenantId,
    tipoPeriodo: periodo.tipoPeriodo,
    tipoNomina: periodo.tipoNomina,
    vigenciaDesde: { $lte: ref },
    $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: ref } }],
    activo: true
  }).lean();

  const porConcepto = new Map();
  for (const f of formulas) {
    const key = f.conceptoCodigo;
    if (!porConcepto.has(key)) porConcepto.set(key, f);
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

async function calcularReciboEmpleado(empleado, periodo, ordenCalculo, parametros, tiposPorCodigo, informativos, fiscalCtx, conceptosByCodigo = new Map()) {
  const insumos = await obtenerInsumosPrenomina(
    periodo.tenantId,
    empleado._id,
    periodo.payrollPeriodId
  );

  const diasPeriodo = periodo.diasPeriodo || diasEntre(periodo.fechaInicio, periodo.fechaFin);
  const diasLaborados =
    insumos.diasTrabajados != null ? insumos.diasTrabajados : diasPeriodo - (insumos.faltas || 0);

  const sueldoDiario = insumos.sueldoDiario ?? empleado.salarioDiario ?? 0;
  const horasJornada = empleado.turnoHorasJornada || empleado.nominaConfig?.horasJornada || 8;

  const extras = resolverInsumosNominaEmpleado(
    empleado,
    {
      diasPeriodo,
      diasLaborados,
      faltas: insumos.faltas || 0,
      sueldoDiario
    },
    parametros
  );

  const contexto = buildNamespacedContext({
    empleado: {
      salarioDiario: sueldoDiario,
      horasJornada,
      antiguedadAnios: calcularAntiguedadAnios(empleado.fechaIngreso, periodo.fechaInicio),
      sbc: sbcDiario(sueldoDiario, parametros.uma),
      atributos: { horasJornada }
    },
    periodo: {
      diasPeriodo,
      diasTrabajados: diasLaborados,
      diasLaborados,
      faltas: insumos.faltas || 0
    },
    incidencias: {
      faltas: insumos.faltas || 0,
      horasExtraDobles: insumos.horasExtraDobles || 0,
      horasExtraTriples: insumos.horasExtraTriples || 0,
      minutosRetardo: insumos.minutosRetardo || 0,
      minutosSalidaAnticipada: insumos.minutosSalidaAnticipada || 0,
      diasConRetardo: insumos.diasConRetardo || 0,
      llegadasTarde: insumos.llegadasTarde || insumos.diasConRetardo || 0
    },
    parametros: {
      uma: parametros.uma,
      salarioMinimo: parametros.salarioMinimo
    },
    resultadosPrevios: {
      percepcionPrenomina: insumos.percepcionPrenomina || 0,
      deduccionPrenomina: insumos.deduccionPrenomina || 0,
      tipoPeriodo: periodo.tipoPeriodo,
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
    imssObrero: (sdi, dias) => imssObreroDelPeriodo(sdi, dias, parametros.uma)
  });

  const detalle = [];
  let tieneRevision = false;

  for (const formula of ordenCalculo) {
    const esEventual = String(formula.tipoAplicacion || 'FIJO').toUpperCase() === 'EVENTUAL';
    const conceptoMeta = conceptosByCodigo.get(formula.conceptoCodigo) || {};
    const fiscalCfg = resolveFiscalConfig(conceptoMeta);
    try {
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

  const totalPercepciones = redondear(
    detalle
      .filter((d) => d.tipo === 'percepcion' && !informativos.has(d.conceptoCodigo) && !d.requiereRevision)
      .reduce((s, d) => s + (d.importe || 0), 0)
  );
  const totalDeducciones = redondear(
    detalle
      .filter((d) => d.tipo === 'deduccion' && !d.requiereRevision)
      .reduce((s, d) => s + (d.importe || 0), 0)
  );

  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();

  const recibo = await ReciboNomina.create({
    tenantId: periodo.tenantId,
    empleadoId: empleado._id,
    periodoId: periodo._id,
    diasLaborados: contexto.diasLaborados,
    faltas: contexto.faltas,
    totalPercepciones,
    totalDeducciones,
    netoPagar: redondear(totalPercepciones - totalDeducciones),
    fechaCalculo: new Date(),
    errorCalculo: tieneRevision ? 'Uno o más conceptos requieren revisión' : '',
    basesFiscales: bases,
    insumosFuente: insumos.fuente || 'default',
    insumosResumen: {
      diasTrabajados: diasLaborados,
      faltas: insumos.faltas || 0,
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

  const legacyFormulas = await obtenerFormulasVigentes(tenantId, periodo);
  let resolved = [];
  try {
    const { empresa } = await requireEmpresaForTenant(tenantId);
    if (empresa) {
      resolved = await resolveConceptosParaEmpresa(tenantId, empresa._id, {
        tipoPeriodo: periodo.tipoPeriodo,
        tipoNomina: periodo.tipoNomina,
        fecha: new Date(periodo.fechaInicio)
      });
    }
  } catch (err) {
    console.warn('[calculoNomina] resolveConceptos:', err.message);
  }

  const formulas = mergeResolvedWithLegacy(resolved, legacyFormulas);
  if (!formulas.length) throw new Error('No hay fórmulas vigentes para este tipo de período y nómina');

  const ordenCalculo = ordenarPorDependencias(formulas);
  const parametros = await obtenerParametrosVigentes(periodo.fechaInicio);
  const rangosIsr = await cargarRangosTabla('ISR_MENSUAL', periodo.fechaInicio);
  const fiscalCtx = { rangosIsr, tablasCache: { ISR_MENSUAL: rangosIsr } };

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

  const empleadosQuery = {
    tenantId,
    activo: true,
    estatus: 'activo',
    salarioDiario: { $gt: 0 }
  };

  let empleados;
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

  const total = empleados.length;
  let procesados = 0;
  let exitos = 0;
  let errores = 0;

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
        conceptosByCodigo
      );
      exitos++;
      resultados.push({
        empleadoId: empleado._id,
        numEmpleado: empleado.numEmpleado,
        nombre: `${empleado.firstName} ${empleado.lastName}`.trim(),
        reciboId: recibo._id,
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
      await options.onProgress({ total, procesados, exitos, errores });
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

  await PeriodoNomina.updateOne(
    { _id: periodoId },
    {
      $set: {
        estatus: 'calculado',
        calculadoAt: new Date(),
        calculadoPorUserId: options.userId || '',
        totales
      }
    }
  );

  return { resultados, totales };
}

async function cerrarPeriodo(tenantId, periodoId, userId = '') {
  const PeriodoNomina = await getPeriodoNominaModel();
  const periodo = await PeriodoNomina.findOne({ tenantId, _id: periodoId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'calculado') {
    throw new Error('Solo se pueden cerrar períodos en estatus calculado');
  }

  await PeriodoNomina.updateOne(
    { _id: periodoId },
    { $set: { estatus: 'cerrado', cerradoAt: new Date(), cerradoPorUserId: userId } }
  );
}

module.exports = {
  calcularPeriodo,
  calcularReciboEmpleado,
  cerrarPeriodo,
  obtenerFormulasVigentes,
  limpiarCalculoPeriodo
};
