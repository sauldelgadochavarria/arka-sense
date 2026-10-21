'use strict';

const getDiaInhabilModel = require('../models/diaInhabil');
const { startOfDay, ymdInTimeZone, DEFAULT_TZ } = require('../libs/timeHelpers');

/**
 * Carga set de YMD inhábiles aplicables a tenant/empresa/subsidiaria.
 */
async function loadInhabilesYmd({
  tenantId,
  empresaId = null,
  subsidiariaId = null,
  desde,
  hasta,
  timeZone = DEFAULT_TZ
}) {
  const DiaInhabil = await getDiaInhabilModel();
  const q = {
    tenantId,
    activo: { $ne: false },
    fecha: { $gte: startOfDay(desde), $lte: startOfDay(hasta) },
    $or: [
      { subsidiariaId: null, empresaId: null },
      ...(empresaId ? [{ empresaId, subsidiariaId: null }] : []),
      ...(subsidiariaId ? [{ subsidiariaId }] : [])
    ]
  };
  const rows = await DiaInhabil.find(q).select('fecha').lean();
  const set = new Set();
  for (const r of rows) {
    set.add(ymdInTimeZone(r.fecha, timeZone));
  }
  return set;
}

function isWeekend(date, timeZone = DEFAULT_TZ) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return wd === 'Sat' || wd === 'Sun';
}

/**
 * Cuenta días descontables de vacaciones en [inicio, fin].
 * Por defecto excluye sábados/domingos e inhábiles del calendario.
 * @returns {{ dias: number, detalle: string[] }}
 */
async function contarDiasVacaciones({
  tenantId,
  empresaId = null,
  subsidiariaId = null,
  fechaInicio,
  fechaFin,
  timeZone = DEFAULT_TZ,
  excluirFinesDeSemana = true,
  turno = null
}) {
  const start = startOfDay(fechaInicio);
  const end = startOfDay(fechaFin);
  if (end < start) return { dias: 0, detalle: [] };

  const inhabiles = await loadInhabilesYmd({
    tenantId,
    empresaId,
    subsidiariaId,
    desde: start,
    hasta: end,
    timeZone
  });

  const detalle = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const ymd = ymdInTimeZone(cursor, timeZone);
    let laborable = true;

    const dow = new Date(`${ymd}T12:00:00.000Z`).getUTCDay(); // 0=dom … 6=sáb
    if (turno && Array.isArray(turno.diasLaborables) && turno.diasLaborables.length) {
      laborable = turno.diasLaborables.includes(dow);
    } else if (excluirFinesDeSemana && isWeekend(cursor, timeZone)) {
      laborable = false;
    }

    if (inhabiles.has(ymd)) laborable = false;

    if (laborable) detalle.push(ymd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return { dias: detalle.length, detalle };
}

/**
 * ¿La fecha cae en vacaciones aprobadas?
 */
async function empleadoEnVacacionesAprobadas(tenantId, empleadoId, fecha) {
  const getVacacionSolicitudModel = require('../models/vacacionSolicitud');
  const getIncidenciaModel = require('../models/incidencia');
  const day = startOfDay(fecha);
  const VacacionSolicitud = await getVacacionSolicitudModel();
  const sol = await VacacionSolicitud.findOne({
    tenantId,
    empleadoId,
    status: 'APPROVED',
    fechaInicio: { $lte: day },
    fechaFin: { $gte: day }
  })
    .select('_id')
    .lean();
  if (sol) return true;

  const Incidencia = await getIncidenciaModel();
  const vac = await Incidencia.findOne({
    tenantId,
    empleadoId,
    codigo: 'VAC',
    estatus: 'aprobada',
    fechaInicio: { $lte: day },
    fechaFin: { $gte: day }
  })
    .select('_id')
    .lean();
  return Boolean(vac);
}

module.exports = {
  loadInhabilesYmd,
  contarDiasVacaciones,
  empleadoEnVacacionesAprobadas,
  isWeekend
};
