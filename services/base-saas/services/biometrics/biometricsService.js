'use strict';

const getEmpleadoModel = require('../../models/empleado');
const { consumeChallenge, createChallenge } = require('./challengeStore');
const {
  ensureReady,
  analyzeFace,
  evaluateLiveness,
  bestMatch,
  normalizeEmbedding,
  MATCH_THRESHOLD
} = require('./faceApiService');

const DEFAULT_FRAMES = [
  { id: 'frame_neutral', instruction: 'Mira al frente, sin sonreír (rostro relajado)' },
  { id: 'frame_action', instruction: 'Ahora sonríe con claridad (muestra dientes si puedes)' }
];

async function issueChallenge(auth) {
  await ensureReady();
  return createChallenge({
    tenantId: auth.tenantId,
    userId: auth.userId,
    empleadoId: auth.empleadoId,
    requiredFrames: DEFAULT_FRAMES
  });
}

async function getEmpleadoBiometria(tenantId, empleadoId) {
  const Empleado = await getEmpleadoModel();
  const emp = await Empleado.findOne({ _id: empleadoId, tenantId })
    .select('firstName lastName biometriaFacial')
    .lean();
  return emp;
}

/**
 * Enroll desde buffer de imagen (web RRHH o API).
 */
async function enrollFromImage({ tenantId, empleadoId, imageBuffer, enrolledBy }) {
  await ensureReady();
  const face = await analyzeFace(imageBuffer, { label: 'enroll' });
  if (!face.ok) {
    return { success: false, message: face.error };
  }
  if (face.expressions.neutral < 0.4 && face.expressions.happy < 0.4) {
    // aceptar enroll aunque no sea perfectamente neutro, pero preferir rostro claro
  }

  const Empleado = await getEmpleadoModel();
  const updated = await Empleado.findOneAndUpdate(
    { _id: empleadoId, tenantId },
    {
      $set: {
        biometriaFacial: {
          enrolled: true,
          enrolledAt: new Date(),
          enrolledBy: enrolledBy || null,
          modelVersion: 'facenet-128',
          embedding: face.descriptor,
          distanceThreshold: MATCH_THRESHOLD,
          detectionScore: face.score
        }
      }
    },
    { new: true }
  ).select('biometriaFacial firstName lastName numEmpleado');

  if (!updated) {
    return { success: false, message: 'Empleado no encontrado' };
  }

  return {
    success: true,
    message: 'Rostro registrado correctamente',
    biometria: {
      enrolled: true,
      enrolledAt: updated.biometriaFacial.enrolledAt,
      modelVersion: updated.biometriaFacial.modelVersion,
      detectionScore: face.score
    }
  };
}

async function clearEnrollment({ tenantId, empleadoId }) {
  const Empleado = await getEmpleadoModel();
  await Empleado.updateOne(
    { _id: empleadoId, tenantId },
    {
      $set: {
        biometriaFacial: {
          enrolled: false,
          enrolledAt: null,
          enrolledBy: null,
          modelVersion: '',
          embedding: [],
          distanceThreshold: MATCH_THRESHOLD,
          detectionScore: 0
        }
      }
    }
  );
  return { success: true, message: 'Biometría facial eliminada' };
}

/**
 * Verifica liveness + match 1:1.
 * @param {object} opts
 * @param {object} opts.auth - mobileAuth
 * @param {string} opts.challengeId
 * @param {Buffer} opts.frameNeutral
 * @param {Buffer} opts.frameAction
 */
async function verifyLivenessAndMatch({ auth, challengeId, frameNeutral, frameAction }) {
  await ensureReady();

  const consumed = consumeChallenge(challengeId, {
    tenantId: auth.tenantId,
    userId: auth.userId,
    empleadoId: auth.empleadoId
  });
  if (!consumed.ok) {
    return { success: false, confidenceScore: 0, message: consumed.error };
  }

  if (!frameNeutral?.length || !frameAction?.length) {
    return { success: false, confidenceScore: 0, message: 'Faltan fotogramas del reto' };
  }

  const emp = await getEmpleadoBiometria(auth.tenantId, auth.empleadoId);
  if (!emp) {
    return { success: false, confidenceScore: 0, message: 'Empleado no encontrado' };
  }
  const bio = emp.biometriaFacial || {};
  const reference = normalizeEmbedding(bio.embedding);
  if (!bio.enrolled || reference.length < 64) {
    return {
      success: false,
      confidenceScore: 0,
      message: 'Sin rostro de referencia. Solicita el enroll en RRHH (ficha del empleado).'
    };
  }

  const neutralFace = await analyzeFace(frameNeutral, { label: 'frame_neutral' });
  if (!neutralFace.ok) {
    return { success: false, confidenceScore: 0, message: neutralFace.error };
  }
  const actionFace = await analyzeFace(frameAction, { label: 'frame_action' });
  if (!actionFace.ok) {
    return { success: false, confidenceScore: 0, message: actionFace.error };
  }

  const live = evaluateLiveness(neutralFace, actionFace);
  if (!live.ok) {
    return {
      success: false,
      confidenceScore: 0,
      message: `Prueba de vida fallida: ${live.reasons[0]}`,
      details: { liveness: live.metrics, reasons: live.reasons }
    };
  }

  // Umbral: env/default 0.62 (face-api). Ignora legados demasiado estrictos (0.45).
  const storedTh = Number(bio.distanceThreshold);
  const threshold =
    Number.isFinite(storedTh) && storedTh >= 0.55 ? storedTh : MATCH_THRESHOLD;

  let match = bestMatch(
    [neutralFace.descriptor, actionFace.descriptor],
    reference,
    threshold
  );
  let usedFlip = false;

  // Fallback espejo: selfie móvil vs webcam web a menudo vienen espejadas distinto.
  if (!match.ok && match.distance > threshold) {
    const flippedNeutral = await analyzeFace(frameNeutral, {
      label: 'frame_neutral_flip',
      flipHorizontal: true
    });
    const flippedAction = await analyzeFace(frameAction, {
      label: 'frame_action_flip',
      flipHorizontal: true
    });
    const probes = [];
    if (flippedNeutral.ok) probes.push(flippedNeutral.descriptor);
    if (flippedAction.ok) probes.push(flippedAction.descriptor);
    if (probes.length) {
      const flipMatch = bestMatch(probes, reference, threshold);
      if (flipMatch.distance < match.distance) {
        match = flipMatch;
        usedFlip = true;
      }
    }
  }

  if (!match.ok) {
    const tip =
      match.distance > 0.75
        ? ' Vuelve a registrar el rostro en RRHH (ficha → Biometría facial) con la misma persona y buena luz.'
        : ' Usa la misma persona enrollada, buena luz y mira al frente.';
    return {
      success: false,
      confidenceScore: match.confidenceScore || 0,
      message: `Identidad no coincide (distancia ${match.distance.toFixed(3)} > ${threshold}).${tip}`,
      details: {
        distance: match.distance,
        threshold,
        usedFlip
      }
    };
  }

  return {
    success: true,
    confidenceScore: match.confidenceScore,
    message: 'Identidad y prueba de vida verificadas exitosamente',
    details: {
      distance: match.distance,
      threshold,
      usedFlip,
      liveness: live.metrics
    }
  };
}

module.exports = {
  issueChallenge,
  enrollFromImage,
  clearEnrollment,
  verifyLivenessAndMatch,
  getEmpleadoBiometria,
  DEFAULT_FRAMES
};
