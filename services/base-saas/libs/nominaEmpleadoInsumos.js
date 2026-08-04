'use strict';

/**
 * Insumos de nómina por empleado (INFONAVIT, fondo de ahorro, finiquito).
 *
 * Fondo de ahorro — tope exento (LISR / práctica 2026):
 *   min( % del salario del período , factorUMA × UMA × días del período )
 * donde factorUMA default 1.3 y el % default 13.
 * Equivale a prorratear 1.3 × UMA anual (UMA × 365) al período.
 * El excedente de la aportación patronal sobre ese tope es gravable para ISR.
 */

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
 * @returns {{
 *   empresa: number,
 *   trabajador: number,
 *   topeExento: number,
 *   topePorPorcentaje: number,
 *   topePorUma: number,
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
    empresaExento: 0,
    empresaGravado: 0
  };

  const cfg = empleado.nominaConfig || {};
  if (!cfg.aplicaFondoAhorro) return vacio;

  const porc =
    cfg.porcentajeFondoAhorro > 0
      ? cfg.porcentajeFondoAhorro
      : parametros.porcentajeFondoAhorro || 13;

  const sdi = Number(contexto.sueldoDiario) || 0;
  const diasLab = Number(contexto.diasLaborados) || 0;
  const diasPeriodo =
    Number(contexto.diasPeriodo) > 0 ? Number(contexto.diasPeriodo) : diasLab;

  const baseSalario = sdi * diasLab;
  if (baseSalario <= 0 || porc <= 0) return vacio;

  // Aportación total = % del salario; mitad empresa / mitad trabajador
  const totalAportacion = (baseSalario * porc) / 100;
  const empresa = roundMoney(totalAportacion / 2);
  const trabajador = roundMoney(totalAportacion - empresa);

  const uma = Number(parametros.uma) || 0;
  const factorUma = Number(parametros.topeUmaFondoAhorro) || 1.3;
  const diasAnio = Number(parametros.diasAnioFondoAhorro) || 365;

  // 1.3 × UMA anual prorrateada al período (= factor × UMA × díasPeriodo)
  const topeUmaAnual = factorUma * uma * diasAnio;
  const topePorUma = roundMoney(diasAnio > 0 ? (topeUmaAnual * diasPeriodo) / diasAnio : 0);
  const topePorPorcentaje = roundMoney((baseSalario * porc) / 100);
  const topeExento = roundMoney(Math.min(topePorPorcentaje, topePorUma));

  const empresaExento = roundMoney(Math.min(empresa, topeExento));
  const empresaGravado = roundMoney(Math.max(0, empresa - empresaExento));

  return {
    empresa,
    trabajador,
    topeExento,
    topePorPorcentaje,
    topePorUma,
    empresaExento,
    empresaGravado
  };
}

function resolverInsumosNominaEmpleado(empleado, contexto, parametros) {
  const cfg = empleado.nominaConfig || {};
  const fondo = resolverFondoAhorro(empleado, contexto, parametros);

  return {
    infonavitDescuento: resolverInfonavitDescuento(empleado, contexto, parametros),
    fondoAhorroEmpresa: fondo.empresa,
    fondoAhorroTrabajador: fondo.trabajador,
    fondoAhorroTopeExento: fondo.topeExento,
    fondoAhorroTopePorcentaje: fondo.topePorPorcentaje,
    fondoAhorroTopeUma: fondo.topePorUma,
    fondoAhorroEmpresaExento: fondo.empresaExento,
    fondoAhorroEmpresaGravado: fondo.empresaGravado,
    diasPrimaVacacional: cfg.diasPrimaVacacional || 0,
    proporcionAguinaldoFiniquito: cfg.proporcionAguinaldoFiniquito || 0,
    fondoAhorroSaldoFiniquito: cfg.fondoAhorroSaldoFiniquito || 0
  };
}

module.exports = {
  resolverInfonavitDescuento,
  resolverFondoAhorro,
  resolverInsumosNominaEmpleado
};
