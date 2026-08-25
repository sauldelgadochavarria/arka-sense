'use strict';

/**
 * Calculadoras laborales puras del finiquito (sin I/O).
 * Importe legal ≠ negociado: los ajustes van aparte.
 */

const { diasVacacionesPorAntiguedad } = require('../../config/vacacionesLFT');
const {
  DEFAULTS_FINIQUITO,
  DEFAULTS_FISCAL_SEPARACION,
  conceptoByCodigo
} = require('../../config/finiquitoCatalog');

function roundN(n, dec = 6) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** dec;
  return Math.round(x * f) / f;
}

function money(n, dec = 2) {
  return roundN(n, dec);
}

function metaConcepto(codigo, overrides = {}) {
  const cat = conceptoByCodigo(codigo) || {};
  return {
    codigo: String(codigo || '').toUpperCase(),
    descripcion: overrides.descripcion || cat.nombre || codigo,
    origen: overrides.origen || cat.origenDefault || 'LEY',
    tipo: overrides.tipo || cat.tipo || 'percepcion',
    tipoFiscal: overrides.tipoFiscal || cat.tipoFiscal || 'ORDINARIO',
    grupo: overrides.grupo || cat.grupo || 'finiquito',
    claveSAT: overrides.claveSAT != null ? overrides.claveSAT : cat.claveSAT || '',
    aplicaExencion90Uma:
      overrides.aplicaExencion90Uma != null
        ? !!overrides.aplicaExencion90Uma
        : !!cat.aplicaExencion90Uma,
    bloqueDeduccion: overrides.bloqueDeduccion || cat.bloqueDeduccion || ''
  };
}

/**
 * Años de servicio para exención LISR (Art. 93 fr. XIII):
 * floor(días / diasAnio) + 1 si residuo >= diasRedondeo (default 183).
 */
function aniosServicioLisr(
  diasTotales,
  {
    diasAnio = DEFAULTS_FISCAL_SEPARACION.diasAnioLisr,
    diasRedondeo = DEFAULTS_FISCAL_SEPARACION.diasRedondeoAnioLisr
  } = {}
) {
  const dias = Math.max(0, Math.floor(Number(diasTotales) || 0));
  const base = Number(diasAnio) > 0 ? Number(diasAnio) : 365;
  const umbral = Number(diasRedondeo) > 0 ? Number(diasRedondeo) : 183;
  const enteros = Math.floor(dias / base);
  const residuo = dias % base;
  return enteros + (residuo >= umbral ? 1 : 0);
}

/**
 * Tope LFT arts. 485 y 486: la base de indemnización / prima de antigüedad
 * no debe exceder N veces el salario mínimo general de la zona geográfica.
 * @returns {{ base: number, topado: boolean, tope: number, salarioOriginal: number, salarioMinimo: number, veces: number }}
 */
