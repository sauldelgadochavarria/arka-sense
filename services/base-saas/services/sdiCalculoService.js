'use strict';

const getTablaPrestacionesModel = require('../models/tablaPrestaciones');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getReciboNominaModel = require('../models/reciboNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getConceptoNominaModel = require('../models/conceptoNomina');
const { calcularAniosServicio, diasVacacionesPorAntiguedad } = require('../config/vacacionesLFT');
const { buildTablaGlobalDefault } = require('../config/prestacionesDefaults');
const { sbcTopado } = require('../libs/sdiHelpers');
const { startOfDay, endOfDay, diasCalendarioInclusive } = require('../libs/timeHelpers');

const PRIORIDAD_AMBITO = {
  puesto: 3,
  departamento: 2,
  tipo_empleado: 1,
  global: 0
};

/** Conceptos fijos que no entran al promedio variable del SDI. */
const CONCEPTOS_NO_VARIABLES = new Set([
  'SUELDO',
  'SALARIO_PERIODO',
  'AGUINALDO',
  'FINIQUITO_AGUINALDO',
  'PRIMA_VACACIONAL',
  'PTU',
  'INDEMNIZACION_90_DIAS',
  'SUBSIDIO_EMPLEO',
  'PERCEPCIONES_GRAVADAS',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR',
  'ISR',
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'IMSS_OBRERO',
  'IMSS_RCV',
  'IMSS_PATRONAL',
  'INFONAVIT',
  'FONACOT',
  'CUOTA_SINDICAL',
  'FONDO_AHORRO_EMPRESA',
  'FONDO_AHORRO_TRABAJADOR',
  'FINIQUITO_FONDO_AHORRO',
  'DED_FONDO_AHORRO',
  'DED_FONDO_AHORRO_EMPRESA'
]);

function redondear4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function factorIntegracion({ diasAguinaldo, diasVacaciones, primaVacacionalPct, diasExtraFactor = 0 }) {
  const agui = Number(diasAguinaldo) || 0;
  const vac = Number(diasVacaciones) || 0;
  const prima = (Number(primaVacacionalPct) || 0) / 100;
  const extra = Number(diasExtraFactor) || 0;
  return redondear4(1 + agui / 365 + (vac * prima) / 365 + extra / 365);
}

/**
 * Resume otras prestaciones activas de la tabla.
 * @returns {{ diasExtraFactor, montoDiarioSdi, detalle, soloNomina }}
 */
function resumirOtrasPrestaciones(otras) {
  const list = Array.isArray(otras) ? otras : [];
  let diasExtraFactor = 0;
  let montoDiarioSdi = 0;
  const detalle = [];
  const soloNomina = [];

  for (const p of list) {
    if (p?.activo === false) continue;
    const codigo = String(p.codigo || '').toUpperCase();
    const nombre = String(p.nombre || codigo);
    const tratamiento = String(p.tratamiento || 'solo_nomina');
    const valor = Number(p.valor) || 0;
    const row = { codigo, nombre, tratamiento, valor, notas: p.notas || '' };

    if (tratamiento === 'dias_factor') {
      diasExtraFactor += valor;
      detalle.push(row);
    } else if (tratamiento === 'monto_diario_sdi') {
      montoDiarioSdi += valor;
      detalle.push(row);
    } else {
      soloNomina.push(row);
    }
  }

  return {
    diasExtraFactor: redondear4(diasExtraFactor),
    montoDiarioSdi: redondear2(montoDiarioSdi),
    detalle,
    soloNomina
  };
}

function diasVacacionesDesdeTabla(tabla, aniosServicio) {
  const y = Math.max(0, Math.floor(Number(aniosServicio) || 0));
  const tramos = Array.isArray(tabla?.vacacionesPorAntiguedad)
    ? tabla.vacacionesPorAntiguedad
    : [];
  if (!tramos.length) return diasVacacionesPorAntiguedad(y);

  for (const t of tramos) {
    const desde = Number(t.aniosDesde) || 0;
    const hasta = t.aniosHasta == null || t.aniosHasta === '' ? Infinity : Number(t.aniosHasta);
    if (y >= desde && y <= hasta) return Number(t.diasVacaciones) || 0;
  }
  // Si antigüedad 0, sin vacaciones; si supera tramos, último
  if (y < 1) return 0;
  const last = tramos[tramos.length - 1];
  return Number(last?.diasVacaciones) || diasVacacionesPorAntiguedad(y);
}

async function ensureTablaGlobal(tenantId, empresaId) {
  const Tabla = await getTablaPrestacionesModel();
  let doc = await Tabla.findOne({ tenantId, ambito: 'global', activo: true }).lean();
  if (doc) return doc;
  doc = await Tabla.create(buildTablaGlobalDefault({ tenantId, empresaId }));
  return doc.toObject();
}

/**
 * Resuelve tabla aplicable:
 * override empleado (tablaPrestacionesId) > puesto > departamento > tipo_empleado > global.
 */
async function resolverTablaPrestaciones(tenantId, empresaId, empleado) {
  const Tabla = await getTablaPrestacionesModel();
  await ensureTablaGlobal(tenantId, empresaId);

  const candidatas = await Tabla.find({ tenantId, empresaId, activo: true }).lean();
  const emp = empleado || {};

  if (emp.tablaPrestacionesId) {
    const byId = candidatas.find((t) => String(t._id) === String(emp.tablaPrestacionesId));
    if (byId) return { tabla: byId, origen: 'empleado' };
    const directa = await Tabla.findOne({
      _id: emp.tablaPrestacionesId,
      tenantId,
      empresaId,
      activo: true
    }).lean();
    if (directa) return { tabla: directa, origen: 'empleado' };
  }

  const matchPuesto = candidatas.find(
    (t) =>
      t.ambito === 'puesto' &&
      emp.puestoId &&
      t.puestoId &&
      String(t.puestoId) === String(emp.puestoId)
  );
  if (matchPuesto) return { tabla: matchPuesto, origen: 'puesto' };

  const matchDepto = candidatas.find(
    (t) =>
      t.ambito === 'departamento' &&
      emp.departamentoId &&
      t.departamentoId &&
      String(t.departamentoId) === String(emp.departamentoId)
  );
  if (matchDepto) return { tabla: matchDepto, origen: 'departamento' };

  const tipoEmp = String(emp.tipoEmpleado || '').trim();
  const matchTipo = candidatas.find(
    (t) =>
      t.ambito === 'tipo_empleado' &&
      tipoEmp &&
      String(t.tipoEmpleado || '').trim() === tipoEmp
  );
  if (matchTipo) return { tabla: matchTipo, origen: 'tipo_empleado' };

  const global =
    candidatas.find((t) => t.ambito === 'global') ||
    (await ensureTablaGlobal(tenantId, empresaId));
  return { tabla: global, origen: 'global' };
}

async function promedioVariablesUltimos2Meses(tenantId, empleadoId, { fechaRef = new Date() } = {}) {
  const fin = endOfDay(fechaRef);
  const inicio = startOfDay(new Date(fechaRef));
  inicio.setMonth(inicio.getMonth() - 2);

  const Recibo = await getReciboNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Aplicado = await getConceptoAplicadoModel();
  const Concepto = await getConceptoNominaModel();

  const [recibosOp, recibosHist] = await Promise.all([
    Recibo.find({
      tenantId,
      empleadoId,
      fechaCalculo: { $gte: inicio, $lte: fin }
    })
      .select('_id')
      .lean(),
    Historico.find({
      tenantId,
      empleadoId,
      fechaCalculo: { $gte: inicio, $lte: fin }
    })
      .select('_id conceptos')
      .lean()
  ]);

  if (!recibosOp.length && !recibosHist.length) {
    return { promedioDiario: 0, totalVariables: 0, diasVentana: 0, recibos: 0 };
  }

  const conceptos = await Concepto.find({ tenantId }).select('codigo metadata fiscal').lean();
  const variableCodes = new Set();
  const fijoCodes = new Set();
  let hasNatFlags = false;
  for (const c of conceptos) {
    const nat =
      c.fiscal?.imss?.naturalezaSdi ||
      c.metadata?.naturalezaSdi ||
      (c.metadata?.esVariableSdi === true ? 'variable' : null);
    if (nat === 'variable') {
      hasNatFlags = true;
      variableCodes.add(c.codigo);
    } else if (nat === 'fijo' || nat === 'excluido') {
      hasNatFlags = true;
      fijoCodes.add(c.codigo);
    } else if (c.metadata?.esVariableSdi === true) {
      hasNatFlags = true;
      variableCodes.add(c.codigo);
    }
  }

  const lineas = [];
  if (recibosOp.length) {
    const opLines = await Aplicado.find({
      tenantId,
      reciboId: { $in: recibosOp.map((r) => r._id) },
      tipo: 'percepcion',
      requiereRevision: { $ne: true }
    }).lean();
    lineas.push(...opLines);
  }
  for (const h of recibosHist) {
    for (const c of h.conceptos || []) {
      if (c.tipo && c.tipo !== 'percepcion') continue;
      if (c.requiereRevision) continue;
      lineas.push(c);
    }
  }

  let total = 0;
  for (const l of lineas) {
    const code = String(l.conceptoCodigo || '').toUpperCase();
    if (CONCEPTOS_NO_VARIABLES.has(code)) continue;
    if (fijoCodes.has(code)) continue;
    if (hasNatFlags || variableCodes.size) {
      if (!variableCodes.has(code)) continue;
    }
    const integra =
      l.imss && l.imss.integraSBC != null ? Number(l.imss.integraSBC) : Number(l.importe) || 0;
    total += integra;
  }

  const diasVentana = diasCalendarioInclusive(inicio, fin);
  const promedioDiario = diasVentana > 0 ? total / diasVentana : 0;
  return {
    promedioDiario: redondear2(promedioDiario),
    totalVariables: redondear2(total),
    diasVentana,
    recibos: recibosOp.length + recibosHist.length,
    desde: inicio,
    hasta: fin
  };
}

/**
 * SDI unificado:
 *   SDI = (salario_diario * factor) + promedio_variable
 *   fijo → promedio_variable = 0
 *   variable → salario_diario = 0
 *   mixto → ambos
 * Luego tope 25×UMA.
 */
async function calcularSdiEmpleado({
  tenantId,
  empresaId,
  empleado,
  uma = 0,
  topeUma = 25,
  promedioVariableOverride = null,
  fechaRef = new Date()
} = {}) {
  const tipo = String(empleado?.tipoSalario || 'fijo').toLowerCase() || 'fijo';
  const salarioDiario = Number(empleado?.salarioDiario) || 0;
  const anios = calcularAniosServicio(empleado?.fechaIngreso, fechaRef);

  const { tabla, origen } = await resolverTablaPrestaciones(tenantId, empresaId, empleado);
  const diasVacaciones = diasVacacionesDesdeTabla(tabla, anios);
  const diasAguinaldo = Number(tabla.diasAguinaldo) || 15;
  const primaVacacionalPct = Number(tabla.primaVacacionalPct) || 25;
  const extras = resumirOtrasPrestaciones(tabla.otrasPrestaciones);
  const factor = factorIntegracion({
    diasAguinaldo,
    diasVacaciones,
    primaVacacionalPct,
    diasExtraFactor: extras.diasExtraFactor
  });

  let promedioVariable = 0;
  let detalleVariable = null;
  if (tipo === 'variable' || tipo === 'mixto') {
    if (promedioVariableOverride != null && Number.isFinite(Number(promedioVariableOverride))) {
      promedioVariable = Number(promedioVariableOverride);
      detalleVariable = { origen: 'manual', promedioDiario: promedioVariable };
    } else {
      detalleVariable = await promedioVariablesUltimos2Meses(tenantId, empleado._id, { fechaRef });
      promedioVariable = detalleVariable.promedioDiario;
    }
  }

  const sdParaFijo = tipo === 'variable' ? 0 : salarioDiario;
  const varParaCalc = tipo === 'fijo' ? 0 : promedioVariable;
  // Extras fijos en monto diario aplican a fijo y mixto (parte contractual fija).
  const extrasDiarios = tipo === 'variable' ? 0 : extras.montoDiarioSdi;
  const parteFija = redondear2(sdParaFijo * factor);
  const sdiBruto = redondear2(parteFija + extrasDiarios + varParaCalc);
  const sbc = redondear2(sbcTopado(sdiBruto, uma, topeUma));
  const tope = redondear2((Number(uma) || 0) * (Number(topeUma) || 25));

  return {
    tipoSalario: tipo,
    salarioDiario,
    aniosServicio: anios,
    tabla: {
      id: tabla._id,
      nombre: tabla.nombre,
      ambito: tabla.ambito,
      origen,
      diasAguinaldo,
      diasVacaciones,
      primaVacacionalPct
    },
    otrasPrestaciones: extras,
    factorIntegracion: factor,
    parteFija,
    extrasDiarios,
    promedioVariable: varParaCalc,
    detalleVariable,
    sdi: sdiBruto,
    sbc,
    topeSbc: tope,
    formula:
      'SDI = (salario_diario × factor) + extras_diarios + promedio_variable → min(SDI, 25×UMA)'
  };
}

module.exports = {
  PRIORIDAD_AMBITO,
  factorIntegracion,
  resumirOtrasPrestaciones,
  diasVacacionesDesdeTabla,
  ensureTablaGlobal,
  resolverTablaPrestaciones,
  promedioVariablesUltimos2Meses,
  calcularSdiEmpleado
};
