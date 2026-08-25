'use strict';

/**
 * Builder del nodo SAT nomina12:SeparacionIndemnizacion
 * Obligatorio cuando hay percepciones TipoPercepcion 022, 023 o 025.
 *
 * Atributos:
 * - TotalPagado
 * - NumAñosServicio (0–99; fracción > 6 meses = año completo)
 * - UltimoSueldoMensOrd
 * - IngresoAcumulable
 * - IngresoNoAcumulable
 */

const CLAVES_SEPARACION_SAT = new Set(['022', '023', '025']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function claveSatNorm(c) {
  const raw = String(c?.claveSAT || c?.sat?.clave || c?.TipoPercepcion || '').trim();
  return raw.padStart(3, '0').slice(-3);
}

function esConceptoSeparacionSat(c) {
  if (c?.aplicaExencion90Uma) return true;
  const clave = claveSatNorm(c);
  if (CLAVES_SEPARACION_SAT.has(clave)) return true;
  const codigo = String(c?.codigo || c?.conceptoCodigo || '').toUpperCase();
  return (
    codigo === 'FIN_PRIMA_ANTIGUEDAD' ||
    codigo === 'FIN_INDEMNIZACION_3_MESES' ||
    codigo === 'FIN_INDEMNIZACION_20_DIAS' ||
    codigo === 'FIN_SALARIOS_VENCIDOS' ||
    codigo === 'FIN_GRATIFICACION_SEPARACION' ||
    codigo === 'FIN_CONVENIO'
  );
}

/**
 * Años de servicio para el atributo SAT NumAñosServicio:
 * fracción mayor a 6 meses cuenta como año completo.
 */
function numAniosServicioSat(antiguedad = {}, aniosLisrFallback = null) {
  if (aniosLisrFallback != null && Number.isFinite(Number(aniosLisrFallback))) {
    return Math.min(99, Math.max(0, Math.round(Number(aniosLisrFallback))));
  }
  const anios = Math.max(0, Number(antiguedad.aniosCompletos) || 0);
  const meses = Math.max(0, Number(antiguedad.meses) || 0);
  const dias = Math.max(0, Number(antiguedad.dias) || 0);
  const fraccionAnio = meses > 6 || (meses === 6 && dias > 0) ? 1 : 0;
  return Math.min(99, anios + fraccionAnio);
}

/**
 * Art. 95 (desglose CFDI):
 * gravado separación = TotalPagado − exento (bolsa 90×UMA)
 * IngresoAcumulable = min(gravado, UltimoSueldoMensOrd)
 * IngresoNoAcumulable = max(0, gravado − IngresoAcumulable)
 */
function calcularIngresosAcumulables({ totalPagado, totalExento, ultimoSueldoMensOrd }) {
  const pagado = money(totalPagado);
  const exento = money(Math.min(pagado, Number(totalExento) || 0));
  const gravado = money(Math.max(0, pagado - exento));
  const ultimo = money(ultimoSueldoMensOrd);
  const ingresoAcumulable = money(Math.min(gravado, ultimo > 0 ? ultimo : gravado));
  const ingresoNoAcumulable = money(Math.max(0, gravado - ingresoAcumulable));
  return {
    totalExentoSeparacion: exento,
    gravadoSeparacion: gravado,
    IngresoAcumulable: ingresoAcumulable,
    IngresoNoAcumulable: ingresoNoAcumulable
  };
}

/**
 * Construye el objeto de datos para el nodo (y TotalSeparacionIndemnizacion).
 */
function buildSeparacionIndemnizacionData({
  conceptos = [],
  antiguedad = {},
  salarioDiario = 0,
  fiscalSeparacion = {},
  override = null
} = {}) {
  if (override && Number(override.TotalPagado) > 0) {
    return {
      aplica: true,
      TotalPagado: money(override.TotalPagado),
      NumAniosServicio: Math.min(99, Math.max(0, Number(override.NumAniosServicio) || 0)),
      UltimoSueldoMensOrd: money(override.UltimoSueldoMensOrd),
      IngresoAcumulable: money(override.IngresoAcumulable),
      IngresoNoAcumulable: money(override.IngresoNoAcumulable),
      TotalSeparacionIndemnizacion: money(
        override.TotalSeparacionIndemnizacion != null
          ? override.TotalSeparacionIndemnizacion
          : override.TotalPagado
      ),
      conceptos: override.conceptos || [],
      fuente: override.fuente || 'snapshot'
    };
  }

  const sep = (conceptos || []).filter(
    (c) => c && c.tipo !== 'deduccion' && c.aplica !== false && esConceptoSeparacionSat(c)
  );
  if (!sep.length) {
    return { aplica: false };
  }

  const totalPagado = money(
    sep.reduce((s, c) => s + (Number(c.importeFinal != null ? c.importeFinal : c.importe) || 0), 0)
  );
  if (!(totalPagado > 0)) return { aplica: false };

  const totalExento =
    fiscalSeparacion.exentoTotalSeparacion != null
      ? Number(fiscalSeparacion.exentoTotalSeparacion)
      : money(sep.reduce((s, c) => s + (Number(c.exentoISR != null ? c.exentoISR : c.exento) || 0), 0));

  const sd = Number(salarioDiario) || 0;
  const ultimoSueldoMensOrd = money(
    fiscalSeparacion.ultimoSueldoMensOrd != null ? fiscalSeparacion.ultimoSueldoMensOrd : sd * 30
  );

  const anios = numAniosServicioSat(
    antiguedad,
    fiscalSeparacion.aniosServicioLisr != null ? fiscalSeparacion.aniosServicioLisr : null
  );

  const ingresos = calcularIngresosAcumulables({
    totalPagado,
    totalExento,
    ultimoSueldoMensOrd
  });

  return {
    aplica: true,
    TotalPagado: totalPagado,
    NumAniosServicio: anios,
    UltimoSueldoMensOrd: ultimoSueldoMensOrd,
    IngresoAcumulable: ingresos.IngresoAcumulable,
    IngresoNoAcumulable: ingresos.IngresoNoAcumulable,
    TotalSeparacionIndemnizacion: totalPagado,
    totalExentoSeparacion: ingresos.totalExentoSeparacion,
    gravadoSeparacion: ingresos.gravadoSeparacion,
    conceptos: sep.map((c) => ({
      codigo: c.codigo || c.conceptoCodigo,
      claveSAT: claveSatNorm(c),
      importe: money(c.importeFinal != null ? c.importeFinal : c.importe),
      gravado: money(c.gravadoISR != null ? c.gravadoISR : c.gravado),
      exento: money(c.exentoISR != null ? c.exentoISR : c.exento)
    })),
    fuente: 'calculado'
  };
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Fragmento XML del nodo (atributo NumAñosServicio con ñ según XSD SAT). */
function buildSeparacionIndemnizacionXml(data) {
  if (!data?.aplica) return '';
  return (
    `<nomina12:SeparacionIndemnizacion` +
    ` TotalPagado="${money(data.TotalPagado).toFixed(2)}"` +
    ` NumAñosServicio="${Number(data.NumAniosServicio) || 0}"` +
    ` UltimoSueldoMensOrd="${money(data.UltimoSueldoMensOrd).toFixed(2)}"` +
    ` IngresoAcumulable="${money(data.IngresoAcumulable).toFixed(2)}"` +
    ` IngresoNoAcumulable="${money(data.IngresoNoAcumulable).toFixed(2)}"/>`
  );
}

function buildPercepcionesSeparacionXml(data) {
  if (!data?.aplica || !(data.conceptos || []).length) return '';
  return data.conceptos
    .map((c) => {
      const clave = escXml(c.claveSAT || '025');
      const gravado = money(c.gravado).toFixed(2);
      const exento = money(c.exento).toFixed(2);
      return (
        `<nomina12:Percepcion TipoPercepcion="${clave}" Clave="${escXml(c.codigo || clave)}"` +
        ` Concepto="${escXml(c.codigo || 'Separacion')}" ImporteGravado="${gravado}" ImporteExento="${exento}"/>`
      );
    })
    .join('\n      ');
}

function buildSeparacionIndemnizacionJson(data) {
  if (!data?.aplica) return null;
  return {
    TotalSeparacionIndemnizacion: money(data.TotalSeparacionIndemnizacion),
    SeparacionIndemnizacion: {
      TotalPagado: money(data.TotalPagado),
      NumAniosServicio: Number(data.NumAniosServicio) || 0,
      'NumAñosServicio': Number(data.NumAniosServicio) || 0,
      UltimoSueldoMensOrd: money(data.UltimoSueldoMensOrd),
      IngresoAcumulable: money(data.IngresoAcumulable),
      IngresoNoAcumulable: money(data.IngresoNoAcumulable)
    },
    PercepcionesSeparacion: (data.conceptos || []).map((c) => ({
      TipoPercepcion: c.claveSAT,
      Clave: c.codigo,
      ImporteGravado: money(c.gravado),
      ImporteExento: money(c.exento)
    }))
  };
}

module.exports = {
  CLAVES_SEPARACION_SAT,
  money,
  esConceptoSeparacionSat,
  numAniosServicioSat,
  calcularIngresosAcumulables,
  buildSeparacionIndemnizacionData,
  buildSeparacionIndemnizacionXml,
  buildPercepcionesSeparacionXml,
  buildSeparacionIndemnizacionJson
};
