'use strict';

const getTablaFiscalModel = require('../../models/tablaFiscal');
const getRangoFiscalModel = require('../../models/rangoFiscal');
const getParametroGeneralModel = require('../../models/parametroGeneral');

async function obtenerTablaVigente(codigo, fechaReferencia = new Date()) {
  const TablaFiscal = await getTablaFiscalModel();
  const ref = new Date(fechaReferencia);
  return TablaFiscal.findOne({
    codigo: String(codigo).toUpperCase(),
    activo: true,
    vigenciaDesde: { $lte: ref },
    $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: ref } }]
  })
    .sort({ vigenciaDesde: -1 })
    .lean();
}

async function obtenerRangosTabla(tablaId) {
  const RangoFiscal = await getRangoFiscalModel();
  return RangoFiscal.find({ tablaId }).sort({ limiteInferior: 1, clave: 1 }).lean();
}

async function aplicarTabla(monto, codigoTabla, fechaReferencia = new Date()) {
  const tabla = await obtenerTablaVigente(codigoTabla, fechaReferencia);
  if (!tabla) return 0;

  const rangos = await obtenerRangosTabla(tabla._id);
  const valor = Number(monto) || 0;

  for (const r of rangos) {
    if (valor >= r.limiteInferior && valor <= r.limiteSuperior) {
      const excedente = Math.max(0, valor - r.limiteInferior);
      return r.cuotaFija + excedente * (r.porcentajeExcedente || 0);
    }
  }
  return 0;
}

async function obtenerParametroVigente(clave, fechaReferencia = new Date()) {
  const ParametroGeneral = await getParametroGeneralModel();
  const ref = new Date(fechaReferencia);
  const doc = await ParametroGeneral.findOne({
    clave: String(clave).toUpperCase(),
    vigenciaDesde: { $lte: ref },
    $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: ref } }]
  })
    .sort({ vigenciaDesde: -1 })
    .lean();
  return doc ? doc.valor : null;
}

async function obtenerParametrosVigentes(fechaReferencia = new Date()) {
  const [uma, salarioMinimo, fondoAhorroPorc, topeUma, fondoTopeUma, fondoDiasAnio] =
    await Promise.all([
      obtenerParametroVigente('UMA', fechaReferencia),
      obtenerParametroVigente('SALARIO_MINIMO', fechaReferencia),
      obtenerParametroVigente('FONDO_AHORRO_PORC', fechaReferencia),
      obtenerParametroVigente('IMSS_TOPE_UMA', fechaReferencia),
      obtenerParametroVigente('FONDO_AHORRO_TOPE_UMA', fechaReferencia),
      obtenerParametroVigente('FONDO_AHORRO_DIAS_ANIO', fechaReferencia)
    ]);
  const umaVal = uma ?? 113.14;
  const factorFondo = fondoTopeUma ?? 1.3;
  const diasAnioFondo = fondoDiasAnio ?? 365;
  const diasMesUma = 30.4;
  const umaMensual = Math.round(umaVal * diasMesUma * 100) / 100;
  return {
    uma: umaVal,
    umaMensual,
    diasMesUma,
    salarioMinimo: salarioMinimo ?? 278.8,
    porcentajeFondoAhorro: fondoAhorroPorc ?? 13,
    topeUmaImss: topeUma ?? 25,
    topeUmaFondoAhorro: factorFondo,
    diasAnioFondoAhorro: diasAnioFondo,
    /** 1.3 × UMA mensual (ej. 3,566.22 × 1.3 = 4,636.09) */
    topeUmaMensualFondoAhorro: Math.round(factorFondo * umaMensual * 100) / 100,
    /** @deprecated preferir topeUmaMensualFondoAhorro prorrateado al período */
    topeAnualFondoAhorro: factorFondo * umaVal * diasAnioFondo
  };
}

/** Aplica rangos ya cargados en memoria (síncrono para mathjs). */
function aplicarTablaSync(monto, rangos) {
  const valor = Number(monto) || 0;
  if (!rangos?.length) return 0;
  for (const r of rangos) {
    if (valor >= r.limiteInferior && valor <= r.limiteSuperior) {
      const excedente = Math.max(0, valor - r.limiteInferior);
      return r.cuotaFija + excedente * (r.porcentajeExcedente || 0);
    }
  }
  return 0;
}

async function cargarRangosTabla(codigoTabla, fechaReferencia = new Date()) {
  const tabla = await obtenerTablaVigente(codigoTabla, fechaReferencia);
  if (!tabla) return [];
  return obtenerRangosTabla(tabla._id);
}

const DIAS_MES_REF = 30.4;

const { codigoTablaIsrParaPeriodo } = require('../../config/isrTablas2026');

function factorMensual(tipoPeriodo, diasPeriodo) {
  const dias = diasPeriodo || 30;
  if (tipoPeriodo === 'mensual') return 1;
  return DIAS_MES_REF / dias;
}

/**
 * ISR del período con la tarifa del Anexo 8 correspondiente al tipo de período.
 * Si se pasan rangos de esa periodicidad, se aplican directo (método oficial).
 * Fallback legacy: proyectar a mensual y prorratear.
 */
