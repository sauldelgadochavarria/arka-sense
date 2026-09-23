'use strict';

const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay } = require('../libs/timeHelpers');
const { ESTATUS_DIARIO } = require('../config/asistencia');
const { buildRegistroJornada } = require('../services/registroJornadaService');
const {
  registrarAuditoriaAsistencia,
  listAuditoriaAsistencia
} = require('../services/asistenciaAuditoriaService');

function sessionActor(req) {
  const userId = req.session.userid || req.session.userId || '';
  const userLabel =
    req.session.user || req.session.email || req.session.username || '';
  return { userId, userLabel };
}

function defaultRange() {
  const fin = new Date();
  const ini = new Date(fin);
  ini.setDate(ini.getDate() - 6);
  return {
    desde: ini.toISOString().slice(0, 10),
    hasta: fin.toISOString().slice(0, 10)
  };
}

function fmtMin(m) {
  const n = Number(m) || 0;
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${h}h ${String(min).padStart(2, '0')}m`;
}

async function showRegistroJornada(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const defaults = defaultRange();
  const desdeStr = trimString(req.query.desde) || defaults.desde;
  const hastaStr = trimString(req.query.hasta) || defaults.hasta;
  const empleadoId = parseOptionalObjectId(req.query.empleadoId);

  const fechaInicio = startOfDay(parseDateTimeLocal(`${desdeStr}T12:00`) || new Date());
  const fechaFin = endOfDay(parseDateTimeLocal(`${hastaStr}T12:00`) || new Date());

  const Empleado = await getEmpleadoModel();
  const empleados = empresa
    ? await Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' })
        .sort({ lastName: 1 })
        .lean()
    : [];

  let result = { filas: [], semanas: [], empleados: [], fechaInicio, fechaFin };
  if (empresa && !error) {
    result = await buildRegistroJornada(req.session.tenantId, {
      fechaInicio,
      fechaFin,
      empleadoId
    });

    await registrarAuditoriaAsistencia({
      tenantId: req.session.tenantId,
      accion: 'JORNADA_CONSULTAR',
      entidad: 'jornada',
      empleadoId: empleadoId || null,
      fechaJornada: fechaInicio,
      ...sessionActor(req),
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
      mensaje: `Consulta registro de jornada ${desdeStr} → ${hastaStr}`,
      detalle: {
        desde: desdeStr,
        hasta: hastaStr,
        empleadoId: empleadoId ? String(empleadoId) : null,
        filas: result.filas.length
      }
    });
  }

  const bitacora = empresa
    ? await listAuditoriaAsistencia(req.session.tenantId, {
        empleadoId: empleadoId || undefined,
        fechaDesde: fechaInicio,
        fechaHasta: fechaFin,
        limit: 50
      })
    : [];

  res.render('Asistencia/registro-jornada', {
    empresa,
    error: error || null,
    empleados,
    filters: {
      desde: desdeStr,
      hasta: hastaStr,
      empleadoId: empleadoId ? String(empleadoId) : ''
    },
    filas: result.filas,
    semanas: result.semanas,
    resumenTopes: result.resumenTopes || { alertas46: 0, alertas12: 0, sinTurno: 0 },
    bitacora,
    estatusDiarioLabels: ESTATUS_DIARIO,
    fmtMin,
    session: req.session
  });
}

module.exports = { showRegistroJornada };
