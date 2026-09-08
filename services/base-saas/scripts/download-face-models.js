#!/usr/bin/env node
'use strict';

/**
 * Descarga pesos de @vladmandic/face-api a vendor/face-api-models.
 * Uso: node scripts/download-face-models.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'vendor', 'face-api-models');
const BASE =
  process.env.FACE_API_MODELS_URL ||
  'https://raw.githubusercontent.com/vladmandic/face-api/master/model';

const FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
  'face_expression_model-weights_manifest.json',
  'face_expression_model.bin'
];

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchBuffer(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const name of FILES) {
    const dest = path.join(OUT, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`[face-models] skip ${name}`);
      continue;
    }
    const url = `${BASE}/${name}`;
    console.log(`[face-models] download ${name}`);
    const buf = await fetchBuffer(url);
    fs.writeFileSync(dest, buf);
  }
  console.log(`[face-models] listo en ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
