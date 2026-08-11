'use strict';

/**
 * Insumos de nómina por empleado (INFONAVIT, fondo de ahorro, finiquito).
 *
 * Fondo de ahorro — tope exento (práctica / LISR):
 *   min( % legal del salario del período , 1.3 × UMA mensual prorrateada al período )
 *
 * UMA mensual = UMA diaria × 30.4 (ej. 117.31 → 3,566.22).
 * Tope UMA mensual = 1.3 × UMA mensual (ej. 4,636.09).
 * Quincena / catorcena → mitad (ej. 2,318.04); semanal → /4; etc.
 *
 * El % de aportación del empleado puede ser menor al % legal del tope (default 13).
 * El excedente de la aportación patronal sobre el tope es gravable para ISR.
 */

const DIAS_MES_UMA = 30.4;
const {
  calcularAniosServicio,
  fechaAniversarioEnPeriodo
} = require('../config/vacacionesLFT');
const { diasVacacionesDesdeTabla } = require('../services/sdiCalculoService');

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pctPrimaDesdeFuentes(empleado, tabla) {
  const cfg = empleado.nominaConfig || {};
  if (Number(cfg.primaVacacionalPct) > 0) return Number(cfg.primaVacacionalPct);
  if (Number(tabla?.primaVacacionalPct) > 0) return Number(tabla.primaVacacionalPct);
  return 25;
}

/**
 * Días / % para prima vacacional del período.
 * Prioridad días:
 * 1) Override manual nominaConfig.diasPrimaVacacional
 * 2) Aniversario en período → días de la tabla de prestaciones (o LFT)
 * 3) Días de vacaciones del período (incidencias)
 * %: override empleado → tabla → 25
 *
 * @param {object} [periodoOpts.tablaPrestaciones]
 */
function resolverDiasPrimaVacacional(empleado, contexto = {}, periodoOpts = {}) {
  const cfg = empleado.nominaConfig || {};
  const tabla = periodoOpts.tablaPrestaciones || null;
  const pct = pctPrimaDesdeFuentes(empleado, tabla);
  const manual = Number(cfg.diasPrimaVacacional) || 0;
  if (manual > 0) {
    return {
      diasPrimaVacacional: manual,
      primaVacacionalOrigen: 'manual',
      primaVacacionalPct: pct
    };
  }

  const anni = fechaAniversarioEnPeriodo(
    empleado.fechaIngreso,
    periodoOpts.fechaInicio,
    periodoOpts.fechaFin
  );
  if (anni) {
    const anios = calcularAniosServicio(empleado.fechaIngreso, anni);
    const dias = diasVacacionesDesdeTabla(tabla, anios);
    return {
      diasPrimaVacacional: dias,
      primaVacacionalOrigen: 'aniversario',
      primaVacacionalPct: pct,
      antiguedadAniosPrima: anios
    };
  }

  const diasVac = Number(contexto.diasVacaciones) || 0;
  if (diasVac > 0) {
    return {
      diasPrimaVacacional: diasVac,
      primaVacacionalOrigen: 'vacaciones_periodo',
      primaVacacionalPct: pct
    };
  }

  return {
    diasPrimaVacacional: 0,
    primaVacacionalOrigen: 'ninguno',
    primaVacacionalPct: pct
  };
}

function resolverInfonavitDescuento(empleado, contexto, parametros) {
  const cfg = empleado.nominaConfig || {};
  if (cfg.infonavitDescuento > 0) return cfg.infonavitDescuento;

  const tasa = Number(cfg.tasaInfonavit) || 0;
  if (tasa <= 0) return 0;

  const dias = cfg.diasCotizacionImss > 0 ? cfg.diasCotizacionImss : contexto.diasLaborados;
  if (dias <= 0) return 0;

  const tipo = cfg.tipoCreditoInfonavit || 'porcentaje';
  const sueInt =
    cfg.sueldoIntegrado > 0 ? cfg.sueldoIntegrado : contexto.sueldoDiario * dias;
  const salMin = parametros.salarioMinimo || 0;

  if (tipo === 'cuota_fija') return (tasa / 7) * dias;
  if (tipo === 'vsm') return (((tasa * salMin) * 2) / 8 / 7) * dias;
  return (tasa / 100) * sueInt;
}

/**
 * Prorratea el tope UMA mensual al período de nómina.
 * Quincenal/catorcenal con 14 días de referencia → exactamente la mitad
 * (1.3 × UMA_mensual / 2 ≈ 2,318).
 */
