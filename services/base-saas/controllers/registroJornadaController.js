'use strict';

const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant, scopeEmpleadosFromReq, sessionSubsidiariaId } = require('../libs/tenantScope');
const { parseOptionalObjectId } = require('../libs/formHelpers');
const { resolverRangoAsistencia } = require('../libs/rangoAsistencia');
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

function fmtMin(m) {
  const n = Number(m) || 0;
  const h = Math.floor(n / 60);
  const min = n % 60;
  return `${h}h ${String(min).padStart(2, '0')}m`;
}

async function showRegistroJornada(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const rango = await resolverRangoAsistencia(req, empresa);
  const desdeStr = rango.fechaDesde;
  const hastaStr = rango.fechaHasta;
  const empleadoId = parseOptionalObjectId(req.query.empleadoId);

  const fechaInicio = rango.desdeUtc;
  const fechaFin = rango.hastaUtc;

  const Empleado = await getEmpleadoModel();
  const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: true }) || {
    tenantId: req.session.tenantId,
    estatus: 'activo'
  };
  const empleados = empresa
    ? await Empleado.find(empQ).sort({ lastName: 1 }).lean()
    : [];

  let result = { filas: [], semanas: [], empleados: [], fechaInicio, fechaFin };
  if (empresa && !error) {
    result = await buildRegistroJornada(req.session.tenantId, {
      fechaInicio,
      fechaFin,
      empleadoId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req)
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