function isrDelPeriodo(gravado, tipoPeriodo, diasPeriodo, rangosIsr, opts = {}) {
  const g = Number(gravado) || 0;
  if (g <= 0) return 0;
  if (!rangosIsr?.length) return 0;

  const modo = opts.modo || 'tabla_periodo';
  if (modo === 'tabla_periodo' || modo === undefined) {
    return aplicarTablaSync(g, rangosIsr);
  }

  // Compat: proyección vía tabla mensual
  const dias = diasPeriodo || 30;
  const factor = factorMensual(tipoPeriodo, dias);
  const baseMensual = g * factor;
  const isrMensual = aplicarTablaSync(baseMensual, rangosIsr);
  return isrMensual / factor;
}

async function cargarRangosIsrParaPeriodo(tipoPeriodo, fechaReferencia = new Date()) {
  const codigo = codigoTablaIsrParaPeriodo(tipoPeriodo);
  let rangos = await cargarRangosTabla(codigo, fechaReferencia);
  if (!rangos?.length && codigo !== 'ISR_MENSUAL') {
    rangos = await cargarRangosTabla('ISR_MENSUAL', fechaReferencia);
  }
  return { codigo, rangos: rangos || [] };
}

function sbcDiario(sueldoDiario, uma, topeUma = 25) {
  const tope = (Number(uma) || 0) * (Number(topeUma) || 25);
  return Math.min(Number(sueldoDiario) || 0, tope);
}

function resolverLimiteCeav(mult, unidad, sm, uma) {
  const m = Number(mult);
  if (!Number.isFinite(m)) return null;
  if (unidad === 'sm') return m * (Number(sm) || 0);
  if (unidad === 'uma') return m * (Number(uma) || 0);
  return m; // abs
}

/**
 * Busca tasa CEAV patronal según SBC diario vs tramos (SM/UMA).
 * Si SM > múltiplos bajos de UMA (como en 2025+), ignora tramos con LI>LS
 * y quien gana ≤ SM usa el tramo 1.0 SM.
 */
function tasaCeavPatronal(sbcDiarioVal, sm, uma, tramos) {
  if (!tramos?.length) return null;
  const sbc = Number(sbcDiarioVal) || 0;
  const smVal = Number(sm) || 0;

  const smBand = tramos.find(
    (t) =>
      (t.limiteSupUnidad || '') === 'sm' && Number(t.limiteSuperior) <= 1.0001
  );
  if (smBand && smVal > 0 && sbc <= smVal + 1e-6) {
    return Number(smBand.tasaPatronal ?? smBand.porcentajeExcedente) || 0;
  }

  const valid = [];
  for (const t of tramos) {
    if (smBand && String(t._id) === String(smBand._id)) continue;
    if (
      smBand &&
      t.clave === smBand.clave &&
      t.limiteSuperior === smBand.limiteSuperior
    ) {
      continue;
    }
    const li = resolverLimiteCeav(t.limiteInferior, t.limiteInfUnidad || 'abs', sm, uma);
    const ls = resolverLimiteCeav(t.limiteSuperior, t.limiteSupUnidad || 'abs', sm, uma);
    if (li == null || ls == null || li > ls) continue;
    valid.push({ t, li: Math.max(li, smVal + 0.01), ls });
  }

  for (const { t, li, ls } of valid) {
    if (sbc + 1e-9 >= li && sbc <= ls + 1e-9) {
      return Number(t.tasaPatronal ?? t.porcentajeExcedente) || 0;
    }
  }

  if (valid.length) {
    const last = valid[valid.length - 1];
    return Number(last.t.tasaPatronal ?? last.t.porcentajeExcedente) || 0;
  }
  if (smBand) return Number(smBand.tasaPatronal ?? smBand.porcentajeExcedente) || 0;
  return 0;
}

function baseImssDiaria(baseCalculo, sbc, uma, primaRt) {
  switch (baseCalculo) {
    case 'uma':
      return Number(uma) || 0;
    case 'sbc_menos_3_uma':
      return Math.max(0, (Number(sbc) || 0) - 3 * (Number(uma) || 0));
    case 'prima_rt':
      return Number(sbc) || 0;
    case 'sbc':
    default:
      return Number(sbc) || 0;
  }
}

/**
 * Calcula cuotas IMSS del período según tabla oficial (ramos + bases).
 * @returns {{ obrero: number, patronal: number, desglose: object[] }}
 */