function topeUmaFondoParaPeriodo(topeUmaMensual, tipoPeriodo, diasPeriodo) {
  const tope = Number(topeUmaMensual) || 0;
  if (tope <= 0) return 0;
  const tipo = String(tipoPeriodo || '').toLowerCase();
  const dias = Number(diasPeriodo) || 0;

  if (tipo === 'mensual') return tope;
  if (tipo === 'quincenal' || tipo === 'catorcenal') {
    // 14+14 = 28 (mes de dos quincenas); si vienen 14 días → 14/28
    if (dias === 14) return tope * (14 / 28);
    return tope / 2;
  }
  if (tipo === 'semanal') return tope / 4;
  if (tipo === 'decena') return tope * (10 / 30);
  if (dias > 0) return tope * (dias / DIAS_MES_UMA);
  return tope;
}

/**
 * @returns {{
 *   empresa: number,
 *   trabajador: number,
 *   topeExento: number,
 *   topePorPorcentaje: number,
 *   topePorUma: number,
 *   topeUmaMensual: number,
 *   umaMensual: number,
 *   empresaExento: number,
 *   empresaGravado: number
 * }}
 */
function resolverFondoAhorro(empleado, contexto, parametros) {
  const vacio = {
    empresa: 0,
    trabajador: 0,
    topeExento: 0,
    topePorPorcentaje: 0,
    topePorUma: 0,
    topeUmaMensual: 0,
    umaMensual: 0,
    empresaExento: 0,
    empresaGravado: 0
  };

  const cfg = empleado.nominaConfig || {};
  if (!cfg.aplicaFondoAhorro) return vacio;

  const porcAportacion =
    cfg.porcentajeFondoAhorro > 0
      ? cfg.porcentajeFondoAhorro
      : parametros.porcentajeFondoAhorro || 13;

  /** % legal del tope exento (suele ser 13 aunque el empleado aporte menos). */
  const porcTope =
    Number(parametros.porcentajeFondoAhorro) > 0
      ? Number(parametros.porcentajeFondoAhorro)
      : 13;

  const sdi = Number(contexto.sueldoDiario) || 0;
  const diasLab = Number(contexto.diasLaborados) || 0;
  const diasPeriodo =
    Number(contexto.diasPeriodo) > 0 ? Number(contexto.diasPeriodo) : diasLab;
  const tipoPeriodo = contexto.tipoPeriodo || parametros.tipoPeriodo || '';

  const baseSalario = sdi * diasLab;
  if (baseSalario <= 0 || porcAportacion <= 0) return vacio;

  // Aportación total = % del salario; mitad empresa / mitad trabajador (mismo monto)
  const totalAportacion = (baseSalario * porcAportacion) / 100;
  const mitad = roundMoney(totalAportacion / 2);
  const empresa = mitad;
  const trabajador = mitad;

  const uma = Number(parametros.uma) || 0;
  const factorUma = Number(parametros.topeUmaFondoAhorro) || 1.3;
  const diasMesUma = Number(parametros.diasMesUma) > 0 ? Number(parametros.diasMesUma) : DIAS_MES_UMA;
  const umaMensual =
    Number(parametros.umaMensual) > 0 ? Number(parametros.umaMensual) : roundMoney(uma * diasMesUma);
  const topeUmaMensual = roundMoney(factorUma * umaMensual);
  const topePorUma = roundMoney(topeUmaFondoParaPeriodo(topeUmaMensual, tipoPeriodo, diasPeriodo));
  const topePorPorcentaje = roundMoney((baseSalario * porcTope) / 100);
  const topeExento = roundMoney(Math.min(topePorPorcentaje, topePorUma));

  const empresaExento = roundMoney(Math.min(empresa, topeExento));
  const empresaGravado = roundMoney(Math.max(0, empresa - empresaExento));

  return {
    empresa,
    trabajador,
    topeExento,
    topePorPorcentaje,
    topePorUma,
    topeUmaMensual,
    umaMensual,
    empresaExento,
    empresaGravado
  };
}

/**
 * Despensa / vales del período.
 * @param {object} periodoOpts
 * @param {boolean} periodoOpts.pagaDespensa
 * @param {number} [periodoOpts.despensaMontoOverride]
 * @param {boolean} [periodoOpts.despensaPagoMensual]
 */
