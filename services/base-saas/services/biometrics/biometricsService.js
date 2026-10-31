'use strict';

const getEmpleadoModel = require('../../models/empleado');
const getTenantModel = require('../../models/tenant');
const { consumeChallenge, createChallenge } = require('./challengeStore');
const {
  ensureReady,
  analyzeFace,
  evaluateLiveness,
  normalizeEmbedding,
  MATCH_THRESHOLD
} = require('./faceApiService');
const { cosineDistance, MODEL_VERSION } = require('./arcfaceService');
const { compareFacesAws, asJpegBuffer } = require('./rekognitionService');

const VERIFY_FRAMES = [
  { id: 'frame_n1', instruction: 'Mira al frente, sin sonreír (rostro relajado)', step: 1 },
  { id: 'frame_n2', instruction: 'Mira al frente, sin sonreír (rostro relajado)', step: 1, silent: true },
  { id: 'frame_n3', instruction: 'Mira al frente, sin sonreír (rostro relajado)', step: 1, silent: true },
  { id: 'frame_action', instruction: 'Ahora sonríe un poco, sin necesidad de mostrar dientes', step: 2 }
];
const RELAXED_IDS = ['frame_n1', 'frame_n2', 'frame_n3'];
const RELAXED_BEST_MAX = 0.28;
const SMILE_PAIR_MAX = 0.78;

const ENROLL_FRAMES = [
  { id: 'frame_e1', instruction: 'Mira al frente, rostro relajado', step: 1 },
  { id: 'frame_e2', instruction: 'Mira al frente, rostro relajado', step: 1, silent: true },
  { id: 'frame_e3', instruction: 'Mira al frente, rostro relajado', step: 1, silent: true },
  { id: 'frame_e4', instruction: 'Ahora sonríe un poco, sin mostrar dientes', step: 2 },
  { id: 'frame_e5', instruction: 'Ahora sonríe un poco, sin mostrar dientes', step: 2, silent: true },
  { id: 'frame_e6', instruction: 'Ahora sonríe un poco, sin mostrar dientes', step: 2, silent: true }
];

const ENROLL_MIN_SCORE = Number(process.env.BIOMETRICS_ENROLL_MIN_SCORE || 0.52);
const ENROLL_MIN_SAMPLES = 5;
const ENROLL_SAME_PERSON = Number(process.env.BIOMETRICS_ENROLL_SAME_PERSON || 0.45);
const ADD_MAX_WORST = Number(process.env.BIOMETRICS_ADD_MAX_WORST || 0.32);
const ADD_MIN_NOVELTY = Number(process.env.BIOMETRICS_ADD_MIN_NOVELTY || 0.1);
const GALLERY_CAP = 8;
const IMPROVE_COOLDOWN_MS = Number(process.env.BIOMETRICS_IMPROVE_COOLDOWN_MS || 2 * 60 * 1000);

async function motorBiometria(tenantId) {
  const Tenant = await getTenantModel();
  const tenant = await Tenant.findOne({ tenantId }).select('featureFlags biometria').lean();
  const licensed = tenant?.featureFlags?.biometria_aws === true;
  const cfg = tenant?.biometria || {};
  const aws = cfg.aws || {};
  const similarityMin = Number(aws.similarityMin);
  return {
    proveedor: licensed && cfg.proveedor === 'aws' ? 'aws' : 'local',
    aws: {
      region: String(aws.region || 'us-east-1').trim() || 'us-east-1',
      accessKeyId: String(aws.accessKeyId || '').trim(),
      secretAccessKey: String(aws.secretAccessKey || ''),
      similarityMin: Number.isFinite(similarityMin) ? Math.min(99, Math.max(50, similarityMin)) : 90
    }
  };
}

async function issueChallenge(auth) {
  await ensureReady();
  const emp = await getEmpleadoBiometria(auth.tenantId, auth.empleadoId);
  const bio = emp?.biometriaFacial || {};
  const enrolling = !bioFlags(bio).enrolled;
  return createChallenge({
    tenantId: auth.tenantId,
    userId: auth.userId,
    empleadoId: auth.empleadoId,
    requiredFrames: enrolling ? ENROLL_FRAMES : VERIFY_FRAMES,
    ttlMs: enrolling ? 180_000 : 240_000
  });
}

async function getEmpleadoBiometria(tenantId, empleadoId) {
  const Empleado = await getEmpleadoModel();
  const emp = await Empleado.findOne({ _id: empleadoId, tenantId })
    .select('firstName lastName apellidoPaterno apellidoMaterno numEmpleado biometriaFacial')
    .lean();
  return emp;
}