function topeSalarioLft485(salario, salarioMinimo, veces = 2) {
  const original = Number(salario) || 0;
  const sm = Number(salarioMinimo) || 0;
  const n = Number(veces) > 0 ? Number(veces) : 2;
  if (!(sm > 0)) {
    return { base: original, topado: false, tope: 0, salarioOriginal: original, salarioMinimo: sm, veces: n };
  }
  const tope = sm * n;
  const base = Math.min(original, tope);
  return {
    base,
    topado: original > tope + 1e-9,
    tope,
    salarioOriginal: original,
    salarioMinimo: sm,
    veces: n
  };
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function diasDelAnio(fechaRef, override) {
  if (override != null && Number(override) > 0) return Number(override);
  const y = new Date(fechaRef).getFullYear();
  return isLeap(y) ? 366 : 365;
}

function startOfDay(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

/**
 * Antigüedad completa: años / meses / días + fracciones.
 */
function calcularAntiguedad(fechaIngreso, fechaBaja) {
  if (!fechaIngreso || !fechaBaja) {
    return {
      aniosCompletos: 0,
      meses: 0,
      dias: 0,
      aniosProporcionales: 0,
      diasTotales: 0
    };
  }
  const a = startOfDay(fechaIngreso);
  const b = startOfDay(fechaBaja);
  if (b < a) {
    return {
      aniosCompletos: 0,
      meses: 0,
      dias: 0,
      aniosProporcionales: 0,
      diasTotales: 0
    };
  }

  const diasTotales = Math.floor((b - a) / 86400000);
  let anios = b.getFullYear() - a.getFullYear();
  let meses = b.getMonth() - a.getMonth();
  let dias = b.getDate() - a.getDate();
  if (dias < 0) {
    meses -= 1;
    const prev = new Date(b.getFullYear(), b.getMonth(), 0);
    dias += prev.getDate();
  }
  if (meses < 0) {
    anios -= 1;
    meses += 12;
  }
  const aniosProporcionales = roundN(diasTotales / 365.25, 6);
  return {
    aniosCompletos: Math.max(0, anios),
    meses: Math.max(0, meses),
    dias: Math.max(0, dias),
    aniosProporcionales,
    diasTotales
  };
}

function diasTrabajadosDelAnio(fechaIngreso, fechaBaja) {
  const baja = startOfDay(fechaBaja);
  const inicioAnio = new Date(baja.getFullYear(), 0, 1);
  const ingreso = startOfDay(fechaIngreso);
  const desde = ingreso > inicioAnio ? ingreso : inicioAnio;
  if (baja < desde) return 0;
  return Math.floor((baja - desde) / 86400000) + 1;
}

function diasDesdeAniversario(fechaIngreso, fechaBaja) {
  const baja = startOfDay(fechaBaja);
  const ingreso = startOfDay(fechaIngreso);
  let anni = new Date(baja.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (anni > baja) {
    anni = new Date(baja.getFullYear() - 1, ingreso.getMonth(), ingreso.getDate());
  }
  if (anni < ingreso) anni = ingreso;
  return Math.max(0, Math.floor((baja - anni) / 86400000));
}

function resolverDiasVacacionesAnuales(aniosCompletos, tablaVacaciones) {
  if (Array.isArray(tablaVacaciones) && tablaVacaciones.length) {
    const sorted = [...tablaVacaciones].sort((x, y) => Number(x.anio || x.anios || 0) - Number(y.anio || y.anios || 0));
    let dias = 0;
    for (const row of sorted) {
      const anio = Number(row.anio != null ? row.anio : row.anios);
      if (aniosCompletos >= anio) dias = Number(row.dias) || 0;
    }
    return dias;
  }
  return diasVacacionesPorAntiguedad(aniosCompletos);
}

/**
 * @param {object} params
 * @returns {{ conceptos: object[], resumen: object, antiguedad: object }}
 */
function calcularComponentesLaborales(params) {
  const p = { ...DEFAULTS_FINIQUITO, ...params };
  const decI = p.redondeoDecimalesInternos ?? 6;
  const decM = p.redondeoDecimalesImporte ?? 2;

  const fechaIngreso = p.fechaIngreso;
  const fechaBaja = p.fechaBaja;
  const salarioDiario = Number(p.salarioDiario) || 0;
  const salarioMinimo = Number(p.salarioMinimo) || 0;
  const vecesTope = Number(p.vecesSalarioMinimoTopeLft) > 0 ? Number(p.vecesSalarioMinimoTopeLft) : 2;
  const topePrima = topeSalarioLft485(
    Number(p.salarioBasePrimaAntiguedad != null ? p.salarioBasePrimaAntiguedad : salarioDiario) || 0,
    salarioMinimo,
    vecesTope
  );
  const topeIndemn = topeSalarioLft485(
    Number(p.salarioBaseIndemnizacion != null ? p.salarioBaseIndemnizacion : salarioDiario) || 0,
    salarioMinimo,
    vecesTope
  );
  const salarioBasePrimaAntiguedad = topePrima.base;
  const salarioBaseIndemnizacion = topeIndemn.base;

  const antiguedad = calcularAntiguedad(fechaIngreso, fechaBaja);
  const diasAnio = diasDelAnio(fechaBaja || new Date(), p.diasAnio);
  const conceptos = [];

  function pushConcepto(partial) {
    const meta = metaConcepto(partial.codigo, partial);
    const importeLegal = money(partial.importeLegal || 0, decM);
    const ajuste = money(partial.ajuste || 0, decM);
    conceptos.push({
      codigo: meta.codigo,
      descripcion: meta.descripcion,
      origen: meta.origen,
      tipo: meta.tipo,
      tipoFiscal: meta.tipoFiscal,
      grupo: meta.grupo,
      claveSAT: meta.claveSAT,
      aplicaExencion90Uma: meta.aplicaExencion90Uma,
      aplica: partial.aplica !== false,
      base: roundN(partial.base || 0, decI),
      unidades: roundN(partial.unidades || 0, decI),
      tasa: roundN(partial.tasa != null ? partial.tasa : 1, decI),
      importeLegal,
      ajuste,
      importeFinal: money(importeLegal + ajuste, decM),
      gravadoISR: money(partial.gravadoISR != null ? partial.gravadoISR : importeLegal + ajuste, decM),
      exentoISR: money(partial.exentoISR || 0, decM),
      integraSBC: !!partial.integraSBC,
      detalle: partial.detalle || {}
    });
  }

  // 1) Salario pendiente
  const diasPendientes = Number(p.diasPendientes) || 0;
  const variablesDevengadas = Number(p.variablesDevengadas) || 0;
  if (diasPendientes > 0 || variablesDevengadas > 0) {
    const importe = salarioDiario * diasPendientes + variablesDevengadas;
    pushConcepto({
      codigo: 'FIN_SALARIO_PENDIENTE',
      descripcion: 'Sueldo pendiente',
      origen: 'NOMINA',
      base: salarioDiario,
      unidades: diasPendientes,
      importeLegal: importe,
      detalle: { diasPendientes, variablesDevengadas }
    });
  }

  // 2) Aguinaldo proporcional
  const diasAguinaldo = Number(p.diasAguinaldo) > 0 ? Number(p.diasAguinaldo) : DEFAULTS_FINIQUITO.diasAguinaldo;
  const diasTrabAnio = Number(p.diasTrabajadosDelAnio != null ? p.diasTrabajadosDelAnio : diasTrabajadosDelAnio(fechaIngreso, fechaBaja));
  const aguinaldoAnual = salarioDiario * diasAguinaldo;
  const aguinaldoProp = (aguinaldoAnual * diasTrabAnio) / diasAnio;
  if (aguinaldoProp > 0) {
    pushConcepto({
      codigo: 'FIN_AGUINALDO_PROPORCIONAL',
      descripcion: 'Aguinaldo proporcional',
      origen: diasAguinaldo > 15 ? 'CONTRATO' : 'LEY',
      base: salarioDiario,
      unidades: roundN((diasAguinaldo * diasTrabAnio) / diasAnio, decI),
      importeLegal: aguinaldoProp,
      detalle: { diasAguinaldo, diasTrabajadosDelAnio: diasTrabAnio, diasAnio, aguinaldoAnual }
    });
  }

  // 3) Vacaciones pendientes + proporcionales
  const aniosVac = Math.max(1, antiguedad.aniosCompletos || (antiguedad.diasTotales > 0 ? 1 : 0));
  const diasVacAnuales =
    Number(p.diasVacacionesAnuales) > 0
      ? Number(p.diasVacacionesAnuales)
      : resolverDiasVacacionesAnuales(aniosVac, p.tablaVacaciones);
  const diasVacPendientes = Number(p.diasVacacionesPendientes) || 0;
  const diasDesdeAnn = Number(
    p.diasDesdeAniversario != null ? p.diasDesdeAniversario : diasDesdeAniversario(fechaIngreso, fechaBaja)
  );
  let diasVacProp =
    p.diasVacacionesProporcionales != null
      ? Number(p.diasVacacionesProporcionales)
      : roundN((diasVacAnuales * diasDesdeAnn) / diasAnio, decI);
  if (!(diasVacProp > 0)) diasVacProp = 0;

  if (diasVacPendientes > 0) {
    pushConcepto({
      codigo: 'FIN_VACACIONES_PENDIENTES',
      descripcion: 'Vacaciones pendientes',
      origen: 'LEY',
      base: salarioDiario,
      unidades: diasVacPendientes,
      importeLegal: salarioDiario * diasVacPendientes,
      detalle: { diasVacacionesPendientes: diasVacPendientes }
    });
  }
  if (diasVacProp > 0) {
    pushConcepto({
      codigo: 'FIN_VACACIONES_PROPORCIONALES',
      descripcion: 'Vacaciones proporcionales',
      origen: 'LEY',
      base: salarioDiario,
      unidades: diasVacProp,
      importeLegal: salarioDiario * diasVacProp,
      detalle: { diasVacacionesAnuales: diasVacAnuales, diasDesdeAniversario: diasDesdeAnn, diasAnio }
    });
  }

  // 4) Prima vacacional sobre (pendientes + proporcionales)
  const pctPrima =
    Number(p.porcentajePrimaVacacional) > 0
      ? Number(p.porcentajePrimaVacacional)
      : DEFAULTS_FINIQUITO.porcentajePrimaVacacional;
  const diasBasePrima = diasVacPendientes + diasVacProp;
  if (diasBasePrima > 0 && pctPrima > 0) {
    pushConcepto({
      codigo: 'FIN_PRIMA_VACACIONAL',
      descripcion: 'Prima vacacional',
      origen: pctPrima > 0.25 ? 'CONTRATO' : 'LEY',
      base: salarioDiario,
      unidades: diasBasePrima,
      tasa: pctPrima,
      importeLegal: salarioDiario * diasBasePrima * pctPrima,
      detalle: { porcentajePrimaVacacional: pctPrima, diasBasePrima }
    });
  }

  // 5) Prima de antigüedad (Art. 162; base topada Arts. 485 y 486)
  const diasPrimaAnt = Number(p.diasPrimaAntiguedadPorAnio) || DEFAULTS_FINIQUITO.diasPrimaAntiguedadPorAnio;
  let aplicaPrima = !!p.aplicaPrimaAntiguedad;
  if (p.aplicaPrimaAntiguedadSiAnios != null && p.aplicaPrimaAntiguedad == null) {
    aplicaPrima = antiguedad.aniosCompletos >= Number(p.aplicaPrimaAntiguedadSiAnios);
  }
  if (aplicaPrima && antiguedad.aniosCompletos > 0) {
    const aniosPrima = p.usarAniosProporcionalesPrima
      ? antiguedad.aniosProporcionales
      : antiguedad.aniosCompletos;
    pushConcepto({
      codigo: 'FIN_PRIMA_ANTIGUEDAD',
      descripcion: 'Prima de antigüedad',
      origen: 'LEY',
      tipoFiscal: 'SEPARACION',
      grupo: 'liquidacion',
      base: salarioBasePrimaAntiguedad,
      unidades: aniosPrima,
      tasa: diasPrimaAnt,
      importeLegal: salarioBasePrimaAntiguedad * diasPrimaAnt * aniosPrima,
      detalle: {
        diasPrimaAntiguedadPorAnio: diasPrimaAnt,
        aniosPrima,
        fundamento: 'LFT Art. 162; tope base Arts. 485 y 486',
        ...topePrima
      }
    });
  }

  // 6) Indemnización 3 meses (base topada Arts. 485 y 486)
  if (p.aplicaIndemnizacionTresMeses) {
    const diasMes = Number(p.diasMesIndemnizacion) || 30;
    const meses = Number(p.mesesIndemnizacion) || 3;
    pushConcepto({
      codigo: 'FIN_INDEMNIZACION_3_MESES',
      descripcion: 'Indemnización 3 meses',
      origen: 'LEY',
      tipoFiscal: 'SEPARACION',
      grupo: 'liquidacion',
      base: salarioBaseIndemnizacion,
      unidades: diasMes * meses,
      importeLegal: salarioBaseIndemnizacion * diasMes * meses,
      detalle: { diasMes, meses, fundamento: 'LFT; tope base Arts. 485 y 486', ...topeIndemn }
    });
  }

  // 7) 20 días por año (base topada Arts. 485 y 486)
  if (p.aplica20DiasPorAnio) {
    const diasPorAnio = Number(p.diasIndemnizacionPorAnio) || 20;
    const aniosInd =
      p.usarAniosProporcionalesIndemnizacion !== false
        ? antiguedad.aniosProporcionales
        : antiguedad.aniosCompletos;
    pushConcepto({
      codigo: 'FIN_INDEMNIZACION_20_DIAS',
      descripcion: 'Indemnización 20 días por año',
      origen: 'LEY',
      tipoFiscal: 'SEPARACION',
      grupo: 'liquidacion',
      base: salarioBaseIndemnizacion,
      unidades: aniosInd,
      tasa: diasPorAnio,
      importeLegal: salarioBaseIndemnizacion * diasPorAnio * aniosInd,
      detalle: { diasPorAnio, aniosInd, fundamento: 'LFT; tope base Arts. 485 y 486', ...topeIndemn }
    });
  }

  // 8) Salarios vencidos (solo si autorizado / capturado)
  if (p.aplicaSalariosVencidos && Number(p.salariosVencidosImporte) > 0) {
    pushConcepto({
      codigo: 'FIN_SALARIOS_VENCIDOS',
      descripcion: 'Salarios vencidos',
      origen: 'MANUAL',
      tipoFiscal: 'SEPARACION',
      grupo: 'liquidacion',
      unidades: Number(p.salariosVencidosDias) || 0,
      base: Number(p.salariosVencidosSalarioBase) || salarioBaseIndemnizacion,
      importeLegal: Number(p.salariosVencidosImporte),
      detalle: {
        fechaInicio: p.salariosVencidosFechaInicio || null,
        fechaFin: p.salariosVencidosFechaFin || null
      }
    });
  }

  // 9) Fondo de ahorro
  if (Number(p.fondoAhorroSaldo) > 0) {
    pushConcepto({
      codigo: 'FIN_FONDO_AHORRO',
      descripcion: 'Fondo de ahorro pendiente',
      origen: 'NOMINA',
      importeLegal: Number(p.fondoAhorroSaldo),
      detalle: { saldo: Number(p.fondoAhorroSaldo) }
    });
  }

  // 10) Conceptos pendientes / manuales de percepción
  for (const extra of p.conceptosExtra || []) {
    const importe = Number(extra.importe) || 0;
    if (!importe) continue;
    pushConcepto({
      codigo: extra.codigo || 'FIN_OTROS',
      descripcion: extra.descripcion || 'Otro concepto',
      origen: extra.origen || 'MANUAL',
      tipo: extra.tipo || 'percepcion',
      tipoFiscal: extra.tipoFiscal || 'ORDINARIO',
      grupo: extra.tipo === 'deduccion' ? 'deduccion' : 'finiquito',
      importeLegal: importe,
      gravadoISR: extra.gravadoISR,
      exentoISR: extra.exentoISR
    });
  }

  const percepciones = conceptos.filter((c) => c.tipo === 'percepcion' && c.aplica);
  const deducciones = conceptos.filter((c) => c.tipo === 'deduccion' && c.aplica);

  const finiquitoLegal = money(
    percepciones.filter((c) => c.grupo === 'finiquito').reduce((s, c) => s + c.importeLegal, 0),
    decM
  );
  const liquidacionLegal = money(
    percepciones.filter((c) => c.grupo === 'liquidacion').reduce((s, c) => s + c.importeLegal, 0),
    decM
  );
  const totalLegalBruto = money(
    percepciones.reduce((s, c) => s + c.importeLegal, 0),
    decM
  );
  const totalDeduccionesLegal = money(
    deducciones.reduce((s, c) => s + c.importeLegal, 0),
    decM
  );

  return {
    antiguedad,
    conceptos,
    resumen: {
      finiquitoLegal,
      liquidacionLegal,
      totalLegalBruto,
      totalDeduccionesLegal,
      netoLegal: money(totalLegalBruto - totalDeduccionesLegal, decM),
      diasVacacionesAnuales: diasVacAnuales,
      diasVacacionesProporcionales: diasVacProp,
      diasVacacionesPendientes: diasVacPendientes,
      diasAguinaldo,
      diasAnio
    }
  };
}

/**
 * Aplica negociación sin mutar importeLegal.
 */
function aplicarNegociacion(conceptos, negociacion = {}, opts = {}) {
  const decM = opts.redondeoDecimalesImporte ?? 2;
  const out = conceptos.map((c) => ({ ...c, ajuste: money(c.ajuste || 0, decM), importeFinal: money(c.importeLegal + (c.ajuste || 0), decM) }));

  const grat = Number(negociacion?.gratificacion) || 0;
  const tieneAjustes = Array.isArray(negociacion?.ajustes) && negociacion.ajustes.length > 0;
  const activa = !!(negociacion && (negociacion.activa || grat > 0 || tieneAjustes));
  if (!activa) {
    return { conceptos: out, ajustesNegociacion: 0 };
  }

  const ajustesMap = new Map();
  for (const a of negociacion.ajustes || []) {
    const code = String(a.concepto || a.codigo || '').toUpperCase();
    if (!code) continue;
    ajustesMap.set(code, money((ajustesMap.get(code) || 0) + (Number(a.importe) || 0), decM));
  }

  for (const c of out) {
    if (ajustesMap.has(c.codigo)) {
      c.ajuste = money(ajustesMap.get(c.codigo), decM);
      c.importeFinal = money(c.importeLegal + c.ajuste, decM);
      ajustesMap.delete(c.codigo);
    }
  }

  // Gratificación: bono extraordinario (100% gravado) o pago por separación (023 / bolsa 90 UMA)
  if (grat) {
    const comoSeparacion = !!negociacion.gratificacionEsSeparacion;
    const codigo = comoSeparacion ? 'FIN_GRATIFICACION_SEPARACION' : 'FIN_GRATIFICACION';
    const meta = metaConcepto(codigo);
    const existing = out.find((c) => c.codigo === codigo);
    if (existing) {
      existing.ajuste = money((existing.ajuste || 0) + grat, decM);
      existing.importeFinal = money(existing.importeLegal + existing.ajuste, decM);
    } else {
      out.push({
        codigo: meta.codigo,
        descripcion: meta.descripcion,
        origen: meta.origen,
        tipo: meta.tipo,
        tipoFiscal: meta.tipoFiscal,
        grupo: meta.grupo,
        claveSAT: meta.claveSAT,
        aplicaExencion90Uma: meta.aplicaExencion90Uma,
        aplica: true,
        base: 0,
        unidades: 0,
        tasa: 1,
        importeLegal: 0,
        ajuste: money(grat, decM),
        importeFinal: money(grat, decM),
        gravadoISR: money(grat, decM),
        exentoISR: 0,
        integraSBC: false,
        detalle: {
          motivo: comoSeparacion
            ? 'Gratificación por mutuo acuerdo / separación (SAT 023)'
            : 'Bono/gratificación extraordinaria (100% gravado ISR)'
        }
      });
    }
  }

  // Ajustes a códigos no existentes → FIN_CONVENIO agregado
  for (const [code, importe] of ajustesMap.entries()) {
    const codigo = code.startsWith('FIN_') ? code : 'FIN_CONVENIO';
    const meta = metaConcepto(codigo);
    out.push({
      codigo: meta.codigo,
      descripcion: meta.descripcion || `Ajuste convenio ${code}`,
      origen: meta.origen,
      tipo: importe < 0 ? 'deduccion' : meta.tipo,
      tipoFiscal: meta.tipoFiscal,
      grupo: meta.grupo,
      claveSAT: meta.claveSAT,
      aplicaExencion90Uma: meta.aplicaExencion90Uma,
      aplica: true,
      base: 0,
      unidades: 0,
      tasa: 1,
      importeLegal: 0,
      ajuste: money(importe, decM),
      importeFinal: money(importe, decM),
      gravadoISR: money(Math.max(0, importe), decM),
      exentoISR: 0,
      integraSBC: false,
      detalle: {}
    });
  }

  const ajustesNegociacion = money(
    out.reduce((s, c) => s + (Number(c.ajuste) || 0), 0),
    decM
  );
  return { conceptos: out, ajustesNegociacion };
}

/**
 * Clasifica gravado/exento:
 * - ORDINARIO: reglas nómina (aguinaldo, prima vac, fondo) o 100% gravado (bonos).
 * - SEPARACIÓN con aplicaExencion90Uma: bolsa GLOBAL añosLISR × N × UMA (no por concepto).
 */
function clasificarFiscalBasico(
  conceptos,
  {
    umaDiaria = 0,
    diasTotalesServicio = 0,
    aniosServicio = null,
    fondoAhorroTopeExento = 0,
    topeUmaFondoAhorro = 1.3,
    diasAnioFondoAhorro = 365,
    multiplicadorExencionSeparacion = DEFAULTS_FISCAL_SEPARACION.multiplicadorExencionSeparacion,
    diasRedondeoAnioLisr = DEFAULTS_FISCAL_SEPARACION.diasRedondeoAnioLisr,
    diasAnioLisr = DEFAULTS_FISCAL_SEPARACION.diasAnioLisr
  } = {}
) {
  const { aplicarReglaLey } = require('../nomina/fiscalDesgloseService');
  const decM = 2;
  const uma = Number(umaDiaria) || 0;
  const mult = Number(multiplicadorExencionSeparacion) > 0 ? Number(multiplicadorExencionSeparacion) : 90;

  let topeFondo = Number(fondoAhorroTopeExento) || 0;
  if (!(topeFondo > 0) && uma > 0) {
    topeFondo = uma * (Number(topeUmaFondoAhorro) || 1.3) * (Number(diasAnioFondoAhorro) || 365);
  }

  const aniosLisr =
    aniosServicio != null && Number.isFinite(Number(aniosServicio))
      ? Math.max(0, Number(aniosServicio))
      : aniosServicioLisr(diasTotalesServicio, {
          diasAnio: diasAnioLisr,
          diasRedondeo: diasRedondeoAnioLisr
        });
  const topeExentoSeparacion = uma > 0 && aniosLisr > 0 ? money(uma * mult * aniosLisr, decM) : 0;

  // Primera pasada: clasificar ordinarios / deducciones; dejar separación para bolsa
  const paso1 = conceptos.map((c) => {
    if (c.tipo === 'deduccion') {
      return { ...c, gravadoISR: 0, exentoISR: 0, isrEstimado: 0, reglaFiscal: 'deduccion' };
    }

    const bruto = money(c.importeFinal, decM);
    const codigo = String(c.codigo || '').toUpperCase();
    const meta = metaConcepto(codigo, c);
    const base = {
      ...c,
      claveSAT: c.claveSAT || meta.claveSAT,
      aplicaExencion90Uma:
        c.aplicaExencion90Uma != null ? !!c.aplicaExencion90Uma : meta.aplicaExencion90Uma
    };

    if (codigo === 'FIN_PRIMA_VACACIONAL') {
      const r = aplicarReglaLey('prima_vacacional', bruto, { uma, topeExentoUMA: 15 });
      return {
        ...base,
        gravadoISR: money(r.gravado, decM),
        exentoISR: money(r.exento, decM),
        isrEstimado: null,
        reglaFiscal: 'prima_vacacional',
        detalle: {
          ...(c.detalle || {}),
          topeExentoUMA: 15,
          topeExentoMonto: money(uma * 15, decM),
          regla: r.regla
        }
      };
    }

    if (codigo === 'FIN_AGUINALDO_PROPORCIONAL') {
      const r = aplicarReglaLey('aguinaldo', bruto, { uma, topeExentoUMA: 30 });
      return {
        ...base,
        gravadoISR: money(r.gravado, decM),
        exentoISR: money(r.exento, decM),
        isrEstimado: null,
        reglaFiscal: 'aguinaldo',
        detalle: {
          ...(c.detalle || {}),
          topeExentoUMA: 30,
          topeExentoMonto: money(uma * 30, decM),
          regla: r.regla
        }
      };
    }

    if (codigo === 'FIN_FONDO_AHORRO') {
      const r = aplicarReglaLey('fondo_ahorro', bruto, {
        uma,
        contexto: { fondoAhorroTopeExento: topeFondo }
      });
      return {
        ...base,
        gravadoISR: money(r.gravado, decM),
        exentoISR: money(r.exento, decM),
        isrEstimado: null,
        reglaFiscal: 'fondo_ahorro',
        detalle: {
          ...(c.detalle || {}),
          topeExentoMonto: money(topeFondo, decM),
          regla: r.regla
        }
      };
    }

    // Bolsa global Art. 93 fr. XIII (prima antigüedad, indemnizaciones, gratificación separación…)
    if (base.aplicaExencion90Uma) {
      return {
        ...base,
        _pendienteBolsaSeparacion: true,
        gravadoISR: money(bruto, decM),
        exentoISR: 0,
        isrEstimado: null,
        reglaFiscal: 'separacion_93_xiii'
      };
    }

    // Bono / gratificación extraordinaria → 100% gravado
    if (codigo === 'FIN_GRATIFICACION') {
      return {
        ...base,
        gravadoISR: money(bruto, decM),
        exentoISR: 0,
        isrEstimado: null,
        reglaFiscal: 'bono_todo_gravado',
        detalle: {
          ...(c.detalle || {}),
          nota: 'Gratificación/bono extraordinario: 100% gravado; no aplica exención 90×UMA'
        }
      };
    }

    // Resto ordinario
    return {
      ...base,
      gravadoISR: money(bruto, decM),
      exentoISR: 0,
      isrEstimado: null,
      reglaFiscal: 'todo_gravado'
    };
  });

  // Bolsa global de separación: distribuir tope proporcionalmente
  const idxs = [];
  let sumaSeparacion = 0;
  paso1.forEach((c, i) => {
    if (c._pendienteBolsaSeparacion) {
      idxs.push(i);
      sumaSeparacion += money(c.importeFinal, decM);
    }
  });
  sumaSeparacion = money(sumaSeparacion, decM);

  const exentoTotalSeparacion = money(Math.min(sumaSeparacion, topeExentoSeparacion), decM);
  const gravadoTotalSeparacion = money(Math.max(0, sumaSeparacion - exentoTotalSeparacion), decM);

  let exentoAsignado = 0;
  idxs.forEach((i, pos) => {
    const c = paso1[i];
    const bruto = money(c.importeFinal, decM);
    let exento;
    if (!(sumaSeparacion > 0) || !(exentoTotalSeparacion > 0)) {
      exento = 0;
    } else if (pos === idxs.length - 1) {
      // Último: residual para cuadrar centavos
      exento = money(exentoTotalSeparacion - exentoAsignado, decM);
    } else {
      exento = money((bruto / sumaSeparacion) * exentoTotalSeparacion, decM);
      exentoAsignado += exento;
    }
    exento = Math.max(0, Math.min(bruto, exento));
    const gravado = money(bruto - exento, decM);
    paso1[i] = {
      ...c,
      gravadoISR: gravado,
      exentoISR: exento,
      reglaFiscal: 'separacion_93_xiii',
      detalle: {
        ...(c.detalle || {}),
        aniosServicioLisr: aniosLisr,
        diasTotalesServicio: Number(diasTotalesServicio) || 0,
        diasRedondeoAnioLisr,
        diasAnioLisr,
        multiplicadorExencionSeparacion: mult,
        umaDiaria: uma,
        topeExentoSeparacion,
        sumaTotalSeparacion: sumaSeparacion,
        exentoTotalSeparacion,
        gravadoTotalSeparacion,
        claveSAT: c.claveSAT || ''
      }
    };
    delete paso1[i]._pendienteBolsaSeparacion;
  });

  return paso1.map((c) => {
    if (c._pendienteBolsaSeparacion) delete c._pendienteBolsaSeparacion;
    return c;
  });
}

function totalizar(conceptos, extras = {}) {
  const decM = 2;
  const perc = conceptos.filter((c) => c.tipo === 'percepcion' && c.aplica !== false);
  const ded = conceptos.filter((c) => c.tipo === 'deduccion' && c.aplica !== false);
  const finiquitoLegal = money(perc.filter((c) => c.grupo === 'finiquito').reduce((s, c) => s + c.importeLegal, 0), decM);
  const liquidacionLegal = money(perc.filter((c) => c.grupo === 'liquidacion').reduce((s, c) => s + c.importeLegal, 0), decM);
  const ajustesNegociacion = money(conceptos.reduce((s, c) => s + (Number(c.ajuste) || 0), 0), decM);
  const totalBruto = money(perc.reduce((s, c) => s + c.importeFinal, 0), decM);
  const deducciones = money(ded.reduce((s, c) => s + Math.abs(c.importeFinal), 0), decM);
  const gravado = money(perc.reduce((s, c) => s + (Number(c.gravadoISR) || 0), 0), decM);
  const exento = money(perc.reduce((s, c) => s + (Number(c.exentoISR) || 0), 0), decM);
  const isr = money(
    ded
      .filter((c) => String(c.codigo || '').includes('ISR'))
      .reduce((s, c) => s + Math.abs(Number(c.importeFinal) || 0), 0)
  );
  return {
    finiquitoLegal,
    liquidacionLegal,
    ajustesNegociacion,
    totalBruto,
    gravadoISR: gravado,
    exentoISR: exento,
    isr,
    deducciones,
    deduccionesNomina: money(
      ded.filter((c) => c.grupo === 'deduccion_nomina').reduce((s, c) => s + Math.abs(c.importeFinal), 0),
      decM
    ),
    deduccionesFiniquito: money(
      ded
        .filter((c) => c.grupo === 'deduccion_finiquito' || c.grupo === 'deduccion_separacion')
        .reduce((s, c) => s + Math.abs(c.importeFinal), 0),
      decM
    ),
    netoPagar: money(totalBruto - deducciones, decM),
    ...extras
  };
}

module.exports = {
  roundN,
  money,
  diasDelAnio,
  topeSalarioLft485,
  calcularAntiguedad,
  aniosServicioLisr,
  metaConcepto,
  diasTrabajadosDelAnio,
  diasDesdeAniversario,
  resolverDiasVacacionesAnuales,
  calcularComponentesLaborales,
  aplicarNegociacion,
  clasificarFiscalBasico,
  totalizar
};
