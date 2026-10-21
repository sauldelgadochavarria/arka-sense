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
const {
  startOfDay,
  endOfDay,
  calendarDateInTimeZone,
  DEFAULT_TZ
} = require('../libs/timeHelpers');
const getSubsidiariaModel = require('../models/subsidiaria');
const { recalculateDailyAttendance } = require('../services/attendanceProcessingService');
const {
  snapshotMarcacion,
  registrarAuditoriaAsistencia
} = require('../services/asistenciaAuditoriaService');
const { TIPOS_MARCACION, ESTATUS_DIARIO } = require('../config/asistencia');
const { validatePunchLocation } = require('../services/geofence/geofenceService');
const { registrarIntento } = require('../services/attendanceAttemptService');
const {
  buildHorarioRecordatorios,
  programacionDelDia
} = require('../services/horarioRecordatorioService');
const { resolveTurnoVigente } = require('../services/turnoResolverService');
const {
  buildSeguridadMovilStatus,
  solicitarOtp,
  verificarOtp,
  assertDispositivoParaMarcacion,
  findDispositivoActivo
} = require('../services/dispositivoMovilService');
const { buildEmpleadoCapabilities } = require('../services/portalCapabilitiesService');
const {
  resolveEffectiveFeatureFlags,
  tenantHasFeature
} = require('../libs/tenantFeatureFlags');
const {
  obtenerSaldoDisponible,
  crearSolicitudVacaciones,
  cancelarSolicitud,
  resolverSolicitud,
  listSolicitudesEmpleado,
  listPendientesSupervisor
} = require('../services/vacacionesService');
const { contarDiasVacaciones } = require('../services/calendarioLaboralService');
const { registerPushToken } = require('../services/pushNotificationService');

async function resolveMobileFeatureFlags(tenantId, empleado) {
  const Tenant = await getTenantModel();
  const tenant = await Tenant.findOne({ tenantId }).select('featureFlags').lean();
  let subModulos = null;
  if (empleado?.subsidiariaId) {
    const Subsidiaria = await getSubsidiariaModel();
    const sub = await Subsidiaria.findById(empleado.subsidiariaId).select('modulos').lean();
    subModulos = sub?.modulos || null;
  }
  return resolveEffectiveFeatureFlags(tenant?.featureFlags || {}, subModulos);
}

const router = express.Router();

const TIPOS_OK = new Set(TIPOS_MARCACION.map((t) => t.value));

function jsonError(res, status, error, code) {
  const body = { ok: false, error };
  if (code) body.code = code;
  return res.status(status).json(body);
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
      return jsonError(res, 403, 'Empleado no encontrado o inactivo', 'EMPLEADO_BAJA');
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
      name,
      mtv: Number(user.mobileTokenVersion || 0)
    });

    const deviceUuid = String(req.body.deviceUuid || '').trim();
    const seguridadMovil = await buildSeguridadMovilStatus({
      tenantId: tenant.tenantId,
      empleado,
      deviceUuid
    });
    const featureFlags = await resolveMobileFeatureFlags(tenant.tenantId, empleado);
    const capabilities = await buildEmpleadoCapabilities({
      tenantId: tenant.tenantId,
      empleado,
      featureFlags
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
      },
      seguridadMovil,
      featureFlags,
      capabilities
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
    const deviceUuid = String(req.query.deviceUuid || req.headers['x-device-uuid'] || '').trim();
    const seguridadMovil = empleado
      ? await buildSeguridadMovilStatus({
          tenantId: req.mobileAuth.tenantId,
          empleado,
          deviceUuid
        })
      : null;
    const featureFlags = empleado
      ? await resolveMobileFeatureFlags(req.mobileAuth.tenantId, empleado)
      : {};
    const capabilities = empleado
      ? await buildEmpleadoCapabilities({
          tenantId: req.mobileAuth.tenantId,
          empleado,
          featureFlags
        })
      : null;
    return res.json({
      ok: true,
      auth: req.mobileAuth,
      empleado: empleado
        ? {
            id: String(empleado._id),
            numEmpleado: empleado.numEmpleado || '',
            nombre: [empleado.firstName, empleado.lastName].filter(Boolean).join(' ').trim()
          }
        : null,
      seguridadMovil,
      featureFlags,
      capabilities
    });
  } catch (err) {
    console.error('[api/v1/me]', err);
    return jsonError(res, 500, 'Error al cargar perfil');
  }
});

