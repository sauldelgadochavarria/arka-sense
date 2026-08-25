'use strict';

/**
 * Deducciones de finiquito en dos bloques:
 * A) Nómina pendiente (días a pagar): ISR / IMSS / INFONAVIT / FONACOT / fondo / descuento empresa
 * B) Finiquito + separación: ISR sobre gravado ordinario de finiquito e ISR estimado Art. 95 sobre separación
 */

const {
  CODIGOS_BLOQUE_NOMINA,
  conceptoByCodigo
} = require('../../config/finiquitoCatalog');
const { money, metaConcepto } = require('./finiquitoCalculators');
const { resolverBaseImss } = require('../../libs/sdiHelpers');
const {
  resolverInsumosNominaEmpleado,
  resolverInfonavitDescuento,
  resolverFonacotDescuento,
  aplicarTope30Credito,
  baseNominalCreditos
} = require('../../libs/nominaEmpleadoInsumos');
const {
  obtenerParametrosVigentes,
  cargarRangosIsrParaPeriodo,
  cargarRangosTabla,
  isrDelPeriodo,
  aplicarTablaSync,
  imssObreroSsDelPeriodo,
  imssObreroRcvDelPeriodo
} = require('../nomina/tablasFiscalesService');
const { getTipoPeriodoById } = require('../tipoPeriodoNominaService');

function pushDed(out, codigo, importe, detalle = {}) {
  const m = Number(importe) || 0;
  if (!(m > 0)) return;
  const meta = metaConcepto(codigo);
  out.push({
    codigo: meta.codigo,
    descripcion: meta.descripcion,
    origen: meta.origen,
    tipo: 'deduccion',
    tipoFiscal: meta.tipoFiscal,
    grupo: meta.grupo || 'deduccion',
    claveSAT: meta.claveSAT,
    aplicaExencion90Uma: false,
    bloqueDeduccion: meta.bloqueDeduccion || conceptoByCodigo(codigo)?.bloqueDeduccion || 'manual',
    aplica: true,
    base: 0,
    unidades: 0,
    tasa: 1,
    importeLegal: money(m),
    ajuste: 0,
    importeFinal: money(m),
    gravadoISR: 0,
    exentoISR: 0,
    isrEstimado: null,
    reglaFiscal: 'deduccion',
    integraSBC: false,
    detalle
  });
}

function esBloqueNomina(c) {
  return CODIGOS_BLOQUE_NOMINA.includes(String(c.codigo || '').toUpperCase());
}

function esSeparacion(c) {
  return !!c.aplicaExencion90Uma || String(c.tipoFiscal || '').toUpperCase() === 'SEPARACION';
}

function sumGravado(list) {
  return money(list.reduce((s, c) => s + (Number(c.gravadoISR) || 0), 0));
}

/**
 * Estimación Art. 95: tasa efectiva del sueldo mensual ordinario × gravado de separación.
 * (Motor definitivo / CFDI SeparacionIndemnizacion pendiente.)
 */
function estimarIsrSeparacionArt95(gravadoSeparacion, salarioDiario, rangosMensual) {
  const g = Number(gravadoSeparacion) || 0;
  if (!(g > 0) || !rangosMensual?.length) return 0;
  const sueldoMensual = (Number(salarioDiario) || 0) * 30;
  if (!(sueldoMensual > 0)) return 0;
  const isrMensual = aplicarTablaSync(sueldoMensual, rangosMensual);
  const tasa = isrMensual / sueldoMensual;
  return money(g * tasa);
}

async function resolverTipoPeriodoMotor(tenantId, empleado) {
  if (empleado?.tipoPeriodoId) {
    try {
      const tp = await getTipoPeriodoById(tenantId, empleado.tipoPeriodoId);
      const motor = String(tp?.tipoMotor || '').toLowerCase();
      if (['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'].includes(motor)) {
        return motor;
      }
    } catch {
      /* fallback */
    }
  }
  return 'quincenal';
}

/**
 * @param {object} args
 * @param {object[]} args.conceptos - ya clasificados (gravado/exento)
 * @param {object} args.empleado
 * @param {object} args.parametros - params del finiquito (diasPendientes, descuentoEmpresa, …)
 * @param {string} args.tenantId
 * @param {Date} [args.fechaRef]
 */
