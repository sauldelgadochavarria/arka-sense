'use strict';

/**
 * Resuelve en qué paso del flujo de nómina está el tenant / un período concreto.
 * Pasos: 1 Asistencia → 2 Pre-nómina → 3 Incidencias → 4 Cálculo →
 *        5 Revisión → 6 Cierre → 7 Bancos → 8 CFDI
 */

const getPeriodoNominaModel = require('../models/periodoNomina');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const getIncidenciaModel = require('../models/incidencia');
const getTimbradoLoteModel = require('../models/timbradoLote');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

function formatRango(inicio, fin) {
  if (!inicio || !fin) return '';
  const opts = { day: '2-digit', month: 'short' };
  const a = new Date(inicio).toLocaleDateString('es-MX', opts);
  const b = new Date(fin).toLocaleDateString('es-MX', opts);
  return `${a} – ${b}`;
}

function labelPeriodoOption(p) {
  const num = p.numeroPeriodo != null ? `#${p.numeroPeriodo}` : '';
  const rango = formatRango(p.fechaInicio, p.fechaFin);
  return `${p.tipoPeriodo || ''} ${num} ${rango} (${p.estatus})`.replace(/\s+/g, ' ').trim();
}

function coversDate(p, when = new Date()) {
  if (!p?.fechaInicio || !p?.fechaFin) return false;
  const t = when.getTime();
  return new Date(p.fechaInicio).getTime() <= t && new Date(p.fechaFin).getTime() >= t;
}

const ESTATUS_ACTIVOS = ['abierto', 'calculando', 'calculado'];

/**
 * Períodos para el selector del flujo (activos primero, luego cerrados recientes).
 */
async function listPeriodosParaFlujo({ tenantId, empresaId, limit = 25 }) {
  if (!tenantId || !empresaId) return [];
  const PeriodoNomina = await getPeriodoNominaModel();
  const rows = await PeriodoNomina.find({ tenantId, empresaId })
    .sort({ fechaFin: -1, numeroPeriodo: -1 })
    .limit(Math.max(limit * 2, 40))
    .select(
      'tipoPeriodo numeroPeriodo fechaInicio fechaFin estatus flujoProceso layoutBancario omitirDispersionBancaria'
    )
    .lean();

  const rank = (p) => {
    const est = String(p.estatus || '').toLowerCase();
    if (ESTATUS_ACTIVOS.includes(est) && coversDate(p)) return 0;
    if (ESTATUS_ACTIVOS.includes(est)) return 1;
    return 2;
  };

  return rows
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return new Date(b.fechaFin) - new Date(a.fechaFin);
    })
    .slice(0, limit)
    .map((p) => ({
      id: String(p._id),
      label: labelPeriodoOption(p),
      estatus: p.estatus,
      numeroPeriodo: p.numeroPeriodo,
      rango: formatRango(p.fechaInicio, p.fechaFin),
      tipoPeriodo: p.tipoPeriodo,
      revisionCompletada: Boolean(p.flujoProceso?.revisionCompletada)
    }));
}

async function resolverPeriodo({ tenantId, empresaId, periodoId }) {
  const PeriodoNomina = await getPeriodoNominaModel();
  if (periodoId) {
    const byId = await PeriodoNomina.findOne({ _id: periodoId, tenantId, empresaId }).lean();
    if (byId) return byId;
  }

  const activos = await PeriodoNomina.find({
    tenantId,
    empresaId,
    estatus: { $in: ESTATUS_ACTIVOS }
  })
    .sort({ fechaFin: -1 })
    .lean();

  if (activos.length) {
    const hoy = activos.find((p) => coversDate(p));
    return hoy || activos[0];
  }

  // Sin período formal activo: no forzar un cerrado viejo (el flujo cae a pre-nómina / asistencia).
  return null;
}

/**
 * @returns {Promise<object>}
 */