/**
 * POST /api/v1/auth/dispositivo/solicitar-otp
 * body: { deviceUuid, telefono?, plataforma?, modelo?, appVersion? }
 */
router.post('/auth/dispositivo/solicitar-otp', requireMobileAuth, async (req, res) => {
  try {
    const result = await solicitarOtp({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      deviceUuid: req.body.deviceUuid,
      telefono: req.body.telefono,
      plataforma: req.body.plataforma,
      modelo: req.body.modelo,
      appVersion: req.body.appVersion
    });
    return res.json(result);
  } catch (err) {
    console.error('[api/v1/auth/dispositivo/solicitar-otp]', err);
    return jsonError(res, err.status || 500, err.message || 'Error al enviar código', err.code);
  }
});

/**
 * POST /api/v1/auth/dispositivo/verificar-otp
 * body: { deviceUuid, codigo, plataforma?, modelo?, appVersion? }
 */
router.post('/auth/dispositivo/verificar-otp', requireMobileAuth, async (req, res) => {
  try {
    const result = await verificarOtp({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      deviceUuid: req.body.deviceUuid,
      codigo: req.body.codigo,
      plataforma: req.body.plataforma,
      modelo: req.body.modelo,
      appVersion: req.body.appVersion
    });
    return res.json(result);
  } catch (err) {
    console.error('[api/v1/auth/dispositivo/verificar-otp]', err);
    return jsonError(res, err.status || 500, err.message || 'Error al verificar código', err.code);
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
    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: req.mobileAuth.empleadoId,
      tenantId: req.mobileAuth.tenantId
    })
      .select('turnoId firstName lastName numEmpleado')
      .lean();

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

    let horarioHoy = null;
    if (empleado) {
      const resolved = await resolveTurnoVigente(req.mobileAuth.tenantId, empleado, fecha);
      const turno = resolved.turno;
      const esDescanso = Boolean(resolved.esDescansoForzado) || !turno;
      if (!esDescanso && turno) {
        const prog = programacionDelDia(fecha, turno);
        horarioHoy = {
          esDescanso: false,
          origen: resolved.origen,
          turno: {
            id: String(turno._id),
            nombre: turno.nombre,
            horaEntrada: turno.horaEntrada,
            horaSalida: turno.horaSalida
          },
          entradaProgramada: prog.entradaProgramada
            ? prog.entradaProgramada.toISOString()
            : null,
          salidaProgramada: prog.salidaProgramada ? prog.salidaProgramada.toISOString() : null
        };
      } else {
        horarioHoy = { esDescanso: true, origen: resolved.origen || 'ninguno', turno: null };
      }
    }

    return res.json({
      ok: true,
      fecha: fecha.toISOString().slice(0, 10),
      ahora: ahora.toISOString(),
      sugerido,
      jornadaCompleta: sugerido == null,
      tiposMarcacion: TIPOS_MARCACION,
      horario: horarioHoy,
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
 * GET /api/v1/asistencia/horario?dias=7
 * Horario asignado + recordatorios de entrada/salida para programar en el dispositivo
 * (offline local notifications) y refrescar cuando hay red.
 */
router.get('/asistencia/horario', requireMobileAuth, async (req, res) => {
  try {
    const dias = Number(req.query.dias) || undefined;
    const payload = await buildHorarioRecordatorios({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      dias
    });
    return res.json(payload);
  } catch (err) {
    console.error('[api/v1/asistencia/horario]', err);
    const status = err.status || 500;
    return jsonError(res, status, err.message || 'Error al consultar horario');
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
    const AttendanceRecord = await getAttendanceRecordModel();
    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: req.mobileAuth.empleadoId,
      tenantId: req.mobileAuth.tenantId,
      estatus: 'activo'
    }).lean();
    if (!empleado) {
      return jsonError(res, 403, 'Empleado no encontrado o inactivo');
    }

    let zonaHoraria = DEFAULT_TZ;
    if (empleado.subsidiariaId) {
      const Subsidiaria = await getSubsidiariaModel();
      const sub = await Subsidiaria.findById(empleado.subsidiariaId).select('zonaHoraria').lean();
      if (sub?.zonaHoraria) zonaHoraria = sub.zonaHoraria;
    }
    // Día laboral según zona de la subsidiaria (no UTC del contenedor)
    const fecha = calendarDateInTimeZone(ahora, zonaHoraria);

    const existentes = await AttendanceRecord.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      fecha: { $gte: startOfDay(fecha), $lte: endOfDay(fecha) },
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
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: req.mobileAuth.empleadoId,
        userId: req.mobileAuth.userId,
        etapa: 'punch_duplicate',
        resultado: 'rechazado',
        tipoMarcacion,
        mensaje: `Ya registraste «${tipoMarcacion}» hoy`,
        reasonCode: 'DUPLICATE_PUNCH',
        fechaJornada: fecha,
        ip: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });
      return jsonError(res, 409, `Ya registraste «${tipoMarcacion}» hoy`);
    }
    if (tiposHoy.includes('salida')) {
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: req.mobileAuth.empleadoId,
        userId: req.mobileAuth.userId,
        etapa: 'punch_duplicate',
        resultado: 'rechazado',
        tipoMarcacion,
        mensaje: 'La jornada de hoy ya está cerrada (salida registrada)',
        reasonCode: 'DAY_CLOSED',
        fechaJornada: fecha,
        ip: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });
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

    const accuracyMeters = parseNum(req.body.accuracyMeters);
    const isMocked =
      req.body.isMocked === true ||
      req.body.isMocked === 'true' ||
      req.body.isMocked === 1 ||
      req.body.isMocked === '1';

    const bioOk =
      req.body.biometriaOk === true ||
      req.body.biometriaOk === 'true' ||
      req.body.biometriaOk === 1 ||
      req.body.biometriaOk === '1';
    const bioScore = parseNum(req.body.biometriaScore);
    const bioChallengeId = String(req.body.biometriaChallengeId || '').trim();

    let deviceCheck;
    try {
      deviceCheck = await assertDispositivoParaMarcacion({
        tenantId: req.mobileAuth.tenantId,
        empleado,
        deviceUuid: req.body.deviceUuid
      });
    } catch (err) {
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: empleado._id,
        userId: req.mobileAuth.userId,
        etapa: 'device_check',
        resultado: 'rechazado',
        tipoMarcacion,
        mensaje: err.message || 'Dispositivo no autorizado',
        reasonCode: err.code || 'DEVICE_BLOCKED',
        fechaJornada: fecha,
        dispositivo: {
          plataforma: String(req.body.plataforma || '').trim().slice(0, 40),
          modelo: String(req.body.modelo || '').trim().slice(0, 80),
          appVersion: String(req.body.appVersion || '').trim().slice(0, 40),
          deviceUuid: String(req.body.deviceUuid || '').trim().slice(0, 80)
        },
        ip: req.ip || '',
        userAgent: req.get('user-agent') || ''
      }).catch(() => {});
      return jsonError(res, err.status || 403, err.message || 'Dispositivo no autorizado', err.code);
    }

    const regDevice = await findDispositivoActivo({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: empleado._id,
      deviceUuid: deviceCheck.deviceUuid
    });
    const telefonoPunch = String(
      regDevice?.telefono || empleado.telefono || req.body.telefono || ''
    )
      .trim()
      .slice(0, 20);
    const dispositivo = {
      plataforma: String(req.body.plataforma || '').trim().slice(0, 40),
      modelo: String(req.body.modelo || '').trim().slice(0, 80),
      appVersion: String(req.body.appVersion || '').trim().slice(0, 40),
      deviceUuid: deviceCheck.deviceUuid,
      telefono: telefonoPunch
    };
    const ubicacionPayload = {
      lat,
      lng,
      accuracyMeters: accuracyMeters != null ? accuracyMeters : null,
      isMocked: Boolean(isMocked)
    };

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
      const etapa = isMocked || /fake|simulad/i.test(String(geo.reason || '')) ? 'punch_fake_gps' : 'geo_check';
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: empleado._id,
        userId: req.mobileAuth.userId,
        etapa,
        resultado: 'rechazado',
        tipoMarcacion,
        mensaje: geo.reason || 'Fuera de la geocerca autorizada',
        reasonCode: isMocked ? 'FAKE_GPS' : 'GEO_BLOCKED',
        fechaJornada: fecha,
        biometria: {
          ok: bioOk || null,
          score: bioScore,
          challengeId: bioChallengeId
        },
        ubicacion: ubicacionPayload,
        geocerca: {
          politica: geo.politica || '',
          fueraDeZona: true,
          allowed: false,
          siteNombre: geo.match?.nombre || '',
          distanceMeters: geo.distanceMeters ?? null,
          radioMetros: geo.match?.radioMetros ?? null,
          skipped: Boolean(geo.skipped)
        },
        dispositivo,
        ip: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });
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

    const resultadoPunch = geo.fueraDeZona ? 'aceptado_con_observacion' : 'aceptado';

    const created = await AttendanceRecord.create({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: empleado._id,
      turnoId: empleado.turnoId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fecha,
      timestamp: ahora,
      timestampOriginal: ahora,
      servidorRegisteredAt: ahora,
      tipoMarcacion,
      metodo: 'movil',
      registradoPorUserId: req.mobileAuth.userId,
      notas: String(req.body.notas || '').trim().slice(0, 500),
      procesado: false,
      origen: 'original',
      estado: 'activa',
      ubicacion: {
        ...ubicacionPayload,
        capturedAt: ahora
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
      dispositivo,
      biometria: {
        ok: bioOk ? true : bioChallengeId || bioScore != null ? Boolean(bioOk) : null,
        score: bioScore,
        challengeId: bioChallengeId,
        verifiedAt: bioOk || bioChallengeId ? ahora : null
      }
    });

    const intento = await registrarIntento({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: empleado._id,
      userId: req.mobileAuth.userId,
      etapa: 'punch',
      resultado: resultadoPunch,
      tipoMarcacion,
      mensaje: `Marcación móvil ${tipoMarcacion}${
        geo.fueraDeZona ? ' (fuera de zona)' : geo.skipped ? '' : ` @ ${match?.nombre || ''}`
      }`,
      reasonCode: geo.fueraDeZona ? 'PUNCH_OUT_OF_ZONE' : 'PUNCH_OK',
      marcacionId: created._id,
      challengeId: bioChallengeId,
      fechaJornada: fecha,
      biometria: {
        ok: created.biometria?.ok,
        score: bioScore,
        challengeId: bioChallengeId
      },
      ubicacion: ubicacionPayload,
      geocerca: {
        politica: geo.politica || '',
        fueraDeZona: Boolean(geo.fueraDeZona),
        allowed: true,
        siteNombre: match?.nombre || '',
        distanceMeters: geo.distanceMeters ?? null,
        radioMetros: match?.radioMetros ?? null,
        skipped: Boolean(geo.skipped)
      },
      dispositivo,
      ip: req.ip || '',
      userAgent: req.get('user-agent') || ''
    });

    if (intento?._id) {
      await AttendanceRecord.updateOne(
        { _id: created._id },
        { $set: { attemptId: intento._id } }
      );
      created.attemptId = intento._id;
    }

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
      despues: snapshotMarcacion(created.toObject ? created.toObject() : created),
      detalle: { attemptId: intento?._id ? String(intento._id) : null }
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
        geocerca: created.geocerca,
        biometria: created.biometria
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
 * o ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (máx. 90 días)
 * Incluye GPS, dispositivo (UUID), geocerca y biometría para detalle en app.
 */
router.get('/asistencia/historial', requireMobileAuth, async (req, res) => {
  try {
    let desde;
    let hasta;
    const desdeQ = String(req.query.desde || '').trim();
    const hastaQ = String(req.query.hasta || '').trim();
    if (desdeQ && hastaQ) {
      const d0 = new Date(`${desdeQ}T00:00:00`);
      const d1 = new Date(`${hastaQ}T00:00:00`);
      if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) {
        return jsonError(res, 400, 'Fechas inválidas (usa YYYY-MM-DD)', 'BAD_DATES');
      }
      desde = startOfDay(d0);
      hasta = endOfDay(d1);
      const spanMs = hasta.getTime() - desde.getTime();
      if (spanMs < 0) {
        return jsonError(res, 400, 'desde no puede ser mayor que hasta', 'BAD_RANGE');
      }
      if (spanMs > 90 * 24 * 60 * 60 * 1000) {
        return jsonError(res, 400, 'El rango máximo es 90 días', 'RANGE_TOO_LONG');
      }
    } else {
      const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 14));
      hasta = endOfDay(new Date());
      desde = startOfDay(new Date(Date.now() - (dias - 1) * 24 * 60 * 60 * 1000));
    }

    const AttendanceRecord = await getAttendanceRecordModel();
    const rows = await AttendanceRecord.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      fecha: { $gte: desde, $lte: hasta },
      $or: [{ estado: 'activa' }, { estado: { $exists: false } }, { estado: null }]
    })
      .sort({ timestamp: -1 })
      .limit(300)
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
        timestampOriginal: m.timestampOriginal || null,
        servidorRegisteredAt: m.servidorRegisteredAt || null,
        metodo: m.metodo,
        estado: m.estado || 'activa',
        origen: m.origen || 'original',
        notas: m.notas || '',
        ubicacion: m.ubicacion
          ? {
              lat: m.ubicacion.lat,
              lng: m.ubicacion.lng,
              accuracyMeters: m.ubicacion.accuracyMeters,
              capturedAt: m.ubicacion.capturedAt,
              isMocked: Boolean(m.ubicacion.isMocked)
            }
          : null,
        geocerca: m.geocerca
          ? {
              politica: m.geocerca.politica || '',
              skipped: Boolean(m.geocerca.skipped),
              fueraDeZona: Boolean(m.geocerca.fueraDeZona),
              allowed: m.geocerca.allowed !== false,
              siteNombre: m.geocerca.siteNombre || '',
              siteSource: m.geocerca.siteSource || '',
              distanceMeters: m.geocerca.distanceMeters,
              radioMetros: m.geocerca.radioMetros,
              justificacionFueraZona: m.geocerca.justificacionFueraZona || ''
            }
          : null,
        dispositivo: m.dispositivo
          ? {
              plataforma: m.dispositivo.plataforma || '',
              modelo: m.dispositivo.modelo || '',
              appVersion: m.dispositivo.appVersion || '',
              deviceUuid: m.dispositivo.deviceUuid || '',
              telefono: m.dispositivo.telefono || ''
            }
          : null,
        biometria: m.biometria
          ? {
              ok: m.biometria.ok,
              score: m.biometria.score,
              challengeId: m.biometria.challengeId || '',
              verifiedAt: m.biometria.verifiedAt || null
            }
          : null
      }))
    });
  } catch (err) {
    console.error('[api/v1/asistencia/historial]', err);
    return jsonError(res, 500, 'Error al cargar historial');
  }
});

