'use strict';

/**
 * API REST v1 para app de asistencia (Flutter: Android / iOS / desktop).
 * Auth: JWT Bearer. Marcaciones → AttendanceRecord (metodo: movil) + recalculo diario.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { getUserModel } = require('../models/user');
const getRoleModel = require('../models/role');
const getTenantModel = require('../models/tenant');
const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const { signMobileToken, requireMobileAuth } = require('../middleware/mobileAuth');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');
const {
  snapshotMarcacion,
  registrarAuditoriaAsistencia
} = require('../services/asistenciaAuditoriaService');
const { TIPOS_MARCACION, ESTATUS_DIARIO } = require('../config/asistencia');
const { validatePunchLocation } = require('../services/geofence/geofenceService');

const router = express.Router();

const TIPOS_OK = new Set(TIPOS_MARCACION.map((t) => t.value));

function jsonError(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}

function parseNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sugiere el siguiente tipo de marcación según las del día (activas).
 */
function sugerirTipoMarcacion(tiposHoy = []) {
  const set = new Set(tiposHoy);
  if (!set.has('entrada')) return 'entrada';
  if (set.has('salida')) return null;
  if (set.has('entrada') && !set.has('salida_comida') && !set.has('regreso_comida')) {
    return 'salida_comida';
  }
  if (set.has('salida_comida') && !set.has('regreso_comida')) return 'regreso_comida';
  if (set.has('regreso_comida') || set.has('entrada')) return 'salida';
  return 'entrada';
}

router.get('/health', (_req, res) => {
  res.json({ ok: true, api: 'arka-sense-asistencia-v1' });
});

/**
 * POST /api/v1/auth/login
 * body: { account|tenantSlug, email, password }
 */
router.post('/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const account = String(req.body.account || req.body.tenantSlug || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    if (!email || !password) {
      return jsonError(res, 400, 'Email y contraseña son obligatorios');
    }
    if (!account && !req.tenant) {
      return jsonError(res, 400, 'Indica la cuenta (account / tenantSlug)');
    }

    const Tenant = await getTenantModel();
    let tenant = req.tenant;
    if (account) {
      tenant = await Tenant.findOne({ slug: account }).lean();
    }
    if (!tenant) {
      return jsonError(res, 404, 'Cuenta (tenant) no encontrada');
    }

    const User = await getUserModel();
    const user = await User.findOne({ email, activo: true });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return jsonError(res, 401, 'Credenciales inválidas');
    }
    if (user.tenantId && user.tenantId !== tenant.tenantId) {
      return jsonError(res, 403, 'El usuario no pertenece a esta cuenta');
    }
    if (!user.empleadoId) {
      return jsonError(
        res,
        403,
        'Esta cuenta no está vinculada a un empleado. Contacta a RRHH.'
      );
    }

    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: user.empleadoId,
      tenantId: tenant.tenantId,
      estatus: 'activo'
    }).lean();
    if (!empleado) {
      return jsonError(res, 403, 'Empleado no encontrado o inactivo');
    }

    const Role = await getRoleModel();
    const roles = await Role.find({ _id: { $in: user.roles || [] } })
      .select('nombre')
      .lean();

    const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const token = signMobileToken({
      userId: String(user._id),
      tenantId: tenant.tenantId,
      tenantSlug: tenant.slug,
      empleadoId: String(empleado._id),
      email: user.email,
      name
    });

    return res.json({
      ok: true,
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name,
        roles: roles.map((r) => r.nombre)
      },
      empleado: {
        id: String(empleado._id),
        numEmpleado: empleado.numEmpleado || '',
        nombre: [empleado.firstName, empleado.lastName].filter(Boolean).join(' ').trim(),
        subsidiariaId: empleado.subsidiariaId ? String(empleado.subsidiariaId) : null
      },
      tenant: {
        id: tenant.tenantId,
        slug: tenant.slug,
        displayName: tenant.displayName || tenant.slug
      }
    });
  } catch (err) {
    console.error('[api/v1/auth/login]', err);
    return jsonError(res, 500, 'Error al iniciar sesión');
  }
});

router.get('/me', requireMobileAuth, async (req, res) => {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: req.mobileAuth.empleadoId,
      tenantId: req.mobileAuth.tenantId
    }).lean();
    return res.json({
      ok: true,
      auth: req.mobileAuth,
      empleado: empleado
        ? {
            id: String(empleado._id),
            numEmpleado: empleado.numEmpleado || '',
            nombre: [empleado.firstName, empleado.lastName].filter(Boolean).join(' ').trim()
          }
        : null
    });
  } catch (err) {
    console.error('[api/v1/me]', err);
    return jsonError(res, 500, 'Error al cargar perfil');
  }
});

