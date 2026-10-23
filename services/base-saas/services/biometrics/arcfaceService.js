'use strict';

/**
 * Identidad con ArcFace (InsightFace buffalo_l / w600k_r50, 512-d).
 * La detección, los landmarks y la prueba de vida siguen en face-api.
 * El parecido es distancia de coseno: 0 es la misma foto, 1 es distinto.
 */

const fs = require('fs');
const path = require('path');
const canvas = require('canvas');

const MODEL_PATH =
  process.env.BIOMETRICS_ARCFACE_MODEL ||
  path.join(__dirname, '..', '..', 'vendor', 'arcface', 'w600k_r50.onnx');

const MODEL_VERSION = 'arcface-w600k-r50';
const INPUT_SIZE = 112;

/** Puntos de referencia de ArcFace para un rostro alineado de 112×112. */
const ARC_DST = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041]
];

let sessionPromise = null;
let session = null;

function fivePoints(landmarks) {
  const avg = (from, to) => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let i = from; i <= to; i += 1) {
      x += landmarks[i].x;
      y += landmarks[i].y;
      n += 1;
    }
    return [x / n, y / n];
  };
  return [
    avg(36, 41),
    avg(42, 47),
    [landmarks[30].x, landmarks[30].y],
    [landmarks[48].x, landmarks[48].y],
    [landmarks[54].x, landmarks[54].y]
  ];
}

function solve4(matrix, vector) {
  const m = matrix.map((row, i) => [...row, vector[i]]);
  const n = 4;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) {
      throw new Error('No se pudo alinear el rostro');
    }
    const swap = m[col];
    m[col] = m[pivot];
    m[pivot] = swap;
    const div = m[col][col];
    for (let c = col; c <= n; c += 1) m[col][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = m[r][col];
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

/** Similitud (escala, giro y traslación) que lleva los puntos del foto al molde de 112. */
function similaritySrcToDst(src, dst) {
  const ata = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  const atb = [0, 0, 0, 0];
  for (let i = 0; i < src.length; i += 1) {
    const x = src[i][0];
    const y = src[i][1];
    const rows = [
      [x, -y, 1, 0, dst[i][0]],
      [y, x, 0, 1, dst[i][1]]
    ];
    for (const row of rows) {
      for (let c = 0; c < 4; c += 1) {
        atb[c] += row[c] * row[4];
        for (let k = 0; k < 4; k += 1) ata[c][k] += row[c] * row[k];
      }
    }
  }
  return solve4(ata, atb);
}

function warpTo112(img, landmarks) {
  if (!landmarks || landmarks.length < 68) {
    throw new Error('Landmarks insuficientes para alinear el rostro');
  }
  const [a, b, tx, ty] = similaritySrcToDst(fivePoints(landmarks), ARC_DST);
  const out = canvas.createCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(a, b, -b, a, tx, ty);
  ctx.drawImage(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
}

function imageDataToNchw(imageData) {
  const hw = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * hw);
  const data = imageData.data;
  for (let i = 0; i < hw; i += 1) {
    const o = i * 4;
    input[i] = (data[o] - 127.5) / 127.5;
    input[hw + i] = (data[o + 1] - 127.5) / 127.5;
    input[2 * hw + i] = (data[o + 2] - 127.5) / 127.5;
  }
  return input;
}

function l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

async function ensureArcFace() {
  if (session) return session;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    if (!fs.existsSync(MODEL_PATH)) {
      throw new Error(
        `Modelo ArcFace ausente en ${MODEL_PATH}. Ejecuta: npm run biometrics:models`
      );
    }
    const ort = require('onnxruntime-node');
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu']
    });
    console.log(
      `[biometrics] ArcFace listo (${MODEL_VERSION}, in=${session.inputNames.join(',')}, out=${session.outputNames.join(',')})`
    );
    return session;
  })().catch((err) => {
    sessionPromise = null;
    session = null;
    throw err;
  });
  return sessionPromise;
}

async function embedArcFace(img, landmarks) {
  const current = await ensureArcFace();
  const ort = require('onnxruntime-node');
  const pixels = imageDataToNchw(warpTo112(img, landmarks));
  const inputName = current.inputNames[0];
  const tensor = new ort.Tensor('float32', pixels, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const output = await current.run({ [inputName]: tensor });
  const outName = current.outputNames[0];
  const raw = output[outName].data;
  const embedding = l2Normalize(raw);
  if (embedding.length !== 512) {
    throw new Error(`ArcFace devolvió ${embedding.length} valores, se esperaban 512`);
  }
  return embedding;
}

function cosineDistance(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 99;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!denom) return 99;
  const sim = Math.max(-1, Math.min(1, dot / denom));
  return 1 - sim;
}

module.exports = {
  ensureArcFace,
  embedArcFace,
  cosineDistance,
  MODEL_VERSION,
  MODEL_PATH
};
