'use strict';

const getEmpleadoModel = require('../../models/empleado');
const { consumeChallenge, createChallenge } = require('./challengeStore');
const {
  ensureReady,
  analyzeFace,
  evaluateLiveness,
  bestMatch,
  normalizeEmbedding,
  euclideanDistance,
  MATCH_THRESHOLD
} = require('./faceApiService');

const DEFAULT_FRAMES = [
  { id: 'frame_neutral', instruction: 'Mira al frente, sin sonreír (rostro relajado)' },
  { id: 'frame_action', instruction: 'Ahora sonríe con claridad (muestra dientes si puedes)' }
];

const ENROLL_MIN_SCORE = Number(process.env.BIOMETRICS_ENROLL_MIN_SCORE || 0.52);
const ENROLL_MAX_PAIR_DISTANCE = Number(process.env.BIOMETRICS_ENROLL_MAX_PAIR_DISTANCE || 0.48);
const IMPROVE_DISTANCE_RATIO = Number(process.env.BIOMETRICS_IMPROVE_DISTANCE_RATIO || 0.85);
const BLEND_WEIGHT = Number(process.env.BIOMETRICS_BLEND_WEIGHT || 0.35);
const IMPROVE_COOLDOWN_MS = Number(process.env.BIOMETRICS_IMPROVE_COOLDOWN_MS || 6 * 60 * 60 * 1000);

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

function bioFlags(bio = {}) {
  const enrolled = Boolean(bio.enrolled && normalizeEmbedding(bio.embedding).length >= 64);
  const autoEnrolamiento = Boolean(bio.autoEnrolamiento);
  const autoMejoraPlantilla = bio.autoMejoraPlantilla !== false;
  return {
    enrolled,
    autoEnrolamiento,
    autoMejoraPlantilla,
    canSelfEnroll: autoEnrolamiento && !enrolled,
    canChallenge: enrolled || autoEnrolamiento
  };
}

function l2Normalize(vec) {
  const arr = normalizeEmbedding(vec);
  if (!arr.length) return [];
  let sumSq = 0;
  for (const v of arr) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return arr.map((v) => v / norm);
}

/** Promedio de descriptores (misma longitud) + L2. */
function averageDescriptors(list) {
  const valid = (list || []).map(normalizeEmbedding).filter((d) => d.length >= 64);
  if (!valid.length) return [];
  const dim = valid[0].length;
  const acc = new Array(dim).fill(0);
  let n = 0;
  for (const d of valid) {
    if (d.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) acc[i] += d[i];
    n += 1;
  }
  if (!n) return [];
  return l2Normalize(acc.map((v) => v / n));
}

/** Blend: (1-w)*base + w*probe, L2. */
function blendEmbeddings(base, probe, weight = BLEND_WEIGHT) {
  const a = normalizeEmbedding(base);
  const b = normalizeEmbedding(probe);
  if (a.length < 64 || b.length !== a.length) return a;
  const w = Math.max(0, Math.min(0.6, Number(weight) || 0.35));
  const out = a.map((v, i) => (1 - w) * v + w * b[i]);
  return l2Normalize(out);
}

function qualityGate(face, label) {
  if (!face?.ok) return { ok: false, message: face?.error || `Rostro inválido (${label})` };
  if (Number(face.score) < ENROLL_MIN_SCORE) {
    return {
      ok: false,
      message: `Calidad insuficiente en ${label} (score ${Number(face.score).toFixed(2)} < ${ENROLL_MIN_SCORE}). Mejor luz y acércate.`
    };
  }
  return { ok: true };
}

/**
 * Enroll desde buffer de imagen (web RRHH o API).
 */