function resolverDespensa(empleado, contexto, parametros, periodoOpts = {}) {
  const vacio = {
    despensaMonto: 0,
    despensaBase: 0,
    despensaTopeAplicado: 0,
    pagaDespensa: 0,
    despensaPagoMensual: 0
  };

  const paga =
    periodoOpts.pagaDespensa === true ||
    periodoOpts.pagaDespensa === 1 ||
    periodoOpts.pagaDespensa === '1';
  if (!paga) return vacio;

  const pagoMensual =
    periodoOpts.despensaPagoMensual !== false && periodoOpts.despensaPagoMensual !== 0;
  const override = Number(periodoOpts.despensaMontoOverride) || 0;
  if (override > 0) {
    return {
      despensaMonto: roundMoney(override),
      despensaBase: roundMoney(override),
      despensaTopeAplicado: 0,
      pagaDespensa: 1,
      despensaPagoMensual: pagoMensual ? 1 : 0
    };
  }

  const cfg = empleado.nominaConfig || {};
  let modalidad = cfg.despensaModalidad || 'ninguna';
  if (modalidad === 'ninguna' && (Number(cfg.despensaMonto) > 0 || Number(cfg.despensaMontoMensual) > 0)) {
    modalidad = 'fijo';
  }
  if (modalidad === 'ninguna') return vacio;

  const uma = Number(parametros.uma) || 0;
  const diasMesUma = Number(parametros.diasMesUma) > 0 ? Number(parametros.diasMesUma) : DIAS_MES_UMA;
  const umaMensual =
    Number(parametros.umaMensual) > 0
      ? Number(parametros.umaMensual)
      : roundMoney(uma * diasMesUma);

  const topeModo = cfg.despensaTopeModo || 'imss_40_uma';
  let tope = Infinity;
  if (topeModo === 'imss_40_uma') tope = roundMoney(0.4 * umaMensual);
  else if (topeModo === 'uma_mensual') tope = umaMensual;
  else if (topeModo === 'monto' && Number(cfg.despensaTopeMonto) > 0) {
    tope = Number(cfg.despensaTopeMonto);
  }

  let bruto = 0;
  if (modalidad === 'fijo') {
    bruto =
      Number(cfg.despensaMontoMensual) > 0
        ? Number(cfg.despensaMontoMensual)
        : Number(cfg.despensaMonto) || 0;
  } else if (modalidad === 'porcentaje') {
    const porc = Number(cfg.despensaPorcentaje) || 0;
    const sdi = Number(contexto.sueldoDiario) || 0;
    const baseMensual = roundMoney(sdi * diasMesUma);
    bruto = (baseMensual * porc) / 100;
  }

  const monto = roundMoney(Math.min(bruto, Number.isFinite(tope) ? tope : bruto));
  return {
    despensaMonto: monto,
    despensaBase: roundMoney(bruto),
    despensaTopeAplicado: Number.isFinite(tope) ? roundMoney(tope) : 0,
    pagaDespensa: 1,
    despensaPagoMensual: pagoMensual ? 1 : 0
  };
}

function resolverInsumosNominaEmpleado(empleado, contexto, parametros, periodoOpts = {}) {
  const cfg = empleado.nominaConfig || {};
  const fondo = resolverFondoAhorro(empleado, contexto, parametros);
  const despensa = resolverDespensa(empleado, contexto, parametros, periodoOpts);
  const prima = resolverDiasPrimaVacacional(empleado, contexto, periodoOpts);
  const tabla = periodoOpts.tablaPrestaciones || null;

  return {
    infonavitDescuento: resolverInfonavitDescuento(empleado, contexto, parametros),
    fondoAhorroEmpresa: fondo.empresa,
    fondoAhorroTrabajador: fondo.trabajador,
    fondoAhorroTopeExento: fondo.topeExento,
    fondoAhorroTopePorcentaje: fondo.topePorPorcentaje,
    fondoAhorroTopeUma: fondo.topePorUma,
    fondoAhorroTopeUmaMensual: fondo.topeUmaMensual,
    fondoAhorroUmaMensual: fondo.umaMensual,
    fondoAhorroEmpresaExento: fondo.empresaExento,
    fondoAhorroEmpresaGravado: fondo.empresaGravado,
    diasPrimaVacacional: prima.diasPrimaVacacional,
    primaVacacionalPct: prima.primaVacacionalPct,
    diasAguinaldo: Number(tabla?.diasAguinaldo) > 0 ? Number(tabla.diasAguinaldo) : 15,
    proporcionAguinaldoFiniquito: cfg.proporcionAguinaldoFiniquito || 0,
    fondoAhorroSaldoFiniquito: cfg.fondoAhorroSaldoFiniquito || 0,
    ...despensa,
    seguroVidaMonto: Number(cfg.seguroVidaMonto) || 0,
    sgmmMonto: Number(cfg.sgmmMonto) || 0
  };
}

module.exports = {
  DIAS_MES_UMA,
  resolverInfonavitDescuento,
  resolverFondoAhorro,
  resolverDespensa,
  resolverDiasPrimaVacacional,
  topeUmaFondoParaPeriodo,
  resolverInsumosNominaEmpleado
};