/** POST /api/v1/push/register — body: { token, plataforma?, deviceUuid? } */
router.post('/push/register', requireMobileAuth, async (req, res) => {
  try {
    const result = await registerPushToken({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      userId: req.mobileAuth.userId,
      token: req.body.token || req.body.fcmToken,
      plataforma: req.body.plataforma,
      deviceUuid: req.body.deviceUuid
    });
    return res.json(result);
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error al registrar push', err.code);
  }
});

async function assertVacacionesMobile(req) {
  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({
    _id: req.mobileAuth.empleadoId,
    tenantId: req.mobileAuth.tenantId,
    estatus: 'activo'
  }).lean();
  if (!empleado) {
    const err = new Error('Empleado no encontrado');
    err.status = 403;
    throw err;
  }
  const flags = await resolveMobileFeatureFlags(req.mobileAuth.tenantId, empleado);
  if (!tenantHasFeature(flags, 'vacaciones')) {
    const err = new Error('Módulo de vacaciones no activo');
    err.status = 403;
    err.code = 'FEATURE_DISABLED';
    throw err;
  }
  return empleado;
}

router.get('/vacaciones/saldo', requireMobileAuth, async (req, res) => {
  try {
    const empleado = await assertVacacionesMobile(req);
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const saldo = await obtenerSaldoDisponible(req.mobileAuth.tenantId, empleado._id, anio);
    const solicitudes = await listSolicitudesEmpleado(req.mobileAuth.tenantId, empleado._id);
    return res.json({ ok: true, anio, saldo, solicitudes });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

router.get('/vacaciones/preview-dias', requireMobileAuth, async (req, res) => {
  try {
    const empleado = await assertVacacionesMobile(req);
    const inicio = new Date(req.query.inicio || req.query.fechaInicio);
    const fin = new Date(req.query.fin || req.query.fechaFin || req.query.inicio);
    if (Number.isNaN(inicio.getTime())) return jsonError(res, 400, 'Fechas inválidas');
    const { dias, detalle } = await contarDiasVacaciones({
      tenantId: req.mobileAuth.tenantId,
      empresaId: empleado.empresaId || null,
      subsidiariaId: empleado.subsidiariaId || null,
      fechaInicio: inicio,
      fechaFin: fin,
      timeZone: DEFAULT_TZ
    });
    return res.json({ ok: true, dias, detalle });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

router.post('/vacaciones/solicitar', requireMobileAuth, async (req, res) => {
  try {
    const empleado = await assertVacacionesMobile(req);
    const doc = await crearSolicitudVacaciones({
      tenantId: req.mobileAuth.tenantId,
      empleado,
      fechaInicio: new Date(req.body.fechaInicio),
      fechaFin: new Date(req.body.fechaFin || req.body.fechaInicio),
      motivo: req.body.motivo,
      userId: req.mobileAuth.userId
    });
    return res.status(201).json({ ok: true, solicitud: doc });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

router.post('/vacaciones/:id/cancelar', requireMobileAuth, async (req, res) => {
  try {
    await assertVacacionesMobile(req);
    const doc = await cancelarSolicitud({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: req.mobileAuth.empleadoId,
      solicitudId: req.params.id,
      userId: req.mobileAuth.userId
    });
    return res.json({ ok: true, solicitud: doc });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

router.get('/vacaciones/aprobaciones', requireMobileAuth, async (req, res) => {
  try {
    const empleado = await assertVacacionesMobile(req);
    const flags = await resolveMobileFeatureFlags(req.mobileAuth.tenantId, empleado);
    const caps = await buildEmpleadoCapabilities({
      tenantId: req.mobileAuth.tenantId,
      empleado,
      featureFlags: flags
    });
    if (!caps.esSupervisor) {
      return jsonError(res, 403, 'No tienes equipo a cargo', 'NOT_SUPERVISOR');
    }
    const pendientes = await listPendientesSupervisor(req.mobileAuth.tenantId, empleado._id);
    const Empleado = await getEmpleadoModel();
    const ids = pendientes.map((p) => p.empleadoId);
    const emps = ids.length
      ? await Empleado.find({ _id: { $in: ids } })
          .select('firstName lastName numEmpleado')
          .lean()
      : [];
    const empMap = Object.fromEntries(
      emps.map((e) => [
        String(e._id),
        {
          id: String(e._id),
          nombre: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
          numEmpleado: e.numEmpleado || ''
        }
      ])
    );
    return res.json({
      ok: true,
      pendientes: pendientes.map((p) => ({
        ...p,
        id: String(p._id),
        empleado: empMap[String(p.empleadoId)] || null
      }))
    });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

router.post('/vacaciones/aprobaciones/:id/resolver', requireMobileAuth, async (req, res) => {
  try {
    const empleado = await assertVacacionesMobile(req);
    const status = String(req.body.status || '').toUpperCase();
    const doc = await resolverSolicitud({
      tenantId: req.mobileAuth.tenantId,
      solicitudId: req.params.id,
      status,
      userId: req.mobileAuth.userId,
      motivoRechazo: req.body.motivoRechazo,
      actorEmpleadoId: empleado._id,
      allowRrhh: false
    });
    return res.json({ ok: true, solicitud: doc });
  } catch (err) {
    return jsonError(res, err.status || 500, err.message || 'Error', err.code);
  }
});

/** GET /api/v1/recibos — histórico de nómina del empleado */
router.get('/recibos', requireMobileAuth, async (req, res) => {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await Empleado.findOne({
      _id: req.mobileAuth.empleadoId,
      tenantId: req.mobileAuth.tenantId,
      estatus: 'activo'
    }).lean();
    if (!empleado) return jsonError(res, 403, 'Empleado no encontrado');
    const flags = await resolveMobileFeatureFlags(req.mobileAuth.tenantId, empleado);
    if (!tenantHasFeature(flags, 'recibos')) {
      return jsonError(res, 403, 'Módulo de recibos no activo', 'FEATURE_DISABLED');
    }
    const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
    const Historico = await getNominaHistoricoReciboModel();
    const rows = await Historico.find({
      tenantId: req.mobileAuth.tenantId,
      empleadoId: empleado._id
    })
      .sort({ anio: -1, mes: -1, createdAt: -1 })
      .limit(36)
      .select('anio mes periodo totalPercepciones totalDeducciones netoPagar origen fechaCierre')
      .lean();
    const recibos = rows.map((r) => ({
      id: String(r._id),
      anio: r.anio,
      mes: r.mes,
      periodoLabel:
        r.periodo?.numeroPeriodo != null
          ? `${r.anio}-${String(r.mes).padStart(2, '0')} · P${r.periodo.numeroPeriodo}`
          : `${r.anio}-${String(r.mes).padStart(2, '0')}`,
      totalPercepciones: r.totalPercepciones,
      totalDeducciones: r.totalDeducciones,
      neto: r.netoPagar,
      origen: r.origen || '',
      fechaCierre: r.fechaCierre || null
    }));
    return res.json({ ok: true, recibos });
  } catch (err) {
    console.error('[api/v1/recibos]', err);
    return jsonError(res, 500, err.message || 'Error al cargar recibos');
  }
});

module.exports = router;