async function enrollFromImage({ tenantId, empleadoId, imageBuffer, enrolledBy, source = 'rrhh' }) {
  await ensureReady();
  const face = await analyzeFace(imageBuffer, { label: 'enroll' });
  const q = qualityGate(face, 'enroll');
  if (!q.ok) {
    return { success: false, message: q.message };
  }

  const Empleado = await getEmpleadoModel();
  const embedding = l2Normalize(face.descriptor);
  const updated = await Empleado.findOneAndUpdate(
    { _id: empleadoId, tenantId },
    {
      $set: {
        'biometriaFacial.enrolled': true,
        'biometriaFacial.enrolledAt': new Date(),
        'biometriaFacial.enrolledBy': enrolledBy || source || null,
        'biometriaFacial.modelVersion': 'facenet-128',
        'biometriaFacial.embedding': embedding,
        'biometriaFacial.distanceThreshold': MATCH_THRESHOLD,
        'biometriaFacial.detectionScore': face.score,
        'biometriaFacial.samplesCount': 1,
        'biometriaFacial.lastAutoUpdateAt': source === 'auto' ? new Date() : null
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
      detectionScore: face.score,
      source
    }
  };
}

/**
 * Autoenrolamiento desde los 2 frames del reto (liveness + calidad).
 * Plantilla = promedio de neutro + acción (más robusto ante variación).
 */
async function enrollFromLivenessFrames({
  tenantId,
  empleadoId,
  neutralFace,
  actionFace,
  enrolledBy = 'auto-app'
}) {
  const qn = qualityGate(neutralFace, 'frame_neutral');
  if (!qn.ok) return { success: false, message: qn.message };
  const qa = qualityGate(actionFace, 'frame_action');
  if (!qa.ok) return { success: false, message: qa.message };

  const pairDist = euclideanDistance(
    normalizeEmbedding(neutralFace.descriptor),
    normalizeEmbedding(actionFace.descriptor)
  );
  if (pairDist > ENROLL_MAX_PAIR_DISTANCE) {
    return {
      success: false,
      message: `Los dos fotogramas no parecen la misma persona (dist ${pairDist.toFixed(3)}). Repite el reto con buena luz.`
    };
  }

  const embedding = averageDescriptors([neutralFace.descriptor, actionFace.descriptor]);
  if (embedding.length < 64) {
    return { success: false, message: 'No se pudo construir la plantilla facial' };
  }

  const detectionScore = Math.min(Number(neutralFace.score) || 0, Number(actionFace.score) || 0);
  const Empleado = await getEmpleadoModel();
  const updated = await Empleado.findOneAndUpdate(
    { _id: empleadoId, tenantId, 'biometriaFacial.autoEnrolamiento': true },
    {
      $set: {
        'biometriaFacial.enrolled': true,
        'biometriaFacial.enrolledAt': new Date(),
        'biometriaFacial.enrolledBy': enrolledBy,
        'biometriaFacial.modelVersion': 'facenet-128',
        'biometriaFacial.embedding': embedding,
        'biometriaFacial.distanceThreshold': MATCH_THRESHOLD,
        'biometriaFacial.detectionScore': detectionScore,
        'biometriaFacial.samplesCount': 2,
        'biometriaFacial.lastAutoUpdateAt': new Date()
      },
      $inc: { 'biometriaFacial.autoEnrolCount': 1 }
    },
    { new: true }
  ).select('biometriaFacial');

  if (!updated) {
    return {
      success: false,
      message: 'Autoenrolamiento no permitido o empleado no encontrado'
    };
  }

  return {
    success: true,
    message: 'Rostro autoenrolado correctamente. Ya puedes checar con biometría.',
    enrolled: true,
    autoEnrolled: true,
    confidenceScore: Math.round(detectionScore * 1000) / 1000,
    details: {
      detectionScore,
      pairDistance: pairDist,
      samplesCount: 2
    }
  };
}

async function maybeImproveTemplate({
  tenantId,
  empleadoId,
  bio,
  probeDescriptors,
  matchDistance,
  threshold,
  detectionScores = []
}) {
  if (!bio || bio.autoMejoraPlantilla === false) {
    return { improved: false, reason: 'disabled' };
  }
  const maxImproveDist = threshold * IMPROVE_DISTANCE_RATIO;
  if (!(Number(matchDistance) <= maxImproveDist)) {
    return { improved: false, reason: 'distance' };
  }
  const last = bio.lastAutoUpdateAt ? new Date(bio.lastAutoUpdateAt).getTime() : 0;
  if (last && Date.now() - last < IMPROVE_COOLDOWN_MS) {
    return { improved: false, reason: 'cooldown' };
  }

  const probeAvg = averageDescriptors(probeDescriptors);
  if (probeAvg.length < 64) return { improved: false, reason: 'probe' };

  const prevSamples = Math.max(1, Number(bio.samplesCount) || 1);
  // Peso menor si ya hay muchas muestras
  const weight = Math.min(BLEND_WEIGHT, 0.45 / Math.sqrt(prevSamples));
  const blended = blendEmbeddings(bio.embedding, probeAvg, weight);
  const bestScore = detectionScores.length
    ? Math.max(...detectionScores.map(Number).filter((n) => Number.isFinite(n)))
    : Number(bio.detectionScore) || 0;

  const Empleado = await getEmpleadoModel();
  await Empleado.updateOne(
    { _id: empleadoId, tenantId, 'biometriaFacial.enrolled': true },
    {
      $set: {
        'biometriaFacial.embedding': blended,
        'biometriaFacial.samplesCount': prevSamples + 1,
        'biometriaFacial.lastAutoUpdateAt': new Date(),
        'biometriaFacial.detectionScore': Math.max(Number(bio.detectionScore) || 0, bestScore)
      }
    }
  );
  return { improved: true, samplesCount: prevSamples + 1, blendWeight: weight };
}

async function clearEnrollment({ tenantId, empleadoId }) {
  const Empleado = await getEmpleadoModel();
  const existing = await Empleado.findOne({ _id: empleadoId, tenantId })
    .select(
      'biometriaFacial.autoEnrolamiento biometriaFacial.autoMejoraPlantilla biometriaFacial.autoEnrolCount biometriaFacial.distanceThreshold'
    )
    .lean();
  const flags = existing?.biometriaFacial || {};
  const th = Number(flags.distanceThreshold);
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
          distanceThreshold: Number.isFinite(th) && th >= 0.45 ? th : MATCH_THRESHOLD,
          detectionScore: 0,
          autoEnrolamiento: Boolean(flags.autoEnrolamiento),
          autoMejoraPlantilla: flags.autoMejoraPlantilla !== false,
          samplesCount: 0,
          lastAutoUpdateAt: null,
          autoEnrolCount: Number(flags.autoEnrolCount) || 0
        }
      }
    }
  );
  return { success: true, message: 'Biometría facial eliminada' };
}

