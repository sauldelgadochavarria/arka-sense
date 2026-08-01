'use strict';

const { redondear, evaluateExpression } = require('./formulaEvaluator');
const { defaultFiscalFromNaturaleza } = require('../../models/fiscalConceptoShared');

/**
 * Parte un importe bruto en gravado / exento según config.fiscal.desglose.
 * Las reglas de ley complejas viven aquí (código versionable), no en fórmulas libres.
 */
function resolveFiscalConfig(concepto = {}) {
  if (concepto.fiscal && typeof concepto.fiscal === 'object') {
    const base = defaultFiscalFromNaturaleza(concepto.fiscal.naturaleza || concepto.naturaleza);
    return {
      ...base,
      ...concepto.fiscal,
      desglose: { ...base.desglose, ...(concepto.fiscal.desglose || {}) }
    };
  }
  return defaultFiscalFromNaturaleza(concepto.naturaleza);
}

function aplicarReglaLey(codigoRegla, importe, { uma = 0 } = {}) {
  const regla = String(codigoRegla || '').toLowerCase();
  const monto = Number(importe) || 0;

  if (regla === 'horas_extra') {
    // Simplificación LISR: tope semanal de exención de HE ≈ 5 UMA (ajustable por tablas).
    const tope = (Number(uma) || 0) * 5;
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'aguinaldo') {
    const tope = (Number(uma) || 0) * 30;
    const exento = Math.min(monto, tope);
    return { gravado: redondear(monto - exento), exento: redondear(exento), regla };
  }

  if (regla === 'prima_dominical') {
    const tope = Number(uma) || 0; // 1 UMA por domingo (simplificado)
    const exento = Math.min(monto, tope);
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
      const r = aplicarReglaLey(desglose.codigoRegla, monto, { uma });
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

/**
 * Acumula bases fiscales en el contexto a partir del detalle ya desglosado.
 */
function acumularBasesFiscales(detalle = []) {
  let percepcionesGravadas = 0;
  let percepcionesExentas = 0;
  let baseIsr = 0;
  let baseImss = 0;

  for (const d of detalle) {
    if (d.requiereRevision || d.tipo === 'deduccion') continue;
    if (d.tipo === 'otro_pago' && d.fiscal?.naturaleza === 'fiscal') continue;

    const g = Number(d.gravado) || 0;
    const e = Number(d.exento) || 0;
    percepcionesGravadas += g;
    percepcionesExentas += e;
    if (d.fiscal?.integraISR !== false) baseIsr += g;
    if (d.fiscal?.integraIMSS !== false) baseImss += g + e; // SBC suele partir de percepción integrada; se afina después
  }

  return {
    PERCEPCIONES_GRAVADAS: redondear(percepcionesGravadas),
    PERCEPCIONES_EXENTAS: redondear(percepcionesExentas),
    BASE_ISR: redondear(baseIsr),
    BASE_IMSS: redondear(baseImss)
  };
}

module.exports = {
  resolveFiscalConfig,
  desglosarImporte,
  aplicarReglaLey,
  acumularBasesFiscales
};
