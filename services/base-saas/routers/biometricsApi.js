'use strict';

/**
 * API biométrica: retos de liveness + verificación 1:1.
 * Montada en /api/v1/biometrics y /api/biometrics
 */

const express = require('express');
const multer = require('multer');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { getStatus } = require('../services/biometrics/faceApiService');
const {
  issueChallenge,
  verifyLivenessAndMatch,
  getEmpleadoBiometria
} = require('../services/biometrics/biometricsService');
const { registrarIntento } = require('../services/attendanceAttemptService');
const { startOfDay } = require('../libs/timeHelpers');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 }
});

function jsonError(res, status, error) {
  return res.status(status).json({ ok: false, success: false, error, message: error });
}

router.get('/health', async (_req, res) => {
  try {
    const status = getStatus();
    res.json({ ok: true, biometrics: status });
  } catch (err) {
    jsonError(res, 500, err.message || 'Error biometrics health');
  }
});

/**
 * GET /challenge
 */
router.get('/challenge', requireMobileAuth, async (req, res) => {
  try {
    const emp = await getEmpleadoBiometria(req.mobileAuth.tenantId, req.mobileAuth.empleadoId);
    if (!emp?.biometriaFacial?.enrolled) {
      return jsonError(
        res,
        409,
        'Sin plantilla facial. RRHH debe registrar el rostro en la ficha del empleado.'
      );
    }
    const challenge = await issueChallenge(req.mobileAuth);
    return res.json({
      ok: true,
      challengeId: challenge.challengeId,
      requiredFrames: challenge.requiredFrames,
      expiresAt: challenge.expiresAt
    });
  } catch (err) {
    console.error('[biometrics/challenge]', err);
    return jsonError(res, 503, err.message || 'Motor biométrico no disponible');
  }
});

/**
 * POST /verify  multipart: challengeId, userId?, frame_neutral, frame_action
 */
router.post(
  '/verify',
  requireMobileAuth,
  upload.fields([
    { name: 'frame_neutral', maxCount: 1 },
    { name: 'frame_action', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const challengeId = String(req.body.challengeId || '');
      const frameNeutral = req.files?.frame_neutral?.[0]?.buffer;
      const frameAction = req.files?.frame_action?.[0]?.buffer;

      // userId del body es informativo; la autoridad es el JWT
      const result = await verifyLivenessAndMatch({
        auth: req.mobileAuth,
        challengeId,
        frameNeutral,
        frameAction
      });

      const details = result.details || {};
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: req.mobileAuth.empleadoId,
        userId: req.mobileAuth.userId,
        etapa: 'bio_verify',
        resultado: result.success ? 'aceptado' : 'rechazado',
        mensaje: result.message || '',
        reasonCode: result.success ? 'BIO_OK' : 'BIO_FAIL',
        challengeId,
        fechaJornada: startOfDay(new Date()),
        biometria: {
          ok: Boolean(result.success),
          score: result.confidenceScore ?? null,
          distance: details.distance ?? null,
          threshold: details.threshold ?? null,
          challengeId,
          usedFlip: Boolean(details.usedFlip)
        },
        detalle: {
          liveness: details.liveness || null,
          distanceNeutral: details.distanceNeutral,
          distanceAction: details.distanceAction
        },
        ip: req.ip || '',
        userAgent: req.get('user-agent') || ''
      });

      const status = result.success ? 200 : 401;
      return res.status(status).json({
        ok: result.success,
        success: result.success,
        confidenceScore: result.confidenceScore ?? 0,
        message: result.message,
        details: result.details || undefined
      });
    } catch (err) {
      console.error('[biometrics/verify]', err);
      try {
        await registrarIntento({
          tenantId: req.mobileAuth?.tenantId,
          empleadoId: req.mobileAuth?.empleadoId,
          userId: req.mobileAuth?.userId,
          etapa: 'bio_verify',
          resultado: 'error',
          mensaje: err.message || 'Error al verificar biometría',
          reasonCode: 'BIO_ERROR',
          ip: req.ip || '',
          userAgent: req.get('user-agent') || ''
        });
      } catch (_) {
        /* ignore */
      }
      return jsonError(res, 500, err.message || 'Error al verificar biometría');
    }
  }
);

/**
 * GET /status — ¿tiene plantilla facial el empleado de la sesión?
 */
router.get('/status', requireMobileAuth, async (req, res) => {
  try {
    const emp = await getEmpleadoBiometria(req.mobileAuth.tenantId, req.mobileAuth.empleadoId);
    const bio = emp?.biometriaFacial || {};
    return res.json({
      ok: true,
      enrolled: Boolean(bio.enrolled && bio.embedding?.length),
      enrolledAt: bio.enrolledAt || null,
      modelVersion: bio.modelVersion || null
    });
  } catch (err) {
    return jsonError(res, 500, err.message || 'Error status');
  }
});

module.exports = router;