async function updateBiometriaConfig({
  tenantId,
  empleadoId,
  autoEnrolamiento,
  autoMejoraPlantilla,
  distanceThreshold
}) {
  const Empleado = await getEmpleadoModel();
  const $set = {};
  if (typeof autoEnrolamiento === 'boolean') {
    $set['biometriaFacial.autoEnrolamiento'] = autoEnrolamiento;
  }
  if (typeof autoMejoraPlantilla === 'boolean') {
    $set['biometriaFacial.autoMejoraPlantilla'] = autoMejoraPlantilla;
  }
  if (distanceThreshold != null) {
    const th = Number(distanceThreshold);
    if (Number.isFinite(th) && th >= 0.45 && th <= 0.85) {
      $set['biometriaFacial.distanceThreshold'] = th;
    }
  }
  if (!Object.keys($set).length) {
    return { success: false, message: 'Sin cambios' };
  }
  const updated = await Empleado.findOneAndUpdate(
    { _id: empleadoId, tenantId },
    { $set },
    { new: true }
  )
    .select('biometriaFacial')
    .lean();
  if (!updated) return { success: false, message: 'Empleado no encontrado' };
  return { success: true, biometria: bioFlags(updated.biometriaFacial), raw: updated.biometriaFacial };
}

/**
 * Verifica liveness + match 1:1.
 * Si no hay plantilla y autoEnrolamiento está activo → enrola con los frames del reto.
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
  const flags = bioFlags(bio);

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

  // —— Autoenrolamiento ——
  if (!flags.enrolled) {
    if (!flags.autoEnrolamiento) {
      return {
        success: false,
        confidenceScore: 0,
        message: 'Sin rostro de referencia. Solicita el enroll en RRHH o pide que habiliten autoenrolamiento.'
      };
    }
    const enrolled = await enrollFromLivenessFrames({
      tenantId: auth.tenantId,
      empleadoId: auth.empleadoId,
      neutralFace,
      actionFace,
      enrolledBy: `auto:${auth.userId || 'app'}`
    });
    if (!enrolled.success) {
      return {
        success: false,
        confidenceScore: 0,
        message: enrolled.message,
        details: { purpose: 'enroll' }
      };
    }
    return {
      success: true,
      confidenceScore: enrolled.confidenceScore || 1,
      message: enrolled.message,
      details: {
        purpose: 'enroll',
        autoEnrolled: true,
        ...(enrolled.details || {}),
        liveness: live.metrics
      }
    };
  }

  const reference = normalizeEmbedding(bio.embedding);
  const storedTh = Number(bio.distanceThreshold);
  const threshold =
    Number.isFinite(storedTh) && storedTh >= 0.55 ? storedTh : MATCH_THRESHOLD;

  let match = bestMatch(
    [neutralFace.descriptor, actionFace.descriptor],
    reference,
    threshold
  );
  let usedFlip = false;

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
        usedFlip,
        purpose: 'verify'
      }
    };
  }

  let improve = { improved: false };
  try {
    improve = await maybeImproveTemplate({
      tenantId: auth.tenantId,
      empleadoId: auth.empleadoId,
      bio,
      probeDescriptors: [neutralFace.descriptor, actionFace.descriptor],
      matchDistance: match.distance,
      threshold,
      detectionScores: [neutralFace.score, actionFace.score]
    });
  } catch (err) {
    console.warn('[biometrics] autoMejora:', err.message);
  }

  return {
    success: true,
    confidenceScore: match.confidenceScore,
    message: improve.improved
      ? 'Identidad verificada. Plantilla facial actualizada (mejor calidad).'
      : 'Identidad y prueba de vida verificadas exitosamente',
    details: {
      purpose: 'verify',
      distance: match.distance,
      threshold,
      usedFlip,
      liveness: live.metrics,
      templateImproved: Boolean(improve.improved),
      improveReason: improve.reason || null
    }
  };
}

module.exports = {
  issueChallenge,
  enrollFromImage,
  enrollFromLivenessFrames,
  clearEnrollment,
  verifyLivenessAndMatch,
  getEmpleadoBiometria,
  updateBiometriaConfig,
  bioFlags,
  DEFAULT_FRAMES,
  ENROLL_MIN_SCORE
};