/**
 * GET /api/v1/asistencia/hoy
 */
router.get('/asistencia/hoy', requireMobileAuth, async (req, res) => {
  try {
    const ahora = new Date();
    const fecha = startOfDay(ahora);
    const AttendanceRecord = await getAttendanceRecordModel();
    const marcaciones = await AttendanceRecord.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      fecha: { $gte: fecha, $lte: endOfDay(fecha) },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .sort({ timestamp: 1 })
      .lean();

    const tiposHoy = marcaciones.map((m) => m.tipoMarcacion);
    const sugerido = sugerirTipoMarcacion(tiposHoy);

    return res.json({
      ok: true,
      fecha: fecha.toISOString().slice(0, 10),
      ahora: ahora.toISOString(),
      sugerido,
      jornadaCompleta: sugerido == null,
      tiposMarcacion: TIPOS_MARCACION,
      marcaciones: marcaciones.map((m) => ({
        id: String(m._id),
        tipoMarcacion: m.tipoMarcacion,
        timestamp: m.timestamp,
        metodo: m.metodo,
        ubicacion: m.ubicacion || null
      }))
    });
  } catch (err) {
    console.error('[api/v1/asistencia/hoy]', err);
    return jsonError(res, 500, 'Error al consultar asistencia del día');
  }
});

/**
 * POST /api/v1/asistencia/marcar
 * body: {
 *   tipoMarcacion?, lat, lng, accuracyMeters?, isMocked?,
 *   justificacionFueraZona?, notas?, plataforma?, modelo?, appVersion?,
 *   biometriaOk?, biometriaScore?, biometriaChallengeId?
 * }
 */
