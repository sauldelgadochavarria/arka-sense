'use strict';

const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');

function asJpegBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    return buf.length ? buf : null;
  }
  if (value._bsontype === 'Binary' || typeof value.value === 'function') {
    const raw = typeof value.value === 'function' ? value.value(true) : value.buffer;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    return buf.length ? buf : null;
  }
  if (Array.isArray(value.data)) {
    const buf = Buffer.from(value.data);
    return buf.length ? buf : null;
  }
  return null;
}

/**
 * Parecido 0–100 entre la foto guardada y una foto de la checada.
 * SimilarityThreshold 0 para recibir el número aunque sea bajo.
 */
async function compareFacesAws({ region, accessKeyId, secretAccessKey, sourceBytes, targetBytes }) {
  const source = asJpegBuffer(sourceBytes);
  const target = asJpegBuffer(targetBytes);
  if (!source || !target) {
    return { similarity: 0, error: 'Falta una de las fotos para comparar' };
  }
  const client = new RekognitionClient({
    region: region || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey }
  });
  const out = await client.send(
    new CompareFacesCommand({
      SourceImage: { Bytes: source },
      TargetImage: { Bytes: target },
      SimilarityThreshold: 0
    })
  );
  const match = (out.FaceMatches || [])[0];
  return { similarity: match ? Number(match.Similarity) || 0 : 0 };
}

module.exports = { compareFacesAws, asJpegBuffer };
