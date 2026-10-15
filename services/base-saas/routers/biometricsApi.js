'use strict';

/**
 * API biométrica: retos de liveness + verificación 1:1 (+ autoenrolamiento).
 * Montada en /api/v1/biometrics y /api/biometrics
 */

const express = require('express');
const multer = require('multer');
const { requireMobileAuth } = require('../middleware/mobileAuth');
const { getStatus } = require('../services/biometrics/faceApiService');
const {
  issueChallenge,
  verifyLivenessAndMatch,
  getEmpleadoBiometria,
  bioFlags
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
 * Permitido si ya hay plantilla O si RRHH habilitó autoenrolamiento.
 */
router.get('/challenge', requireMobileAuth, async (req, res) => {
  try {
    const emp = await getEmpleadoBiometria(req.mobileAuth.tenantId, req.mobileAuth.empleadoId);
    const flags = bioFlags(emp?.biometriaFacial || {});
    if (!flags.canChallenge) {
      return jsonError(
        res,
        409,
        'Sin plantilla facial. RRHH debe registrar el rostro o habilitar autoenrolamiento en la ficha.'
      );
    }
    const challenge = await issueChallenge(req.mobileAuth);
    const purpose = flags.enrolled ? 'verify' : 'enroll';
    return res.json({
      ok: true,
      challengeId: challenge.challengeId,
      requiredFrames: challenge.requiredFrames,
      expiresAt: challenge.expiresAt,
      purpose,
      autoEnrolamiento: flags.autoEnrolamiento,
      enrolled: flags.enrolled
    });
  } catch (err) {
    console.error('[biometrics/challenge]', err);
    return jsonError(res, 503, err.message || 'Motor biométrico no disponible');
  }
});

/**
 * POST /verify  multipart: challengeId, userId?, frame_neutral, frame_action
 * Si purpose=enroll (sin plantilla + autoenrolamiento), crea la plantilla tras liveness.
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

      const result = await verifyLivenessAndMatch({
        auth: req.mobileAuth,
        challengeId,
        frameNeutral,
        frameAction
      });

      const details = result.details || {};
      const purpose = details.purpose || 'verify';
      await registrarIntento({
        tenantId: req.mobileAuth.tenantId,
        empleadoId: req.mobileAuth.empleadoId,
        userId: req.mobileAuth.userId,
        etapa: purpose === 'enroll' ? 'bio_enroll' : 'bio_verify',
        resultado: result.success ? 'aceptado' : 'rechazado',
        mensaje: result.message || '',
        reasonCode: result.success
          ? purpose === 'enroll'
            ? 'BIO_AUTO_ENROLL'
            : 'BIO_OK'
          : 'BIO_FAIL',
        challengeId,
        fechaJornada: startOfDay(new Date()),
        biometria: {
          ok: Boolean(result.success),
          score: result.confidenceScore ?? null,
          distance: details.distance ?? null,
          threshold: details.threshold ?? null,
          challengeId,
          usedFlip: Boolean(details.usedFlip),
          autoEnrolled: Boolean(details.autoEnrolled),
          templateImproved: Boolean(details.templateImproved)
        },
        detalle: {
          liveness: details.liveness || null,
          purpose,
          templateImproved: details.templateImproved || false
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
        details: result.details || undefined,
        purpose
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
 * GET /status — plantilla + flags de autoenrolamiento / mejora
 */
router.get('/status', requireMobileAuth, async (req, res) => {
  try {
    const emp = await getEmpleadoBiometria(req.mobileAuth.tenantId, req.mobileAuth.empleadoId);
    const bio = emp?.biometriaFacial || {};
    const flags = bioFlags(bio);
    return res.json({
      ok: true,
      enrolled: flags.enrolled,
      enrolledAt: bio.enrolledAt || null,
      modelVersion: bio.modelVersion || null,
      autoEnrolamiento: flags.autoEnrolamiento,
      autoMejoraPlantilla: flags.autoMejoraPlantilla,
      canSelfEnroll: flags.canSelfEnroll,
      canChallenge: flags.canChallenge,
      samplesCount: Number(bio.samplesCount) || 0,
      detectionScore: bio.detectionScore != null ? Number(bio.detectionScore) : null
    });
  } catch (err) {
    return jsonError(res, 500, err.message || 'Error status');
  }
});

module.exports = router;