function etiquetaEmpleado(emp) {
  if (!emp) return 'la sesión actual';
  const nombre = [emp.firstName, emp.apellidoPaterno || emp.lastName, emp.apellidoMaterno]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = nombre || 'la sesión actual';
  return emp.numEmpleado ? `${base} (${emp.numEmpleado})` : base;
}

function isArcFaceTemplate(bio = {}) {
  return (
    Boolean(bio.enrolled) &&
    String(bio.modelVersion || '').startsWith('arcface') &&
    normalizeEmbedding(bio.embedding).length === 512
  );
}

function bioFlags(bio = {}) {
  const enrolled = isArcFaceTemplate(bio);
  const legacy = Boolean(bio.enrolled) && !enrolled;
  const autoEnrolamiento = Boolean(bio.autoEnrolamiento);
  const autoMejoraPlantilla = bio.autoMejoraPlantilla !== false;
  return {
    enrolled,
    legacy,
    autoEnrolamiento,
    autoMejoraPlantilla,
    canSelfEnroll: autoEnrolamiento && !enrolled,
    canChallenge: enrolled || autoEnrolamiento
  };
}

function nearestGalleryDistance(probe, gallery) {
  const p = l2Normalize(probe);
  let nearest = 99;
  if (p.length !== 512) return nearest;
  for (const ref of gallery || []) {
    const r = l2Normalize(ref);
    if (r.length !== 512) continue;
    const d = cosineDistance(p, r);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

function l2Normalize(vec) {
  const arr = normalizeEmbedding(vec);
  if (!arr.length) return [];
  let sumSq = 0;
  for (const v of arr) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1;
  return arr.map((v) => v / norm);
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
        'biometriaFacial.modelVersion': MODEL_VERSION,
        'biometriaFacial.embedding': embedding,
        'biometriaFacial.muestras': [{ pose: 'frente', embedding, addedAt: new Date() }],
        'biometriaFacial.distanceThreshold': MATCH_THRESHOLD,
        'biometriaFacial.detectionScore': face.score,
        'biometriaFacial.samplesCount': 1,
        'biometriaFacial.referenciaJpeg': imageBuffer,
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

const ENROLL_SHOTS = [
  ['frame_e1', 'frente', 'de frente'],
  ['frame_e2', 'frente_2', 'de frente'],
  ['frame_e3', 'frente_3', 'de frente'],
  ['frame_e4', 'sonrisa', 'sonrisa'],
  ['frame_e5', 'sonrisa_2', 'sonrisa'],
  ['frame_e6', 'sonrisa_3', 'sonrisa']
];

function plantillaGallery(bio = {}) {
  const out = [];
  const push = (vec) => {
    const n = normalizeEmbedding(vec);
    if (n.length === 512) out.push(n);
  };
  for (const m of bio.muestras || []) push(m?.embedding);
  push(bio.embedding);
  push(bio.embeddingNeutral);
  push(bio.embeddingAction);
  return out;
}

function nearestDistance(probe, gallery) {
  const p = l2Normalize(probe);
  let nearest = 99;
  for (const ref of gallery) {
    if (p.length !== ref.length) continue;
    const d = cosineDistance(p, ref);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/**
 * Registro en dos tomas visibles. Cada toma trae varias fotos seguidas.
 * Se guardan 5 o 6 si son la misma persona y tienen calidad suficiente.
 */
async function enrollFromPoses({ tenantId, empleadoId, facesById, buffersById, enrolledBy = 'auto-app' }) {
  const poses = [];
  let firstProblem = '';
  for (const [id, pose, label] of ENROLL_SHOTS) {
    const face = facesById[id];
    if (!face) continue;
    const q = qualityGate(face, label);
    if (!q.ok) {
      if (!firstProblem) firstProblem = q.message;
      continue;
    }
    const emb = l2Normalize(face.descriptor);
    if (emb.length !== 512) {
      if (!firstProblem) firstProblem = `No se pudo leer el rostro ${label}`;
      continue;
    }
    poses.push({ id, pose, emb, score: Number(face.score) || 0 });
  }

  if (poses.length < ENROLL_MIN_SAMPLES) {
    return {
      success: false,
      message: firstProblem || 'Faltan fotos nítidas. Acércate, con buena luz, y repite las dos tomas.'
    };
  }

  const fronts = poses.filter((p) => p.pose.startsWith('frente'));
  const pool = fronts.length ? fronts : poses;
  const anchor = pool.reduce((best, item) => (item.score > best.score ? item : best));
  const kept = poses.filter((p) => cosineDistance(p.emb, anchor.emb) <= ENROLL_SAME_PERSON);
  if (kept.length < ENROLL_MIN_SAMPLES) {
    return {
      success: false,
      message: 'Una de las fotos no parece la misma persona. Repite las dos tomas, mirando al frente.'
    };
  }

  const chosen = kept.slice(0, GALLERY_CAP);
  const ahora = new Date();
  const muestras = chosen.map((p) => ({ pose: p.pose, embedding: p.emb, addedAt: ahora }));
  const detectionScore = Math.min(...chosen.map((p) => p.score));
  const referencia = asJpegBuffer(buffersById?.[anchor.id]);
  const Empleado = await getEmpleadoModel();
  const updated = await Empleado.findOneAndUpdate(
    { _id: empleadoId, tenantId, 'biometriaFacial.autoEnrolamiento': true },
    {
      $set: {
        'biometriaFacial.enrolled': true,
        'biometriaFacial.enrolledAt': ahora,
        'biometriaFacial.enrolledBy': enrolledBy,
        'biometriaFacial.modelVersion': MODEL_VERSION,
        'biometriaFacial.embedding': anchor.emb,
        'biometriaFacial.embeddingNeutral': anchor.emb,
        'biometriaFacial.embeddingAction': [],
        'biometriaFacial.muestras': muestras,
        'biometriaFacial.distanceThreshold': MATCH_THRESHOLD,
        'biometriaFacial.detectionScore': detectionScore,
        'biometriaFacial.samplesCount': muestras.length,
        'biometriaFacial.referenciaJpeg': referencia || undefined,
        'biometriaFacial.lastAutoUpdateAt': null
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
    message: 'Rostro registrado. Ya puedes checar.',
    confidenceScore: Math.round(detectionScore * 1000) / 1000,
    details: {
      detectionScore,
      samplesCount: muestras.length
    }
  };
}

async function maybeImproveTemplate({
  tenantId,
  empleadoId,
  bio,
  probeDescriptors,
  matchDistance
}) {
  // Una pose extra acercó un rostro ajeno. No guardar más hasta tener la regla estable.
  return { improved: false, reason: 'paused' };
  if (!bio || bio.autoMejoraPlantilla === false) {
    return { improved: false, reason: 'disabled' };
  }
  const muestras = Array.isArray(bio.muestras) ? bio.muestras.filter((m) => m?.embedding?.length === 512) : [];
  if (muestras.length >= GALLERY_CAP) return { improved: false, reason: 'cap' };
  if (!(Number(matchDistance) <= ADD_MAX_WORST)) {
    return { improved: false, reason: 'distance' };
  }
  const last = bio.lastAutoUpdateAt ? new Date(bio.lastAutoUpdateAt).getTime() : 0;
  if (last && Date.now() - last < IMPROVE_COOLDOWN_MS) {
    return { improved: false, reason: 'cooldown' };
  }

  const gallery = plantillaGallery(bio);
  const frontal = l2Normalize(bio.embedding);
  let chosen = null;
  let novelty = 0;
  for (const probe of probeDescriptors || []) {
    const emb = l2Normalize(probe);
    const d = nearestDistance(probe, gallery);
    const dFront = frontal.length === 512 ? cosineDistance(emb, frontal) : d;
    if (d <= ADD_MAX_WORST && dFront <= 0.32 && d > novelty) {
      novelty = d;
      chosen = emb;
    }
  }
  if (!chosen || novelty < ADD_MIN_NOVELTY) {
    return { improved: false, reason: 'duplicate' };
  }

  const prevSamples = Math.max(muestras.length, Number(bio.samplesCount) || 1);
  const Empleado = await getEmpleadoModel();
  await Empleado.updateOne(
    { _id: empleadoId, tenantId, 'biometriaFacial.enrolled': true },
    {
      $push: {
        'biometriaFacial.muestras': {
          pose: 'extra',
          embedding: chosen,
          addedAt: new Date()
        }
      },
      $set: {
        'biometriaFacial.samplesCount': prevSamples + 1,
        'biometriaFacial.lastAutoUpdateAt': new Date()
      }
    }
  );
  return { improved: true, samplesCount: prevSamples + 1, novelty };
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
          embeddingNeutral: [],
          embeddingAction: [],
          muestras: [],
          distanceThreshold:
            Number.isFinite(th) && th >= 0.25 && th <= MATCH_THRESHOLD ? th : MATCH_THRESHOLD,
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
    if (Number.isFinite(th) && th >= 0.25 && th <= MATCH_THRESHOLD) {
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
async function verifyLivenessAndMatch({ auth, challengeId, frameNeutral, frameAction, frames }) {
  await ensureReady();

  const consumed = consumeChallenge(challengeId, {
    tenantId: auth.tenantId,
    userId: auth.userId,
    empleadoId: auth.empleadoId
  });
  if (!consumed.ok) {
    return { success: false, confidenceScore: 0, message: consumed.error };
  }

  const incoming = frames && typeof frames === 'object' ? { ...frames } : {};
  if (frameNeutral?.length) incoming.frame_neutral = frameNeutral;
  if (frameAction?.length) incoming.frame_action = frameAction;

  const emp = await getEmpleadoBiometria(auth.tenantId, auth.empleadoId);
  if (!emp) {
    return { success: false, confidenceScore: 0, message: 'Empleado no encontrado' };
  }
  const quien = etiquetaEmpleado(emp);
  const bio = emp.biometriaFacial || {};
  const flags = bioFlags(bio);

  if (!flags.enrolled) {
    if (!flags.autoEnrolamiento) {
      return {
        success: false,
        confidenceScore: 0,
        message: `Sin rostro de ${quien}. Pide a RRHH que habiliten el autoenrolamiento.`
      };
    }
    const received = ENROLL_SHOTS.filter(([id]) => incoming[id]?.length);
    if (received.length < ENROLL_MIN_SAMPLES) {
      return {
        success: false,
        confidenceScore: 0,
        message: 'Faltan fotos del registro. Vuelve a tomar las dos.'
      };
    }
    const analyzed = await Promise.all(
      received.map(async ([id]) => [id, await analyzeFace(incoming[id], { label: id })])
    );
    const enrolled = await enrollFromPoses({
      tenantId: auth.tenantId,
      empleadoId: auth.empleadoId,
      facesById: Object.fromEntries(analyzed),
      buffersById: Object.fromEntries(received.map(([id]) => [id, incoming[id]])),
      enrolledBy: `auto:${auth.userId || 'app'}`
    });
    if (!enrolled.success) {
      return {
        success: false,
        confidenceScore: 0,
        message: `${quien}: ${enrolled.message}`,
        details: { purpose: 'enroll' }
      };
    }
    return {
      success: false,
      confidenceScore: enrolled.confidenceScore || 1,
      message: `Rostro de ${quien} guardado. Eso no registra la checada. Ahora mira al frente y luego sonríe para comprobar que eres tú.`,
      details: {
        purpose: 'enroll',
        faceSaved: true,
        autoEnrolled: true,
        ...(enrolled.details || {})
      }
    };
  }

  const actionBuf = incoming.frame_action;
  if (RELAXED_IDS.some((id) => !incoming[id]?.length) || !actionBuf?.length) {
    return { success: false, confidenceScore: 0, message: 'Faltan las fotos de frente o la sonrisa' };
  }

  const relaxed = [];
  for (const id of RELAXED_IDS) {
    const face = await analyzeFace(incoming[id], { label: id });
    if (!face.ok) {
      return { success: false, confidenceScore: 0, message: face.error };
    }
    relaxed.push(face);
  }
  const actionFace = await analyzeFace(actionBuf, { label: 'frame_action' });
  if (!actionFace.ok) {
    return { success: false, confidenceScore: 0, message: actionFace.error };
  }

  const motor = await motorBiometria(auth.tenantId);
  let neutralFace;
  let identity = { proveedor: 'local' };

  if (motor.proveedor === 'aws') {
    if (!motor.aws.accessKeyId || !motor.aws.secretAccessKey) {
      return {
        success: false,
        confidenceScore: 0,
        message: 'AWS Rekognition no tiene claves en la configuración del tenant.'
      };
    }
    const referencia = asJpegBuffer(bio.referenciaJpeg);
    if (!referencia) {
      return {
        success: false,
        confidenceScore: 0,
        message: 'Este empleado no tiene foto de referencia para AWS. Hay que enrolar el rostro otra vez.'
      };
    }
    const sims = [];
    try {
      for (let i = 0; i < RELAXED_IDS.length; i += 1) {
        const compared = await compareFacesAws({
          ...motor.aws,
          sourceBytes: referencia,
          targetBytes: incoming[RELAXED_IDS[i]]
        });
        sims.push({ similarity: compared.similarity, face: relaxed[i] });
      }
    } catch (err) {
      return {
        success: false,
        confidenceScore: 0,
        message: `AWS Rekognition no pudo comparar las fotos: ${err.message || 'error'}`
      };
    }
    sims.sort((a, b) => b.similarity - a.similarity);
    const bestSim = sims[0].similarity;
    const simLabel = sims.map((row) => row.similarity.toFixed(0)).join(', ');
    neutralFace = sims[0].face;
    identity = {
      proveedor: 'aws',
      similarity: bestSim,
      similarities: sims.map((row) => row.similarity),
      threshold: motor.aws.similarityMin
    };
    if (bestSim < motor.aws.similarityMin) {
      return {
        success: false,
        confidenceScore: Math.max(0, bestSim / 100),
        message: `Verificación AWS: las tres fotos quedaron en ${simLabel}. La mejor tiene que llegar a ${motor.aws.similarityMin}.`,
        details: { stage: 'identity', purpose: 'verify', ...identity }
      };
    }
  } else {
    const frontal = l2Normalize(bio.embedding);
    if (frontal.length !== 512) {
      return { success: false, confidenceScore: 0, message: 'La foto de frente guardada no está completa' };
    }
    const scored = relaxed
      .map((face) => ({
        face,
        distance: cosineDistance(l2Normalize(face.descriptor), frontal)
      }))
      .sort((a, b) => a.distance - b.distance);
    const best = scored[0].distance;
    const median = scored[1].distance;
    const worst = scored[2].distance;
    neutralFace = scored[0].face;
    const distancesLabel = scored.map((row) => row.distance.toFixed(3)).join(', ');
    identity = {
      proveedor: 'local',
      distance: best,
      bestDistance: best,
      medianDistance: median,
      worstDistance: worst,
      frontalWorst: worst,
      threshold: RELAXED_BEST_MAX
    };
    if (best > RELAXED_BEST_MAX) {
      return {
        success: false,
        confidenceScore: Math.max(0, 1 - best),
        message: `Verificación de rostro: las tres fotos de frente quedaron a ${distancesLabel} de tu foto guardada. La mejor tiene que quedar en ${RELAXED_BEST_MAX} o menos.`,
        details: { stage: 'identity', purpose: 'verify', ...identity }
      };
    }
  }

  const pairDist = cosineDistance(
    l2Normalize(neutralFace.descriptor),
    l2Normalize(actionFace.descriptor)
  );
  if (pairDist > SMILE_PAIR_MAX) {
    return {
      success: false,
      confidenceScore: 0,
      message: `La sonrisa no coincide con las fotos de frente (${pairDist.toFixed(3)}). Tómalas seguidas, sin que entre otra persona.`,
      details: { stage: 'identity', pairDistance: pairDist, purpose: 'verify', ...identity }
    };
  }

  const live = evaluateLiveness(neutralFace, actionFace);
  if (!live.ok) {
    return {
      success: false,
      confidenceScore: 0,
      message: `Prueba de vida: ${live.reasons[0]}`,
      details: { stage: 'liveness', liveness: live.metrics, reasons: live.reasons, ...identity }
    };
  }

  const confidence = identity.proveedor === 'aws'
    ? Math.round((identity.similarity / 100) * 1000) / 1000
    : Math.max(0, Math.min(1, Math.round((1 - identity.distance) * 1000) / 1000));

  return {
    success: true,
    confidenceScore: confidence,
    message: identity.proveedor === 'aws'
      ? `Rostro de ${quien} verificado (AWS ${identity.similarity.toFixed(0)}).`
      : `Rostro de ${quien} verificado.`,
    details: {
      stage: 'identity',
      purpose: 'verify',
      pairDistance: pairDist,
      usedFlip: false,
      liveness: live.metrics,
      templateImproved: false,
      ...identity
    }
  };
}

module.exports = {
  issueChallenge,
  enrollFromImage,
  enrollFromPoses,
  clearEnrollment,
  verifyLivenessAndMatch,
  getEmpleadoBiometria,
  updateBiometriaConfig,
  bioFlags,
  etiquetaEmpleado,
  VERIFY_FRAMES,
  ENROLL_FRAMES,
  ENROLL_MIN_SCORE
};