router.post('/asistencia/marcar', requireMobileAuth, async (req, res) => {
  try {
    const ahora = new Date();
    const fecha = startOfDay(ahora);
    const AttendanceRecord = await getAttendanceRecordModel();

    const existentes = await AttendanceRecord.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      fecha: { $gte: fecha, $lte: endOfDay(fecha) },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .select('tipoMarcacion')
      .lean();

    const tiposHoy = existentes.map((m) => m.tipoMarcacion);
    let tipoMarcacion = String(req.body.tipoMarcacion || '').trim();
    if (!tipoMarcacion) {
      tipoMarcacion = sugerirTipoMarcacion(tiposHoy) || '';
    }
    if (!TIPOS_OK.has(tipoMarcacion)) {
      return jsonError(res, 400, 'tipoMarcacion inválido');
    }
    if (tiposHoy.includes(tipoMarcacion)) {
      return jsonError(res, 409, `Ya registraste «${tipoMarcacion}» hoy`);
    }
    if (tiposHoy.includes('salida')) {
      return jsonError(res, 409, 'La jornada de hoy ya está cerrada (salida registrada)');
    }

    const lat = parseNum(req.body.lat);
    const lng = parseNum(req.body.lng);
    if (lat == null || lng == null) {
      return jsonError(res, 400, 'Ubicación GPS requerida (lat, lng)');
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return jsonError(res, 400, 'Coordenadas GPS fuera de rango');
    }

    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: req.mobileAuth.empleadoId,
      tenantId: req.mobileAuth.tenantId,
      estatus: 'activo'
    }).lean();
    if (!empleado) {
      return jsonError(res, 403, 'Empleado no encontrado o inactivo');
    }

    const accuracyMeters = parseNum(req.body.accuracyMeters);
    const isMocked =
      req.body.isMocked === true ||
      req.body.isMocked === 'true' ||
      req.body.isMocked === 1 ||
      req.body.isMocked === '1';

    const geo = await validatePunchLocation({
      tenantId: req.mobileAuth.tenantId,
      empleado,
      lat,
      lng,
      accuracyMeters,
      isMocked,
      at: ahora,
      justificacionFueraZona: String(req.body.justificacionFueraZona || '')
    });

    if (!geo.allowed) {
      return res.status(403).json({
        ok: false,
        error: geo.reason || 'Fuera de la geocerca autorizada',
        geocerca: {
          fueraDeZona: true,
          politica: geo.politica,
          distanceMeters: geo.distanceMeters ?? null,
          siteNombre: geo.match?.nombre || null
        }
      });
    }

    const match = geo.match;
    const puntoId =
      match && match.source === 'punto_acceso' && match.id && !String(match.id).startsWith('sub:')
        ? match.id
        : null;

    const created = await AttendanceRecord.create({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: empleado._id,
      turnoId: empleado.turnoId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fecha,
      timestamp: ahora,
      timestampOriginal: ahora,
      tipoMarcacion,
      metodo: 'movil',
      registradoPorUserId: req.mobileAuth.userId,
      notas: String(req.body.notas || '').trim().slice(0, 500),
      procesado: false,
      origen: 'original',
      estado: 'activa',
      ubicacion: {
        lat,
        lng,
        accuracyMeters: accuracyMeters != null ? accuracyMeters : null,
        capturedAt: ahora,
        isMocked: Boolean(isMocked)
      },
      geocerca: {
        politica: geo.politica || '',
        skipped: Boolean(geo.skipped),
        fueraDeZona: Boolean(geo.fueraDeZona),
        allowed: true,
        puntoAccesoId: puntoId,
        siteSource: match?.source || '',
        siteNombre: match?.nombre || '',
        distanceMeters: geo.distanceMeters != null ? geo.distanceMeters : null,
        radioMetros: match?.radioMetros != null ? match.radioMetros : null,
        justificacionFueraZona: geo.justificacionFueraZona || ''
      },
      dispositivo: {
        plataforma: String(req.body.plataforma || '').trim().slice(0, 40),
        modelo: String(req.body.modelo || '').trim().slice(0, 80),
        appVersion: String(req.body.appVersion || '').trim().slice(0, 40)
      }
    });

    await registrarAuditoriaAsistencia({
      tenantId: req.mobileAuth.tenantId,
      accion: 'MARCACION_CREAR',
      entidadId: created._id,
      empleadoId: empleado._id,
      fechaJornada: fecha,
      userId: req.mobileAuth.userId,
      userLabel: req.mobileAuth.name || req.mobileAuth.email,
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
      mensaje: `Marcación móvil ${tipoMarcacion}${
        geo.fueraDeZona ? ' (fuera de zona)' : geo.skipped ? '' : ` @ ${match?.nombre || ''}`
      }`,
      despues: snapshotMarcacion(created.toObject ? created.toObject() : created)
    });

    const daily = await recalculateDailyAttendance(
      req.mobileAuth.tenantId,
      empleado._id,
      fecha
    );

    return res.status(201).json({
      ok: true,
      marcacion: {
        id: String(created._id),
        tipoMarcacion: created.tipoMarcacion,
        timestamp: created.timestamp,
        metodo: created.metodo,
        ubicacion: created.ubicacion,
        geocerca: created.geocerca
      },
      geocerca: {
        fueraDeZona: Boolean(geo.fueraDeZona),
        skipped: Boolean(geo.skipped),
        siteNombre: match?.nombre || null,
        distanceMeters: geo.distanceMeters ?? null,
        politica: geo.politica
      },
      asistenciaDia: daily
        ? {
            estatus: daily.estatus,
            estatusLabel: ESTATUS_DIARIO[daily.estatus] || daily.estatus
          }
        : null,
      siguienteSugerido: sugerirTipoMarcacion([...tiposHoy, tipoMarcacion])
    });
  } catch (err) {
    console.error('[api/v1/asistencia/marcar]', err);
    return jsonError(res, 500, 'Error al registrar marcación');
  }
});

/**
 * GET /api/v1/asistencia/historial?dias=14
 */
router.get('/asistencia/historial', requireMobileAuth, async (req, res) => {
  try {
    const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 14));
    const hasta = endOfDay(new Date());
    const desde = startOfDay(new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000));
    const AttendanceRecord = await getAttendanceRecordModel();
    const rows = await AttendanceRecord.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      fecha: { $gte: desde, $lte: hasta },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    return res.json({
      ok: true,
      desde: desde.toISOString().slice(0, 10),
      hasta: hasta.toISOString().slice(0, 10),
      marcaciones: rows.map((m) => ({
        id: String(m._id),
        fecha: m.fecha,
        tipoMarcacion: m.tipoMarcacion,
        timestamp: m.timestamp,
        metodo: m.metodo,
        ubicacion: m.ubicacion || null
      }))
    });
  } catch (err) {
    console.error('[api/v1/asistencia/historial]', err);
    return jsonError(res, 500, 'Error al cargar historial');
  }
});

module.exports = router;