function calcularImssPeriodo({
  sueldoDiario,
  diasLaborados,
  uma,
  salarioMinimo,
  topeUma = 25,
  cuotas = [],
  tramosCeav = [],
  primaRt = 0.00543
}) {
  const dias = Number(diasLaborados) || 0;
  const sbc = sbcDiario(sueldoDiario, uma, topeUma);
  const desglose = [];
  let obrero = 0;
  let patronal = 0;

  if (dias <= 0 || sbc <= 0) {
    return { obrero: 0, patronal: 0, desglose, sbc };
  }

  for (const c of cuotas) {
    const baseCalc = c.baseCalculo || 'sbc';
    if (baseCalc === 'ceav_tramo') continue;

    const baseDia = baseImssDiaria(baseCalc, sbc, uma, primaRt);
    const base = baseDia * dias;

    let tasaO = Number(c.tasaObrero);
    let tasaP = Number(c.tasaPatronal);
    if (!Number.isFinite(tasaO)) tasaO = Number(c.porcentajeExcedente) || 0;
    if (!Number.isFinite(tasaP)) tasaP = 0;

    if (baseCalc === 'prima_rt') {
      tasaO = 0;
      tasaP = Number(primaRt) || 0;
    }

    // CEAV obrero viene en cuotas; CEAV patrón se aplica por tramos aparte
    if (String(c.clave || '').toUpperCase() === 'CEAV') {
      tasaP = 0;
    }

    const montoO = base * tasaO;
    const montoP = base * tasaP;
    obrero += montoO;
    patronal += montoP;
    desglose.push({
      clave: c.clave,
      nombre: c.nombre,
      baseCalculo: baseCalc,
      base,
      tasaObrero: tasaO,
      tasaPatronal: tasaP,
      obrero: montoO,
      patronal: montoP
    });
  }

  const tasaCeav = tasaCeavPatronal(sbc, salarioMinimo, uma, tramosCeav);
  if (tasaCeav != null && tasaCeav > 0) {
    const base = sbc * dias;
    const montoP = base * tasaCeav;
    patronal += montoP;
    desglose.push({
      clave: 'CEAV_PATRONAL',
      nombre: 'Cesantía en edad avanzada y vejez (patronal por tramo)',
      baseCalculo: 'sbc',
      base,
      tasaObrero: 0,
      tasaPatronal: tasaCeav,
      obrero: 0,
      patronal: montoP
    });
  }

  return {
    obrero: Math.round((obrero + Number.EPSILON) * 100) / 100,
    patronal: Math.round((patronal + Number.EPSILON) * 100) / 100,
    desglose,
    sbc
  };
}

/** Fallback si no hay IMSS_CUOTAS: tasas planas históricas obrero. */
const IMSS_OBRERO_TASA_FALLBACK = 0.0025 + 0.00375 + 0.00625 + 0.01125;

function imssObreroDelPeriodo(sueldoDiario, diasLaborados, uma, ctx = {}) {
  const cuotas = ctx.cuotasImss;
  const tramosCeav = ctx.tramosCeav;
  if (cuotas?.length) {
    return calcularImssPeriodo({
      sueldoDiario,
      diasLaborados,
      uma: ctx.uma ?? uma,
      salarioMinimo: ctx.salarioMinimo,
      topeUma: ctx.topeUma,
      cuotas,
      tramosCeav: tramosCeav || [],
      primaRt: ctx.primaRt
    }).obrero;
  }
  // Legado: filas solo obrero con porcentajeExcedente
  if (ctx.cuotasLegadoObrero?.length) {
    const tasa = ctx.cuotasLegadoObrero.reduce(
      (s, c) => s + (Number(c.porcentajeExcedente) || Number(c.tasaObrero) || 0),
      0
    );
    const sbc = sbcDiario(sueldoDiario, uma, ctx.topeUma);
    return sbc * (Number(diasLaborados) || 0) * tasa;
  }
  const sbc = sbcDiario(sueldoDiario, uma, ctx.topeUma);
  return sbc * (Number(diasLaborados) || 0) * IMSS_OBRERO_TASA_FALLBACK;
}

function imssPatronalDelPeriodo(sueldoDiario, diasLaborados, uma, ctx = {}) {
  const cuotas = ctx.cuotasImss;
  if (cuotas?.length) {
    return calcularImssPeriodo({
      sueldoDiario,
      diasLaborados,
      uma: ctx.uma ?? uma,
      salarioMinimo: ctx.salarioMinimo,
      topeUma: ctx.topeUma,
      cuotas,
      tramosCeav: ctx.tramosCeav || [],
      primaRt: ctx.primaRt
    }).patronal;
  }
  if (ctx.cuotasLegadoPatronal?.length) {
    const tasa = ctx.cuotasLegadoPatronal.reduce(
      (s, c) => s + (Number(c.porcentajeExcedente) || Number(c.tasaPatronal) || 0),
      0
    );
    const sbc = sbcDiario(sueldoDiario, uma, ctx.topeUma);
    return sbc * (Number(diasLaborados) || 0) * tasa;
  }
  return 0;
}

module.exports = {
  obtenerTablaVigente,
  obtenerRangosTabla,
  aplicarTabla,
  aplicarTablaSync,
  cargarRangosTabla,
  cargarRangosIsrParaPeriodo,
  obtenerParametroVigente,
  obtenerParametrosVigentes,
  isrDelPeriodo,
  calcularImssPeriodo,
  imssObreroDelPeriodo,
  imssPatronalDelPeriodo,
  tasaCeavPatronal,
  sbcDiario,
  factorMensual,
  DIAS_MES_REF,
  IMSS_OBRERO_TASA_FALLBACK
};
