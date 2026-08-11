'use strict';

const { redondear, evaluateExpression } = require('./formulaEvaluator');
const {
  defaultFiscalFromNaturaleza,
  defaultImssConfig,
  emptyImssDesglose
} = require('../../models/fiscalConceptoShared');

/**
 * Parte un importe bruto en gravado / exento según config.fiscal.desglose.
 * Las reglas de ley complejas viven aquí (código versionable), no en fórmulas libres.
 */
function resolveFiscalConfig(concepto = {}) {
  if (concepto.fiscal && typeof concepto.fiscal === 'object') {
    const base = defaultFiscalFromNaturaleza(concepto.fiscal.naturaleza || concepto.naturaleza);
    const merged = {
      ...base,
      ...concepto.fiscal,
      desglose: { ...base.desglose, ...(concepto.fiscal.desglose || {}) }
    };
    const imssIn = concepto.fiscal.imss || {};
    const imssBase =
      imssIn.naturalezaSdi || imssIn.desglose
        ? defaultImssConfig({
            integraIMSS: merged.integraIMSS !== false,
            naturalezaSdi: imssIn.naturalezaSdi
          })
        : defaultImssConfig({ integraIMSS: merged.integraIMSS !== false });
    merged.imss = {
      ...imssBase,
      ...imssIn,
      desglose: emptyImssDesglose({
        ...imssBase.desglose,
        ...(imssIn.desglose || {})
      })
    };
    // Coherencia: excluido ⇔ no integra (prioriza flag integraIMSS)
    if (merged.integraIMSS === false || merged.imss.naturalezaSdi === 'excluido') {
      merged.integraIMSS = false;
      merged.imss.naturalezaSdi = 'excluido';
      merged.imss.desglose.modo = 'todo_excluye';
    }
    return merged;
  }
  return defaultFiscalFromNaturaleza(concepto.naturaleza);
}

