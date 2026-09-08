'use strict';

/**
 * Wrapper face-api (@vladmandic) + TensorFlow.js + canvas.
 * Modelos en vendor/face-api-models (scripts/download-face-models.js).
 */

const path = require('path');
const fs = require('fs');
const canvas = require('canvas');
const { Image, ImageData, loadImage } = canvas;

let faceapi;
let tf;
let readyPromise = null;
let isReady = false;
let lastError = null;

const MODEL_DIR = path.join(__dirname, '..', '..', 'vendor', 'face-api-models');
const MATCH_THRESHOLD = Number(process.env.BIOMETRICS_MATCH_THRESHOLD || 0.62);

const NEUTRAL_MIN = Number(process.env.BIOMETRICS_NEUTRAL_MIN || 0.28);
const HAPPY_MIN = Number(process.env.BIOMETRICS_HAPPY_MIN || 0.18);
const EXPR_DELTA_MIN = Number(process.env.BIOMETRICS_EXPR_DELTA_MIN || 0.06);
const LANDMARK_DRIFT_MIN = Number(process.env.BIOMETRICS_LANDMARK_DRIFT_MIN || 0.25);

async function ensureReady() {
  if (isReady) return;
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      let backend = 'tfjs-node';
      try {
        // eslint-disable-next-line global-require
        tf = require('@tensorflow/tfjs-node');
        await tf.ready();
        // eslint-disable-next-line global-require
        faceapi = require('@vladmandic/face-api');
      } catch (nativeErr) {
        console.warn('[biometrics] tfjs-node no disponible, usando WASM:', nativeErr.message);
        backend = 'wasm';
        // eslint-disable-next-line global-require
        faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
        tf = faceapi.tf;
        await tf.ready();
      }

      faceapi.env.monkeyPatch({ Canvas: canvas.Canvas, Image, ImageData });

      if (!fs.existsSync(path.join(MODEL_DIR, 'ssd_mobilenetv1_model-weights_manifest.json'))) {
        throw new Error(
          `Modelos face-api ausentes en ${MODEL_DIR}. Ejecuta: npm run biometrics:models`
        );
      }

      await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceExpressionNet.loadFromDisk(MODEL_DIR);
      isReady = true;
      lastError = null;
      console.log(`[biometrics] face-api listo (${backend})`);
    } catch (err) {
      lastError = err;
      isReady = false;
      readyPromise = null;
      throw err;
    }
  })();
  return readyPromise;
}

function getStatus() {
  return {
    ready: isReady,
    lastError: lastError ? String(lastError.message || lastError) : null,
    modelDir: MODEL_DIR,
    matchThreshold: MATCH_THRESHOLD
  };
}

async function bufferToImage(buffer) {
  if (!buffer || !buffer.length) throw new Error('Imagen vacía');
  return loadImage(buffer);
}

function expressionSumOf(det) {
  if (!det?.expressions) return 0;
  const e = det.expressions;
  return ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'].reduce(
    (s, k) => s + Number(e[k] || 0),
    0
  );
}

function mouthOpenRatio(landmarks) {
  if (!landmarks || landmarks.length < 68) return 0;
  const top = landmarks[62];
  const bottom = landmarks[66];
  const left = landmarks[48];
  const right = landmarks[54];
  const mouthH = Math.hypot(bottom.x - top.x, bottom.y - top.y);
  const mouthW = Math.hypot(right.x - left.x, right.y - left.y);
  return mouthW > 1 ? mouthH / mouthW : 0;
}

function topExpression(expr) {
  let best = 'neutral';
  let bestV = -1;
  for (const [k, v] of Object.entries(expr || {})) {
    if (v > bestV) {
      bestV = v;
      best = k;
    }
  }
  return { name: best, value: bestV };
}

