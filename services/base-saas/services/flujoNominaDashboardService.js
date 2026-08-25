'use strict';

/**
 * Resuelve en qué paso del flujo de nómina está el tenant,
 * según período de nómina, pre-nómina, incidencias, dispersión y timbrado.
 */

const getPeriodoNominaModel = require('../models/periodoNomina');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getIncidenciaModel = require('../models/incidencia');
const getTimbradoLoteModel = require('../models/timbradoLote');

function formatRango(inicio, fin) {
  if (!inicio || !fin) return '';
  const opts = { day: '2-digit', month: 'short' };
  const a = new Date(inicio).toLocaleDateString('es-MX', opts);
  const b = new Date(fin).toLocaleDateString('es-MX', opts);
  return `${a} – ${b}`;
}

/**
 * @returns {Promise<{
 *   pasoActual: number,
 *   pasosCompletados: number[],
 *   periodo: object|null,
 *   label: string,
 *   detalle: string,
 *   href: string|null
 * }>}
 */
async function getFlujoNominaActual({ tenantId, empresaId, hasNomina = true }) {
  const empty = {
    pasoActual: 1,
    pasosCompletados: [],
    periodo: null,
    label: 'Asistencia',
    detalle: 'Inicia el ciclo con marcaciones y asistencia del día',
    href: '/asistencia-diaria'
  };

  if (!tenantId || !empresaId) return empty;

  const PeriodoNomina = await getPeriodoNominaModel();
  const PayrollPeriod = await getPayrollPeriodModel();
  const Incidencia = await getIncidenciaModel();

  const [periodoActivo, periodoReciente, prenominaAbierta, pendientes] = await Promise.all([
    PeriodoNomina.findOne({
      tenantId,
      empresaId,
      estatus: { $in: ['abierto', 'calculando', 'calculado'] }
    })
      .sort({ fechaFin: -1 })
      .lean(),
    PeriodoNomina.findOne({ tenantId, empresaId }).sort({ fechaFin: -1 }).lean(),
    PayrollPeriod.findOne({
      tenantId,
      empresaId,
      estatus: { $in: ['abierto', 'borrador'] }
    })
      .sort({ fechaFin: -1 })
      .lean(),
    Incidencia.countDocuments({ tenantId, estatus: 'pendiente' })
  ]);

  const periodo = periodoActivo || periodoReciente;
  const LABEL = {
    1: 'Asistencia',
    2: 'Pre-nómina',
    3: 'Incidencias',
    4: 'Cálculo',
    5: 'Revisión',
    6: 'Cierre',
    7: 'Bancos',
    8: 'CFDI'
  };
  const HREF = {
    1: '/asistencia-diaria',
    2: '/prenomina-periodos',
    3: '/incidencias/pendientes',
    4: periodo ? `/nomina/periodos/${periodo._id}` : '/nomina/periodos',
    5: '/nomina/reportes',
    6: periodo ? `/nomina/periodos/${periodo._id}` : '/nomina/periodos',
    7: '/nomina/dispersion-bancaria',
    8: '/nomina/timbrado'
  };

  function pack(paso, detalle) {
    const completados = [];
    for (let i = 1; i < paso; i += 1) completados.push(i);
    return {
      pasoActual: paso,
      pasosCompletados: completados,
      periodo: periodo
        ? {
            id: String(periodo._id),
            estatus: periodo.estatus,
            tipoPeriodo: periodo.tipoPeriodo,
            numeroPeriodo: periodo.numeroPeriodo,
            rango: formatRango(periodo.fechaInicio, periodo.fechaFin)
          }
        : null,
      label: LABEL[paso] || 'Asistencia',
      detalle,
      href: HREF[paso] || '/asistencia-diaria'
    };
  }

  if (!hasNomina || !periodo) {
    if (pendientes > 0) {
      return pack(3, `${pendientes} incidencia(s) pendiente(s) de aprobar`);
    }
    if (prenominaAbierta) {
      return pack(
        2,
        `Pre-nómina abierta · ${formatRango(prenominaAbierta.fechaInicio, prenominaAbierta.fechaFin)}`
      );
    }
    return pack(1, 'Sin período de nómina abierto · revisa asistencia del día');
  }

  const est = String(periodo.estatus || '').toLowerCase();
  const rango = formatRango(periodo.fechaInicio, periodo.fechaFin);
  const num = periodo.numeroPeriodo != null ? `#${periodo.numeroPeriodo}` : '';

  if (est === 'abierto' || est === 'calculando') {
    if (pendientes > 0) {
      return pack(
        3,
        `${pendientes} pendiente(s) · período ${num} ${rango} (${est === 'calculando' ? 'calculando' : 'abierto'})`
      );
    }
    return pack(
      4,
      est === 'calculando'
        ? `Calculando nómina ${num} ${rango}`
        : `Período abierto ${num} ${rango} · listo para calcular`
    );
  }

  if (est === 'calculado') {
    return pack(5, `Período calculado ${num} ${rango} · revisa reportes antes de cerrar`);
  }

  // cerrado → dispersión → timbrado
  const bancoOk = String(periodo.layoutBancario?.estatus || '') === 'generado';
  if (!bancoOk) {
    return pack(7, `Período cerrado ${num} ${rango} · genera archivo bancario`);
  }

  let timbradoOk = false;
  try {
    const TimbradoLote = await getTimbradoLoteModel();
    const lote = await TimbradoLote.findOne({
      tenantId,
      periodoId: periodo._id,
      estatus: { $in: ['completado', 'completado_parcial'] },
      'totales.timbrados': { $gt: 0 }
    })
      .sort({ createdAt: -1 })
      .lean();
    timbradoOk = Boolean(lote);
  } catch {
    timbradoOk = false;
  }

  if (!timbradoOk) {
    return pack(8, `Dispersión lista · emite CFDI del período ${num} ${rango}`);
  }

  // Ciclo completo del período más reciente: marcar CFDI como actual (completado visual en UI)
  const done = pack(8, `Ciclo completo · período ${num} ${rango} (dispersión + CFDI)`);
  done.pasosCompletados = [1, 2, 3, 4, 5, 6, 7, 8];
  done.cicloCompleto = true;
  return done;
}

module.exports = { getFlujoNominaActual };
