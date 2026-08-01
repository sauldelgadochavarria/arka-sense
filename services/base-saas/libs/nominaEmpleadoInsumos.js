'use strict';

/**
 * Insumos de nómina por empleado (INFONAVIT, fondo de ahorro, finiquito).
 */

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

function resolverFondoAhorro(empleado, contexto, parametros) {
  const cfg = empleado.nominaConfig || {};
  if (!cfg.aplicaFondoAhorro) return { empresa: 0, trabajador: 0 };

  const porc =
    cfg.porcentajeFondoAhorro > 0
      ? cfg.porcentajeFondoAhorro
      : parametros.porcentajeFondoAhorro || 13;

  const base = contexto.sueldoDiario * contexto.diasLaborados;
  if (base <= 0 || porc <= 0) return { empresa: 0, trabajador: 0 };

  const monto = (base * porc) / 100 / 2;
  return { empresa: monto, trabajador: monto };
}

function resolverInsumosNominaEmpleado(empleado, contexto, parametros) {
  const cfg = empleado.nominaConfig || {};
  const fondo = resolverFondoAhorro(empleado, contexto, parametros);

  return {
    infonavitDescuento: resolverInfonavitDescuento(empleado, contexto, parametros),
    fondoAhorroEmpresa: fondo.empresa,
    fondoAhorroTrabajador: fondo.trabajador,
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