function aplicarReglaLey(codigoRegla, importe, { uma = 0, contexto = {}, topeExentoUMA } = {}) {
  const regla = String(codigoRegla || '').toLowerCase();
  const monto = Number(importe) || 0;

  // Horas extras gravadas (LISR / Reglamento):
  // - Dobles (≤9 h/sem): 50% puede ir exento, topeado a N×UMA semanales (default 5).
  //   Gravado = la otra mitad + el exceso del 50% que rebase el tope de UMA.
  // - Triples (>9 h/sem o >3 h/día): van en otro concepto con todo_gravado (100%, sin exención).
  if (regla === 'horas_extra' || regla === 'horas_extra_dobles') {
    const vecesRaw = topeExentoUMA ?? contexto.topeExentoUMA;
    const veces = Number(vecesRaw) > 0 ? Number(vecesRaw) : 5;
    const tope = (Number(uma) || 0) * veces; // p.ej. 5 × UMA vigente
    const mitad = monto / 2;
    const exento = Math.min(mitad, Math.max(0, tope));
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'aguinaldo') {
    const veces = Number(topeExentoUMA) > 0 ? Number(topeExentoUMA) : 30;
    const tope = (Number(uma) || 0) * veces;
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'prima_vacacional') {
    // LISR: exento hasta el equivalente de 15 días de UMA
    const veces = Number(topeExentoUMA) > 0 ? Number(topeExentoUMA) : 15;
    const tope = (Number(uma) || 0) * veces;
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'ptu') {
    // LISR: PTU exenta hasta 15 días de UMA
    const veces = Number(topeExentoUMA) > 0 ? Number(topeExentoUMA) : 15;
    const tope = (Number(uma) || 0) * veces;
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'prima_dominical') {
    const tope = Number(uma) || 0; // 1 UMA por domingo (simplificado)
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'fondo_ahorro') {
    // Preferir tope de insumos: min(% salario, 1.3×UMA anual prorrateada)
    let tope = Number(contexto.fondoAhorroTopeExento);
    if (!Number.isFinite(tope) || tope < 0) {
      tope = (Number(uma) || 0) * 1.3 * (365 / 12);
    }
    const exento = Math.min(monto, Math.max(0, tope));
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  // Vales de despensa (LISR / previsión social):
  // - Pago mensual (1 corrida al mes): exento hasta 1 × UMA mensual.
  // - Pago semanal: exento hasta 7 × UMA diaria (1 UMA por día).
  // - Otros períodos sin pago mensual: 1 UMA × días del período.
  if (regla === 'despensa' || regla === 'vales_despensa' || regla === 'despensa_isr') {
    const tope = topeExentoIsrDespensa({ uma, contexto });
    const exento = Math.min(monto, Math.max(0, tope));
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  // Desconocida → todo gravado (seguro para no subdeclarar)
  return { gravado: redondear(monto), exento: 0, regla: regla || 'desconocida' };
}

function desglosarImporte(importe, fiscalCfg, { uma = 0, contexto = {}, scope = null } = {}) {
  const monto = Number(importe);
  if (!Number.isFinite(monto) || monto === 0) {
    return { importe: 0, gravado: 0, exento: 0, modo: fiscalCfg?.desglose?.modo || 'todo_gravado' };
  }

  const fiscal = fiscalCfg || defaultFiscalFromNaturaleza('gravado');
  const desglose = fiscal.desglose || { modo: 'todo_gravado' };
  const modo = desglose.modo || 'todo_gravado';

  let gravado = 0;
  let exento = 0;

  switch (modo) {
    case 'todo_exento':
      exento = monto;
      break;
    case 'tope_uma': {
      const tope = (Number(uma) || 0) * (Number(desglose.topeExentoUMA) || 0);
      exento = Math.min(monto, Math.max(0, tope));
      gravado = monto - exento;
      break;
    }
    case 'tope_monto': {
      const tope = Number(desglose.topeExentoMonto) || 0;
      exento = Math.min(monto, Math.max(0, tope));
      gravado = monto - exento;
      break;
    }
    case 'formula': {
      if (desglose.formulaExento && scope) {
        try {
          exento = redondear(evaluateExpression(desglose.formulaExento, { ...contexto, importe: monto }, scope));
        } catch {
          exento = 0;
        }
      }
      if (desglose.formulaGravado && scope) {
        try {
          gravado = redondear(evaluateExpression(desglose.formulaGravado, { ...contexto, importe: monto, exento }, scope));
        } catch {
          gravado = redondear(monto - exento);
        }
      } else {
        gravado = redondear(monto - exento);
      }
      break;
    }
    case 'regla_ley': {
      const r = aplicarReglaLey(desglose.codigoRegla, monto, {
        uma,
        contexto,
        topeExentoUMA: desglose.topeExentoUMA
      });
      gravado = r.gravado;
      exento = r.exento;
      break;
    }
    case 'todo_gravado':
    default:
      gravado = monto;
      break;
  }

  gravado = redondear(Math.max(0, gravado));
  exento = redondear(Math.max(0, exento));
  // Ajuste de centavos si la suma se desvía
  const suma = redondear(gravado + exento);
  if (suma !== redondear(monto) && modo !== 'formula') {
    gravado = redondear(monto - exento);
  }

  return { importe: redondear(monto), gravado, exento, modo };
}

function pickCtx(contexto, paths, fallback = 0) {
  if (!contexto || typeof contexto !== 'object') return fallback;
  for (const p of paths) {
    const parts = String(p).split('.');
    let cur = contexto;
    let ok = true;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object' || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && Number.isFinite(Number(cur))) return Number(cur);
  }
  // flat aliases
  for (const p of paths) {
    const key = String(p).split('.').pop();
    if (Number.isFinite(Number(contexto[key]))) return Number(contexto[key]);
  }
  return fallback;
}

function pickBoolCtx(contexto, paths, fallback = false) {
  if (!contexto || typeof contexto !== 'object') return fallback;
  const tryVal = (cur) => {
    if (cur === true || cur === 1 || cur === '1' || cur === 'true' || cur === 'on') return true;
    if (cur === false || cur === 0 || cur === '0' || cur === 'false') return false;
    return null;
  };
  for (const p of paths) {
    const parts = String(p).split('.');
    let cur = contexto;
    let ok = true;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object' || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok) {
      const b = tryVal(cur);
      if (b != null) return b;
    }
  }
  for (const p of paths) {
    const key = String(p).split('.').pop();
    if (key in contexto) {
      const b = tryVal(contexto[key]);
      if (b != null) return b;
    }
  }
  return fallback;
}

function tipoPeriodoFromCtx(contexto) {
  const raw =
    contexto?.tipoPeriodo ||
    contexto?.PERIODO?.tipoPeriodo ||
    contexto?.periodo?.tipoPeriodo ||
    '';
  return String(raw || '').toLowerCase();
}

/**
 * Tope exento ISR de vales de despensa.
 * Mensual → 1 UMA mensual; semanal → 7×UMA diaria; otro → 1 UMA × días del período.
 */
function topeExentoIsrDespensa({ uma = 0, contexto = {} } = {}) {
  const pagoMensual = pickBoolCtx(
    contexto,
    ['despensaPagoMensual', 'pagaDespensaMensual', 'PERIODO.despensaPagoMensual'],
    false
  );
  const tipo = tipoPeriodoFromCtx(contexto);
  const umaMensual =
    pickCtx(contexto, ['PARAMETROS.umaMensual', 'umaMensual'], 0) ||
    (Number(uma) || 0) * 30.4;

  if (pagoMensual || tipo === 'mensual') {
    return Number(umaMensual) || 0;
  }
  if (tipo === 'semanal') {
    return (Number(uma) || 0) * 7;
  }
  const dias = diasPeriodoFromCtx(contexto);
  return (Number(uma) || 0) * (dias > 0 ? dias : 1);
}

function diasPeriodoFromCtx(contexto) {
  return (
    pickCtx(contexto, ['PERIODO.diasPeriodo', 'periodo.diasPeriodo', 'diasPeriodo'], 0) ||
    pickCtx(contexto, ['PERIODO.diasPagados', 'diasPagados'], 0) ||
    1
  );
}

function sbcDiarioFromCtx(contexto) {
  return pickCtx(contexto, ['EMPLEADO.sbc', 'EMPLEADO.sdi', 'empleado.sbc', 'empleado.sdi', 'sbc', 'sdi'], 0);
}

/**
 * Reglas LSS Art. 27 (simplificadas) para parte que no integra SBC.
 */
function aplicarReglaLeyImss(codigoRegla, importe, { uma = 0, contexto = {}, desglose = {} } = {}) {
  const regla = String(codigoRegla || '').toLowerCase();
  const monto = Number(importe) || 0;
  const dias = diasPeriodoFromCtx(contexto);
  const sbc = sbcDiarioFromCtx(contexto);

  // Despensa / alimentación en especie vía vales: hasta 40% UMA.
  // Si el pago es mensual (una corrida al mes), el tope es 40% × UMA mensual;
  // si no, se prorratea 40% × UMA × días del período.
  if (regla === 'despensa_40_uma' || regla === 'despensa') {
    const veces = Number(desglose.topeNoIntegraUMA) > 0 ? Number(desglose.topeNoIntegraUMA) : 0.4;
    let tope;
    if (Number(desglose.topeNoIntegraMonto) > 0) {
      tope = Number(desglose.topeNoIntegraMonto);
    } else {
      const pagoMensual = pickBoolCtx(
        contexto,
        ['despensaPagoMensual', 'pagaDespensaMensual', 'PERIODO.despensaPagoMensual'],
        false
      );
      const tipo = tipoPeriodoFromCtx(contexto);
      const umaMensual =
        pickCtx(contexto, ['PARAMETROS.umaMensual', 'umaMensual'], 0) ||
        (Number(uma) || 0) * 30.4;
      if (pagoMensual || tipo === 'mensual') {
        tope = (Number(umaMensual) || 0) * veces;
      } else if (tipo === 'semanal') {
        tope = (Number(uma) || 0) * veces * 7;
      } else {
        const dias = diasPeriodoFromCtx(contexto);
        tope = (Number(uma) || 0) * veces * (dias > 0 ? dias : 1);
      }
    }
    const noIntegra = Math.min(monto, Math.max(0, tope));
    return { integraSBC: redondear(monto - noIntegra), noIntegra: redondear(noIntegra), regla };
  }

  // Premios asistencia / puntualidad: hasta 10% del SBC del período no integra.
  if (regla === 'premio_10_sbc' || regla === 'premio_asistencia' || regla === 'premio_puntualidad') {
    const pct = Number(desglose.topeNoIntegraPctSbc) > 0 ? Number(desglose.topeNoIntegraPctSbc) : 10;
    const tope = (pct / 100) * sbc * dias;
    const noIntegra = Math.min(monto, Math.max(0, tope));
    return { integraSBC: redondear(monto - noIntegra), noIntegra: redondear(noIntegra), regla };
  }

  // Alimentación gratuita: +8.33% SBC por alimento/día (desayuno/comida/cena) si no paga ≥20% UMA.
  // Aquí el "importe" se interpreta como tope informativo; el incremento se calcula por # alimentos.
  if (regla === 'alimentacion_833') {
    const alimentos = pickCtx(contexto, ['alimentosPorDia', 'INCIDENCIAS.alimentosPorDia'], 0);
    const n = Math.min(3, Math.max(0, Math.floor(alimentos)));
    const incremento = redondear(sbc * 0.0833 * n);
    return { integraSBC: incremento, noIntegra: 0, regla, meta: { alimentosPorDia: n } };
  }

  // Habitación gratuita: +25% SBC si no cobra ≥20% UMA.
  if (regla === 'habitacion_25') {
    const incremento = redondear(sbc * 0.25);
    return { integraSBC: incremento, noIntegra: 0, regla };
  }

  // Horas extra dobles legales: no integran; triples se configuran aparte como todo_integra.
  if (regla === 'horas_extra_dobles' || regla === 'horas_extra') {
    return { integraSBC: 0, noIntegra: redondear(monto), regla };
  }

  // Desconocida → todo integra (conservador para cotización)
  return { integraSBC: redondear(monto), noIntegra: 0, regla: regla || 'desconocida' };
}

/**
 * Clasificación IMSS independiente del desglose ISR.
 * Usa fiscal.imss.desglose (parte integra SBC / parte no integra).
 */
function clasificarImss(importe, fiscalCfg = {}, { uma = 0, contexto = {}, scope = null } = {}) {
  const monto = redondear(Math.max(0, Number(importe) || 0));
  const imssCfg = fiscalCfg?.imss || defaultImssConfig({ integraIMSS: fiscalCfg?.integraIMSS !== false });
  const desglose = imssCfg.desglose || emptyImssDesglose();
  let modo = desglose.modo || 'todo_integra';

  if (fiscalCfg?.integraIMSS === false || imssCfg.naturalezaSdi === 'excluido') {
    if (!desglose.modo || desglose.modo === 'todo_integra') modo = 'todo_excluye';
  }

  if (!Number.isFinite(monto) || monto === 0) {
    return {
      integraSBC: 0,
      noIntegra: 0,
      modo,
      naturalezaSdi: imssCfg.naturalezaSdi || 'variable'
    };
  }

  let integraSBC = 0;
  let noIntegra = 0;

  switch (modo) {
    case 'todo_excluye':
      noIntegra = monto;
      break;
    case 'tope_uma': {
      const dias = diasPeriodoFromCtx(contexto);
      const tope =
        (Number(uma) || 0) * (Number(desglose.topeNoIntegraUMA) || 0) * (dias > 0 ? dias : 1);
      noIntegra = Math.min(monto, Math.max(0, tope));
      integraSBC = monto - noIntegra;
      break;
    }
    case 'tope_monto': {
      const tope = Number(desglose.topeNoIntegraMonto) || 0;
      noIntegra = Math.min(monto, Math.max(0, tope));
      integraSBC = monto - noIntegra;
      break;
    }
    case 'tope_pct_sbc': {
      const pct = Number(desglose.topeNoIntegraPctSbc) || 0;
      const sbc = sbcDiarioFromCtx(contexto);
      const dias = diasPeriodoFromCtx(contexto);
      const tope = (pct / 100) * sbc * (dias > 0 ? dias : 1);
      noIntegra = Math.min(monto, Math.max(0, tope));
      integraSBC = monto - noIntegra;
      break;
    }
    case 'formula': {
      if (desglose.formulaNoIntegra && scope) {
        try {
          noIntegra = redondear(
            evaluateExpression(desglose.formulaNoIntegra, { ...contexto, importe: monto }, scope)
          );
        } catch {
          noIntegra = 0;
        }
      }
      if (desglose.formulaIntegra && scope) {
        try {
          integraSBC = redondear(
            evaluateExpression(
              desglose.formulaIntegra,
              { ...contexto, importe: monto, noIntegra },
              scope
            )
          );
        } catch {
          integraSBC = redondear(monto - noIntegra);
        }
      } else {
        integraSBC = redondear(monto - noIntegra);
      }
      break;
    }
    case 'regla_ley': {
      const r = aplicarReglaLeyImss(desglose.codigoRegla, monto, { uma, contexto, desglose });
      integraSBC = r.integraSBC;
      noIntegra = r.noIntegra;
      break;
    }
    case 'todo_integra':
    default:
      integraSBC = monto;
      break;
  }

  integraSBC = redondear(Math.max(0, integraSBC));
  noIntegra = redondear(Math.max(0, noIntegra));
  const suma = redondear(integraSBC + noIntegra);
  if (suma !== redondear(monto) && modo !== 'formula' && modo !== 'regla_ley') {
    integraSBC = redondear(monto - noIntegra);
  }

  return {
    integraSBC,
    noIntegra,
    modo,
    naturalezaSdi: imssCfg.naturalezaSdi || 'variable'
  };
}

/**
 * Acumula bases fiscales en el contexto a partir del detalle ya desglosado.
 * ISR usa gravado; IMSS usa imss.integraSBC (o g+e si aún no viene clasificado).
 * Ignora acumuladores / informativos (su importe no es percepción real).
 */
function esAcumuladorOInformativo(d) {
  const codigo = String(d?.conceptoCodigo || '');
  if (
    [
      'PERCEPCIONES_GRAVADAS',
      'PERCEPCIONES_EXENTAS',
      'DEDUCCIONES_TOTALES',
      'NETO_PAGAR',
      'BASE_ISR',
      'BASE_IMSS'
    ].includes(codigo)
  ) {
    return true;
  }
  const nat = d?.fiscal?.naturaleza || d?.naturaleza || '';
  return nat === 'informativo';
}

function acumularBasesFiscales(detalle = []) {
  let percepcionesGravadas = 0;
  let percepcionesExentas = 0;
  let baseIsr = 0;
  let baseImss = 0;

  for (const d of detalle) {
    if (d.requiereRevision || d.tipo === 'deduccion') continue;
    if (esAcumuladorOInformativo(d)) continue;
    if (d.tipo === 'otro_pago' && d.fiscal?.naturaleza === 'fiscal') continue;

    const g = Number(d.gravado) || 0;
    const e = Number(d.exento) || 0;
    percepcionesGravadas += g;
    percepcionesExentas += e;
    if (d.fiscal?.integraISR !== false) baseIsr += g;

    if (d.fiscal?.integraIMSS !== false || (d.imss && Number(d.imss.integraSBC) > 0)) {
      const integra =
        d.imss && d.imss.integraSBC != null ? Number(d.imss.integraSBC) || 0 : g + e;
      baseImss += integra;
    }
  }

  return {
    PERCEPCIONES_GRAVADAS: redondear(percepcionesGravadas),
    PERCEPCIONES_EXENTAS: redondear(percepcionesExentas),
    BASE_ISR: redondear(baseIsr),
    BASE_IMSS: redondear(baseImss)
  };
}

/**
 * Totales de recibo desde config de conceptos (tipo + no informativos).
 * Fuente de verdad para DEDUCCIONES_TOTALES / NETO_PAGAR / cabecera del recibo.
 */
function calcularTotalesDesdeConfig(detalle = [], informativos = new Set()) {
  let totalPercepciones = 0;
  let totalDeducciones = 0;

  for (const d of detalle) {
    if (d.requiereRevision || d.importe == null) continue;
    if (informativos.has(d.conceptoCodigo) || esAcumuladorOInformativo(d)) continue;
    const imp = Number(d.importe) || 0;
    if (d.tipo === 'percepcion' || d.tipo === 'otro_pago') totalPercepciones += imp;
    else if (d.tipo === 'deduccion') totalDeducciones += imp;
  }

  totalPercepciones = redondear(totalPercepciones);
  totalDeducciones = redondear(totalDeducciones);
  return {
    totalPercepciones,
    totalDeducciones,
    netoPagar: redondear(totalPercepciones - totalDeducciones)
  };
}

/**
 * Sobrescribe líneas acumuladoras para que coincidan con el desglose/config real.
 * Las fórmulas de esos conceptos quedan como fallback/documentación.
 */
function sincronizarAcumuladoresDesdeConfig(detalle, contexto, { bases, totales }) {
  const patchLine = (codigo, importe, formulaUsada, extra = {}) => {
    const line = detalle.find((d) => d.conceptoCodigo === codigo);
    if (!line) return;
    const val = redondear(Number(importe) || 0);
    line.importe = val;
    line.formulaUsada = formulaUsada;
    line.requiereRevision = false;
    line.errorCalculo = '';
    if (extra.gravado != null) line.gravado = extra.gravado;
    if (extra.exento != null) line.exento = extra.exento;
    if (extra.isr) line.isr = extra.isr;
    if (extra.variablesUsadas) line.variablesUsadas = extra.variablesUsadas;
    if (contexto) contexto[codigo] = val;
  };

  if (bases) {
    // Sustituye variables de la fórmula fallback (p.ej. SUELDO+HE a importe completo)
    // por la base fiscal real (suma de campos gravado / exento).
    patchLine('PERCEPCIONES_GRAVADAS', bases.PERCEPCIONES_GRAVADAS, 'motor:sumaGravado(config.fiscal)', {
      gravado: bases.PERCEPCIONES_GRAVADAS,
      exento: 0,
      isr: { gravado: bases.PERCEPCIONES_GRAVADAS, exento: 0 },
      variablesUsadas: {
        PERCEPCIONES_GRAVADAS: bases.PERCEPCIONES_GRAVADAS,
        PERCEPCIONES_EXENTAS: bases.PERCEPCIONES_EXENTAS,
        BASE_ISR: bases.BASE_ISR
      }
    });
  }

  if (totales) {
    patchLine('DEDUCCIONES_TOTALES', totales.totalDeducciones, 'motor:sumaDeducciones(config.tipo)', {
      gravado: 0,
      exento: totales.totalDeducciones,
      isr: { gravado: 0, exento: totales.totalDeducciones }
    });
    patchLine('NETO_PAGAR', totales.netoPagar, 'motor:percepciones-deducciones(config)', {
      gravado: 0,
      exento: totales.netoPagar,
      isr: { gravado: 0, exento: totales.netoPagar }
    });
  }
}

module.exports = {
  resolveFiscalConfig,
  desglosarImporte,
  aplicarReglaLey,
  aplicarReglaLeyImss,
  clasificarImss,
  acumularBasesFiscales,
  calcularTotalesDesdeConfig,
  sincronizarAcumuladoresDesdeConfig,
  esAcumuladorOInformativo,
  topeExentoIsrDespensa
};