function flipImageHorizontal(img) {
  const c = canvas.createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.translate(img.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  return c;
}

/**
 * Detecta rostro dominante. Sin recorte central (en móvil el JPEG no coincide con el óvalo).
 * Solo rota si NO hay rostro usable (no por expresiones ~0: eso destrozaba el match 1:1).
 */
async function analyzeFace(imageBuffer, { label = 'frame', flipHorizontal = false } = {}) {
  await ensureReady();
  let img = await bufferToImage(imageBuffer);

  const maxSide = 960;
  if (img.width > maxSide || img.height > maxSide) {
    const scale = maxSide / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = canvas.createCanvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    img = c;
  }

  if (flipHorizontal) {
    img = flipImageHorizontal(img);
  }

  async function detectOn(source) {
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
    return faceapi
      .detectAllFaces(source, options)
      .withFaceLandmarks()
      .withFaceExpressions()
      .withFaceDescriptors();
  }

  let detections = await detectOn(img);
  const uprightScore = detections[0]?.detection?.score || 0;

  // Solo rotar si no hay detección o el score es muy bajo.
  // Antes se rotaba por expressionSum~0 (típico en móvil) y el descriptor quedaba de lado → distancia ~0.8.
  if (!detections.length || uprightScore < 0.4) {
    for (const degrees of [90, 270, 180]) {
      const rad = (degrees * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const rw = Math.round(img.width * cos + img.height * sin);
      const rh = Math.round(img.width * sin + img.height * cos);
      const rotated = canvas.createCanvas(rw, rh);
      const ctx = rotated.getContext('2d');
      ctx.translate(rw / 2, rh / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      const dets = await detectOn(rotated);
      const rotScore = dets[0]?.detection?.score || 0;
      const better =
        dets.length && (!detections.length || rotScore > uprightScore + 0.08);
      if (better) {
        detections = dets;
        img = rotated;
        if (rotScore >= 0.55) break;
      }
    }
  }

  if (!detections.length) {
    return {
      ok: false,
      error: `No se detectó rostro en ${label}. Acércate a la cámara con buena luz.`
    };
  }

  if (detections.length > 1) {
    detections = [...detections].sort((a, b) => {
      const areaA = a.detection.box.width * a.detection.box.height;
      const areaB = b.detection.box.width * b.detection.box.height;
      return areaB - areaA;
    });
    const area0 = detections[0].detection.box.width * detections[0].detection.box.height;
    const area1 = detections[1].detection.box.width * detections[1].detection.box.height;
    if (area1 / area0 > 0.7) {
      return {
        ok: false,
        error: `Se detectó más de un rostro en ${label}. Evita espejos u otras personas detrás.`
      };
    }
    detections = [detections[0]];
  }

  const det = detections[0];
  const box = det.detection.box;
  const raw = det.expressions || {};
  const expressions = {
    neutral: Number(raw.neutral || 0),
    happy: Number(raw.happy || 0),
    sad: Number(raw.sad || 0),
    angry: Number(raw.angry || 0),
    fearful: Number(raw.fearful || 0),
    disgusted: Number(raw.disgusted || 0),
    surprised: Number(raw.surprised || 0)
  };
  const expressionSum = Object.values(expressions).reduce((s, v) => s + v, 0);
  const landmarks = det.landmarks.positions.map((p) => ({ x: p.x, y: p.y }));

  return {
    ok: true,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    expressions,
    expressionSum,
    expressionReliable: expressionSum >= 0.45,
    mouthOpen: mouthOpenRatio(landmarks),
    descriptor: Array.from(det.descriptor),
    landmarks,
    score: Number(det.detection.score || 0)
  };
}

function euclideanDistance(a, b) {
  if (!faceapi) throw new Error('face-api no inicializado');
  return faceapi.euclideanDistance(a, b);
}

/**
 * Liveness: usa expresiones si son confiables; si no, apertura de boca (landmarks).
 */
function evaluateLiveness(neutralFace, actionFace) {
  const reasons = [];
  const n = neutralFace.expressions;
  const a = actionFace.expressions;
  const nReliable = (neutralFace.expressionSum || 0) >= 0.45;
  const aReliable = (actionFace.expressionSum || 0) >= 0.45;

  if (neutralFace.score < 0.35 || actionFace.score < 0.35) {
    reasons.push('Rostro poco nítido; mejora la luz y acércate');
  }

  let neutralOk = false;
  if (nReliable) {
    const topN = topExpression(n);
    neutralOk =
      n.neutral >= NEUTRAL_MIN ||
      (n.happy < 0.35 && topN.name !== 'happy') ||
      (n.happy < 0.25 && topN.name === 'neutral');
  } else {
    // Expresiones ~0 (típico móvil/ángulo): exigir detección OK + boca no muy abierta
    neutralOk = neutralFace.score >= 0.4 && (neutralFace.mouthOpen || 0) < 0.5;
  }
  if (!neutralOk) {
    const topN = topExpression(n);
    reasons.push(
      `Expresión neutra insuficiente (neutral=${n.neutral.toFixed(2)}, happy=${n.happy.toFixed(2)}, top=${topN.name}, sum=${(neutralFace.expressionSum || 0).toFixed(2)})`
    );
  }

  const exprDelta = a.happy - n.happy;
  const mouthDelta = (actionFace.mouthOpen || 0) - (neutralFace.mouthOpen || 0);
  let happyOk = false;
  if (aReliable) {
    happyOk = a.happy >= HAPPY_MIN || exprDelta >= EXPR_DELTA_MIN;
  }
  if (!happyOk) {
    happyOk = mouthDelta >= 0.05 || (actionFace.mouthOpen || 0) >= 0.32;
  }
  if (!happyOk) {
    reasons.push(
      `Sonrisa insuficiente (happy=${a.happy.toFixed(2)}, Δexpr=${exprDelta.toFixed(2)}, Δboca=${mouthDelta.toFixed(2)}). Sonríe más en la 2.ª.`
    );
  }

  let landmarkDrift = 0;
  const len = Math.min(neutralFace.landmarks.length, actionFace.landmarks.length);
  for (let i = 0; i < len; i += 1) {
    const dx = neutralFace.landmarks[i].x - actionFace.landmarks[i].x;
    const dy = neutralFace.landmarks[i].y - actionFace.landmarks[i].y;
    landmarkDrift += Math.sqrt(dx * dx + dy * dy);
  }
  landmarkDrift /= Math.max(1, len);

  const changedEnough =
    exprDelta >= EXPR_DELTA_MIN * 0.5 ||
    mouthDelta >= 0.04 ||
    landmarkDrift >= LANDMARK_DRIFT_MIN * 0.4 ||
    happyOk;
  if (!changedEnough) {
    reasons.push('Poca diferencia entre las dos fotos; sonríe claro en la segunda');
  }

  const area1 = neutralFace.box.width * neutralFace.box.height;
  const area2 = actionFace.box.width * actionFace.box.height;
  const areaRatio = area1 > 0 ? area2 / area1 : 0;
  if (areaRatio < 0.4 || areaRatio > 2.5) {
    reasons.push('Cambio extremo de escala del rostro entre fotogramas');
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    reasons: unique,
    metrics: {
      exprDelta,
      mouthDelta,
      landmarkDrift,
      areaRatio,
      neutral: n.neutral,
      happy: a.happy,
      nSum: neutralFace.expressionSum,
      aSum: actionFace.expressionSum
    }
  };
}

function normalizeEmbedding(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function matchDescriptor(probe, reference, threshold = MATCH_THRESHOLD) {
  const p = normalizeEmbedding(probe);
  const r = normalizeEmbedding(reference);
  if (p.length < 64 || r.length < 64 || p.length !== r.length) {
    return { ok: false, error: 'Descriptor facial inválido o incompleto', distance: 99 };
  }
  const distance = euclideanDistance(p, r);
  const confidenceScore = Math.max(0, Math.min(1, 1 - distance));
  return {
    ok: distance <= threshold,
    distance,
    confidenceScore: Math.round(confidenceScore * 1000) / 1000,
    threshold
  };
}

/** Mejor distancia entre varios descriptores de sonda vs la plantilla. */
function bestMatch(probes, reference, threshold = MATCH_THRESHOLD) {
  let best = { ok: false, distance: 99, confidenceScore: 0, threshold };
  for (const probe of probes) {
    if (!probe) continue;
    const m = matchDescriptor(probe, reference, threshold);
    if (m.distance < best.distance) best = m;
  }
  return best;
}

module.exports = {
  ensureReady,
  getStatus,
  analyzeFace,
  evaluateLiveness,
  matchDescriptor,
  bestMatch,
  normalizeEmbedding,
  euclideanDistance,
  MATCH_THRESHOLD,
  NEUTRAL_MIN,
  HAPPY_MIN
};
