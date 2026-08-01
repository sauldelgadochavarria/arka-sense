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
  return RangoFiscal.find({ tablaId }).sort({ limiteInferior: 1 }).lean();
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
  const [uma, salarioMinimo, fondoAhorroPorc] = await Promise.all([
    obtenerParametroVigente('UMA', fechaReferencia),
    obtenerParametroVigente('SALARIO_MINIMO', fechaReferencia),
    obtenerParametroVigente('FONDO_AHORRO_PORC', fechaReferencia)
  ]);
  return {
    uma: uma ?? 113.14,
    salarioMinimo: salarioMinimo ?? 278.8,
    porcentajeFondoAhorro: fondoAhorroPorc ?? 13
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

function factorMensual(tipoPeriodo, diasPeriodo) {
  const dias = diasPeriodo || 30;
  if (tipoPeriodo === 'mensual') return 1;
  return DIAS_MES_REF / dias;
}

/**
 * ISR del período: proyecta gravado a base mensual, aplica tabla LISR, prorratea al período.
 */
function isrDelPeriodo(gravado, tipoPeriodo, diasPeriodo, rangosIsr) {
  const g = Number(gravado) || 0;
  if (g <= 0) return 0;
  const dias = diasPeriodo || 30;
  const factor = factorMensual(tipoPeriodo, dias);
  const baseMensual = g * factor;
  const isrMensual = aplicarTablaSync(baseMensual, rangosIsr);
  return isrMensual / factor;
}

/**
 * IMSS obrero aproximado sobre SBC (tope 25 UMA diarios).
 * Cuotas obreras: enfermedad excedente + prestaciones + invalidez + cesantía.
 */
function imssObreroDelPeriodo(sueldoDiario, diasLaborados, uma) {
  const sdi = Number(sueldoDiario) || 0;
  const dias = Number(diasLaborados) || 0;
  const topeDiario = (Number(uma) || 0) * 25;
  const sbc = Math.min(sdi, topeDiario);
  const base = sbc * dias;
  const tasaObrero = 0.0025 + 0.00375 + 0.00625 + 0.01125;
  return base * tasaObrero;
}

function sbcDiario(sueldoDiario, uma) {
  const tope = (Number(uma) || 0) * 25;
  return Math.min(Number(sueldoDiario) || 0, tope);
}

module.exports = {
  obtenerTablaVigente,
  obtenerRangosTabla,
  aplicarTabla,
  aplicarTablaSync,
  cargarRangosTabla,
  obtenerParametroVigente,
  obtenerParametrosVigentes,
  isrDelPeriodo,
  imssObreroDelPeriodo,
  sbcDiario,
  factorMensual,
  DIAS_MES_REF
};