async function getFlujoNominaActual({
  tenantId,
  empresaId,
  hasNomina = true,
  periodoId = null
} = {}) {
  const empty = {
    pasoActual: 1,
    pasosCompletados: [],
    periodo: null,
    periodos: [],
    acciones: [],
    label: 'Asistencia',
    detalle: 'Inicia el ciclo con marcaciones y asistencia del día',
    href: '/asistencia-diaria'
  };

  if (!tenantId || !empresaId) return empty;

  const PayrollPeriod = await getPayrollPeriodModel();
  const Incidencia = await getIncidenciaModel();

  const [periodo, prenominaAbierta, periodos] = await Promise.all([
    resolverPeriodo({ tenantId, empresaId, periodoId }),
    PayrollPeriod.findOne({
      tenantId,
      empresaId,
      estatus: { $in: ['abierto', 'borrador'] }
    })
      .sort({ fechaFin: -1 })
      .lean(),
    listPeriodosParaFlujo({ tenantId, empresaId })
  ]);

  // Incidencias pendientes que cruzan el período de nómina formal (no todo el histórico)
  let pendientes = 0;
  let pendientesFilterHref = '/incidencias/pendientes';
  if (periodo) {
    pendientes = await Incidencia.countDocuments({
      tenantId,
      estatus: 'pendiente',
      fechaInicio: { $lte: endOfDay(periodo.fechaFin) },
      fechaFin: { $gte: startOfDay(periodo.fechaInicio) }
    });
    pendientesFilterHref = `/incidencias/pendientes?periodoId=${periodo._id}`;
  } else {
    pendientes = await Incidencia.countDocuments({ tenantId, estatus: 'pendiente' });
  }

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
    3: pendientesFilterHref,
    4: periodo ? `/nomina/periodos/${periodo._id}` : '/nomina/periodos',
    5: '/nomina/reportes',
    6: periodo ? `/nomina/periodos/${periodo._id}` : '/nomina/periodos',
    7: '/nomina/dispersion-bancaria',
    8: '/nomina/timbrado'
  };

  function pack(paso, detalle, extra = {}) {
    const completados = [];
    for (let i = 1; i < paso; i += 1) completados.push(i);
    return {
      pasoActual: paso,
      pasosCompletados: completados,
      periodos,
      periodo: periodo
        ? {
            id: String(periodo._id),
            estatus: periodo.estatus,
            tipoPeriodo: periodo.tipoPeriodo,
            numeroPeriodo: periodo.numeroPeriodo,
            rango: formatRango(periodo.fechaInicio, periodo.fechaFin),
            revisionCompletada: Boolean(periodo.flujoProceso?.revisionCompletada),
            layoutBancarioEstatus: periodo.layoutBancario?.estatus || '',
            omitirDispersionBancaria: Boolean(periodo.omitirDispersionBancaria)
          }
        : null,
      label: LABEL[paso] || 'Asistencia',
      detalle,
      href: HREF[paso] || '/asistencia-diaria',
      acciones: extra.acciones || [],
      cicloCompleto: false,
      ...extra
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
  const pid = String(periodo._id);

  if (est === 'abierto' || est === 'calculando') {
    if (pendientes > 0) {
      return pack(
        3,
        `${pendientes} incidencia(s) del período por autorizar (vacaciones, faltas, HE…) antes del cálculo formal · nómina ${num} ${rango}`,
        {
          acciones: [
            { tipo: 'link', label: 'Ir a bandeja del período', href: pendientesFilterHref },
            { tipo: 'link', label: 'Ver período nómina', href: `/nomina/periodos/${pid}` }
          ]
        }
      );
    }
    return pack(
      4,
      est === 'calculando'
        ? `Calculando nómina ${num} ${rango}`
        : `Período de nómina abierto ${num} ${rango} · listo para calcular (pre-nómina ya puede estar cerrada)`,
      {
        acciones: [
          { tipo: 'link', label: 'Ir a calcular', href: `/nomina/periodos/${pid}` }
        ]
      }
    );
  }

  if (est === 'calculado') {
    const revisionOk = Boolean(periodo.flujoProceso?.revisionCompletada);
    if (!revisionOk) {
      return pack(5, `Período calculado ${num} ${rango} · revisa reportes y confirma la revisión`, {
        acciones: [
          { tipo: 'link', label: 'Ver reportes', href: '/nomina/reportes' },
          {
            tipo: 'post',
            label: 'Confirmar revisión',
            href: `/nomina/flujo/periodos/${pid}/confirmar-revision`,
            className: 'btn btn-primary'
          }
        ]
      });
    }
    return pack(6, `Revisión OK · período ${num} ${rango} · autoriza y cierra`, {
      acciones: [
        {
          tipo: 'post',
          label: 'Cerrar período',
          href: `/nomina/periodos/${pid}/cerrar`,
          className: 'btn btn-primary',
          confirm: '¿Cerrar el período? Ya no admitirá cambios de cálculo.'
        },
        { tipo: 'link', label: 'Ver período', href: `/nomina/periodos/${pid}` }
      ]
    });
  }

  // cerrado → dispersión → timbrado
  const omitirBanco = Boolean(periodo.omitirDispersionBancaria);
  const bancoOk =
    omitirBanco || String(periodo.layoutBancario?.estatus || '') === 'generado';

  if (!bancoOk) {
    return pack(7, `Período cerrado ${num} ${rango} · genera archivo bancario (o marca omisión)`, {
      acciones: [
        { tipo: 'link', label: 'Dispersión bancaria', href: '/nomina/dispersion-bancaria' },
        {
          tipo: 'post',
          label: 'Omitir dispersión (cheque/efectivo)',
          href: `/nomina/flujo/periodos/${pid}/omitir-dispersion`,
          className: 'btn',
          confirm: '¿Omitir dispersión bancaria para este período?'
        }
      ]
    });
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
    return pack(8, `Dispersión lista · emite CFDI del período ${num} ${rango}`, {
      acciones: [
        { tipo: 'link', label: 'Ir a timbrar', href: '/nomina/timbrado' }
      ]
    });
  }

  const done = pack(8, `Ciclo completo · período ${num} ${rango} (dispersión + CFDI)`);
  done.pasosCompletados = [1, 2, 3, 4, 5, 6, 7, 8];
  done.cicloCompleto = true;
  return done;
}

async function confirmarRevisionPeriodo({
  tenantId,
  empresaId,
  periodoId,
  userId = '',
  userLabel = ''
}) {
  const Periodo = await getPeriodoNominaModel();
  const periodo = await Periodo.findOne({ _id: periodoId, tenantId, empresaId });
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'calculado') {
    throw new Error('Solo se puede confirmar revisión en períodos calculados');
  }
  periodo.flujoProceso = periodo.flujoProceso || {};
  periodo.flujoProceso.revisionCompletada = true;
  periodo.flujoProceso.revisionAt = new Date();
  periodo.flujoProceso.revisionPorUserId = String(userId || '');
  periodo.flujoProceso.revisionPorLabel = String(userLabel || '');
  await periodo.save();
  return periodo.toObject();
}

async function omitirDispersionPeriodo({ tenantId, empresaId, periodoId }) {
  const Periodo = await getPeriodoNominaModel();
  const periodo = await Periodo.findOne({ _id: periodoId, tenantId, empresaId });
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'cerrado') {
    throw new Error('Omite dispersión solo en períodos ya cerrados');
  }
  periodo.omitirDispersionBancaria = true;
  await periodo.save();
  return periodo.toObject();
}

module.exports = {
  getFlujoNominaActual,
  listPeriodosParaFlujo,
  confirmarRevisionPeriodo,
  omitirDispersionPeriodo
};
