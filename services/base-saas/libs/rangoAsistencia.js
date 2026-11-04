'use strict';

const getPayrollPeriodModel = require('../models/payrollPeriod');
const { scopeEmpresaFilter, sessionSubsidiariaId } = require('./tenantScope');
const { ymdAncla, ymdInTimeZone } = require('./timeHelpers');
const { zonaDeSubsidiariaId } = require('../services/zonaHorariaService');

function ymdQuery(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function limiteDiaUtc(ymd, fin) {
  if (!ymdQuery(ymd)) return null;
  return new Date(`${ymd}T${fin ? '23:59:59.999' : '00:00:00.000'}Z`);
}

function etiquetaPeriodo(periodo) {
  if (!periodo) return '';
  const num = periodo.numeroPeriodo != null ? `#${periodo.numeroPeriodo}` : '';
  const tipo = periodo.tipo || 'período';
  const ini = ymdAncla(periodo.fechaInicio);
  const fin = ymdAncla(periodo.fechaFin);
  return [tipo, num, ini && fin ? `${ini} → ${fin}` : ''].filter(Boolean).join(' ');
}

async function periodoPrenominaActual(req, empresa, hoy) {
  if (!empresa) return null;
  const q = scopeEmpresaFilter(req, empresa);
  if (!q) return null;
  q.estatus = { $in: ['abierto', 'borrador'] };
  const PayrollPeriod = await getPayrollPeriodModel();
  const abiertos = await PayrollPeriod.find(q).sort({ fechaFin: -1 }).limit(24).lean();
  if (!abiertos.length) return null;
  const cubre = abiertos.find((p) => {
    const ini = ymdAncla(p.fechaInicio);
    const fin = ymdAncla(p.fechaFin);
    return ini && fin && ini <= hoy && fin >= hoy;
  });
  return cubre || abiertos[0];
}

/**
 * Rango compartido del flujo de asistencia.
 * Si la pantalla no trae fechas: período de pre-nómina abierto de la subsidiaria,
 * y si no hay, el día de hoy en ambos extremos.
 */
async function resolverRangoAsistencia(req, empresa) {
  const zona = await zonaDeSubsidiariaId(sessionSubsidiariaId(req));
  const hoy = ymdInTimeZone(new Date(), zona);
  const query = req.query || {};
  let fechaDesde = ymdQuery(query.fechaDesde || query.desde);
  let fechaHasta = ymdQuery(query.fechaHasta || query.hasta);
  const una = ymdQuery(query.fecha);
  let origen = 'consulta';
  let periodo = null;

  if (!fechaDesde && !fechaHasta && una) {
    fechaDesde = una;
    fechaHasta = una;
  }
  if (!fechaDesde && !fechaHasta) {
    periodo = await periodoPrenominaActual(req, empresa, hoy);
    if (periodo) {
      fechaDesde = ymdAncla(periodo.fechaInicio, zona);
      fechaHasta = ymdAncla(periodo.fechaFin, zona);
      origen = 'periodo';
    } else {
      fechaDesde = hoy;
      fechaHasta = hoy;
      origen = 'hoy';
    }
  } else {
    if (!fechaDesde) fechaDesde = fechaHasta;
    if (!fechaHasta) fechaHasta = fechaDesde;
  }
  if (fechaDesde > fechaHasta) {
    const swap = fechaDesde;
    fechaDesde = fechaHasta;
    fechaHasta = swap;
  }

  return {
    fechaDesde,
    fechaHasta,
    zona,
    hoy,
    origen,
    periodo,
    periodoLabel: etiquetaPeriodo(periodo),
    desdeUtc: limiteDiaUtc(fechaDesde, false),
    hastaUtc: limiteDiaUtc(fechaHasta, true),
    unDia: fechaDesde === fechaHasta
  };
}

function queryRango(rango, extra) {
  const q = new URLSearchParams();
  if (rango?.fechaDesde) q.set('fechaDesde', rango.fechaDesde);
  if (rango?.fechaHasta) q.set('fechaHasta', rango.fechaHasta);
  if (extra) {
    Object.entries(extra).forEach(([key, value]) => {
      if (value != null && value !== '') q.set(key, String(value));
    });
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

module.exports = {
  ymdQuery,
  limiteDiaUtc,
  resolverRangoAsistencia,
  queryRango
};