async function calcularDeduccionesFiniquito({
  conceptos = [],
  empleado,
  parametros = {},
  tenantId,
  fechaRef = new Date()
}) {
  const percepciones = (conceptos || []).filter(
    (c) => c.tipo !== 'deduccion' && c.aplica !== false
  );
  const manuales = (conceptos || []).filter(
    (c) =>
      c.tipo === 'deduccion' &&
      c.aplica !== false &&
      ['FIN_PRESTAMO', 'FIN_OTRAS_DEDUCCIONES'].includes(String(c.codigo || '').toUpperCase())
  );

  const bloqueNomina = percepciones.filter(esBloqueNomina);
  const bloqueSeparacion = percepciones.filter(
    (c) => !esBloqueNomina(c) && esSeparacion(c)
  );
  const bloqueFiniquito = percepciones.filter(
    (c) => !esBloqueNomina(c) && !esSeparacion(c)
  );

  const diasPendientes =
    Number(parametros.diasPendientes) > 0
      ? Number(parametros.diasPendientes)
      : Number(bloqueNomina[0]?.unidades) || 0;
  const salarioDiario =
    Number(parametros.salarioDiario) || Number(empleado?.salarioDiario) || 0;

  const fiscalesParams = await obtenerParametrosVigentes(fechaRef);
  const tipoPeriodo = await resolverTipoPeriodoMotor(tenantId, empleado);
  const { rangos: rangosIsrPeriodo } = await cargarRangosIsrParaPeriodo(tipoPeriodo, fechaRef);
  const rangosIsrMensual = await cargarRangosTabla('ISR_MENSUAL', fechaRef);
  const cuotasImss = await cargarRangosTabla('IMSS_CUOTAS', fechaRef);
  const tramosCeav = await cargarRangosTabla('IMSS_CEAV_PATRONAL', fechaRef);

  const imssCtx = {
    salarioMinimo: fiscalesParams.salarioMinimo,
    topeUma: fiscalesParams.topeUmaImss,
    cuotasImss,
    tramosCeav
  };

  const baseImss = resolverBaseImss(
    empleado,
    fiscalesParams.uma,
    fiscalesParams.topeUmaImss
  );
  const sdi = baseImss.sdi || salarioDiario;

  const deducciones = [...manuales.map((c) => ({ ...c }))];
  const resumen = {
    bloqueNomina: {
      diasPendientes,
      gravado: sumGravado(bloqueNomina),
      percepciones: bloqueNomina.map((c) => c.codigo)
    },
    bloqueFiniquito: {
      gravado: sumGravado(bloqueFiniquito),
      percepciones: bloqueFiniquito.map((c) => c.codigo)
    },
    bloqueSeparacion: {
      gravado: sumGravado(bloqueSeparacion),
      percepciones: bloqueSeparacion.map((c) => c.codigo)
    },
    isrNomina: 0,
    isrFiniquito: 0,
    isrSeparacion: 0,
    imssSs: 0,
    imssRcv: 0,
    infonavit: 0,
    fonacot: 0,
    fondoAhorroTrabajador: 0,
    descuentoEmpresa: 0
  };

  // ——— A) Deducciones proporcionales a días pendientes ———
  if (diasPendientes > 0 && salarioDiario > 0) {
    const gravadoNomina = sumGravado(bloqueNomina);
    const isrNomina = money(
      isrDelPeriodo(gravadoNomina, tipoPeriodo, diasPendientes, rangosIsrPeriodo)
    );
    resumen.isrNomina = isrNomina;
    pushDed(deducciones, 'FIN_DED_ISR_NOMINA', isrNomina, {
      bloque: 'nomina',
      diasPendientes,
      gravado: gravadoNomina,
      tipoPeriodo,
      tabla: 'periodo'
    });

    const imssSs = money(imssObreroSsDelPeriodo(sdi, diasPendientes, fiscalesParams.uma, imssCtx));
    const imssRcv = money(imssObreroRcvDelPeriodo(sdi, diasPendientes, fiscalesParams.uma, imssCtx));
    resumen.imssSs = imssSs;
    resumen.imssRcv = imssRcv;
    pushDed(deducciones, 'FIN_DED_IMSS_SS', imssSs, {
      bloque: 'nomina',
      diasPendientes,
      sdi,
      sbc: baseImss.sbc
    });
    pushDed(deducciones, 'FIN_DED_IMSS_RCV', imssRcv, {
      bloque: 'nomina',
      diasPendientes,
      sdi
    });

    const ctxCreditos = {
      diasPeriodo: diasPendientes,
      diasLaborados: diasPendientes,
      diasPagados: diasPendientes,
      faltas: 0,
      sueldoDiario: salarioDiario,
      tipoPeriodo
    };
    const insumos = resolverInsumosNominaEmpleado(empleado, ctxCreditos, fiscalesParams, {});
    let infonavit = money(
      resolverInfonavitDescuento(empleado, ctxCreditos, fiscalesParams)
    );
    const baseNom = baseNominalCreditos(empleado, ctxCreditos);
    infonavit = money(aplicarTope30Credito(infonavit, baseNom));

    const fonacotRes = resolverFonacotDescuento(empleado, ctxCreditos, fiscalesParams, infonavit);
    const fonacot = money(fonacotRes?.descuento ?? 0);

    resumen.infonavit = infonavit;
    resumen.fonacot = fonacot;
    pushDed(deducciones, 'FIN_DED_INFONAVIT', infonavit, {
      bloque: 'nomina',
      diasPendientes,
      baseNominal: baseNom
    });
    pushDed(deducciones, 'FIN_DED_FONACOT', fonacot, {
      bloque: 'nomina',
      diasPendientes,
      detalleFonacot: fonacotRes
    });

    const fondoTrab = money(insumos.fondoAhorroTrabajador || 0);
    resumen.fondoAhorroTrabajador = fondoTrab;
    pushDed(deducciones, 'FIN_DED_FONDO_AHORRO', fondoTrab, {
      bloque: 'nomina',
      diasPendientes
    });
  }

  // Descuento empresa / préstamo (override o config)
  const cfg = empleado?.nominaConfig || {};
  const descEmpresa = money(
    Number(parametros.descuentoEmpresa) > 0
      ? Number(parametros.descuentoEmpresa)
      : Number(parametros.prestamoSaldo) > 0
        ? Number(parametros.prestamoSaldo)
        : Number(cfg.descuentoEmpresaFiniquito) || Number(cfg.prestamoSaldoFiniquito) || 0
  );
  resumen.descuentoEmpresa = descEmpresa;
  pushDed(deducciones, 'FIN_DED_EMPRESA', descEmpresa, {
    bloque: 'nomina',
    origen: 'override_o_config'
  });

  // ——— B) ISR finiquito ordinario (excluye sueldo pendiente y separación) ———
  const gravadoFin = sumGravado(bloqueFiniquito);
  if (gravadoFin > 0) {
    // Pagos extraordinarios: tarifa mensual sobre el gravado del bloque finiquito
    const isrFin = money(isrDelPeriodo(gravadoFin, 'mensual', 30, rangosIsrMensual));
    resumen.isrFiniquito = isrFin;
    pushDed(deducciones, 'FIN_DED_ISR_FINIQUITO', isrFin, {
      bloque: 'finiquito',
      gravado: gravadoFin,
      conceptos: bloqueFiniquito.map((c) => c.codigo),
      tabla: 'ISR_MENSUAL',
      nota: 'ISR sobre aguinaldo/vacaciones/prima/fondo/bono gravados (sin sueldo pendiente ni separación)'
    });
  }

  // ——— C) ISR separación (estimación Art. 95) ———
  const gravadoSep = sumGravado(bloqueSeparacion);
  if (gravadoSep > 0) {
    const isrSep = estimarIsrSeparacionArt95(gravadoSep, salarioDiario, rangosIsrMensual);
    resumen.isrSeparacion = isrSep;
    pushDed(deducciones, 'FIN_DED_ISR_SEPARACION', isrSep, {
      bloque: 'separacion',
      gravado: gravadoSep,
      conceptos: bloqueSeparacion.map((c) => c.codigo),
      metodo: 'art95_tasa_sueldo_mensual_estimado',
      nota: 'Estimación Art. 95; CFDI SeparacionIndemnizacion pendiente'
    });
  }

  const totalIsr = money(resumen.isrNomina + resumen.isrFiniquito + resumen.isrSeparacion);
  const totalDeducciones = money(
    deducciones.reduce((s, c) => s + Math.abs(Number(c.importeFinal) || 0), 0)
  );

  return {
    deducciones,
    resumen: {
      ...resumen,
      totalIsr,
      totalDeducciones,
      tipoPeriodo,
      sdi,
      uma: fiscalesParams.uma
    }
  };
}

/**
 * Une percepciones clasificadas + deducciones nuevas (reemplaza deducciones auto previas).
 */
function fusionarConceptosConDeducciones(conceptos, deduccionesNuevas) {
  const autoCodes = new Set(
    (deduccionesNuevas || [])
      .map((c) => String(c.codigo || '').toUpperCase())
      .filter((c) => c.startsWith('FIN_DED_'))
  );
  const kept = (conceptos || []).filter((c) => {
    if (c.tipo !== 'deduccion') return true;
    const code = String(c.codigo || '').toUpperCase();
    if (autoCodes.has(code)) return false;
    if (code.startsWith('FIN_DED_')) return false;
    return true;
  });
  return [...kept, ...(deduccionesNuevas || [])];
}

module.exports = {
  calcularDeduccionesFiniquito,
  fusionarConceptosConDeducciones,
  estimarIsrSeparacionArt95,
  CODIGOS_BLOQUE_NOMINA
};
