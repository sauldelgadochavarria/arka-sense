'use strict';

/**
 * Adaptadores de almacenamiento: carpeta local o S3-compatible (Linode Object Storage).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { slugPath } = require('../config/gestionDocumentalCatalog');

function joinKey(...parts) {
  return parts
    .filter((p) => p != null && String(p).trim() !== '')
    .map((p) => String(p).replace(/^\/+|\/+$/g, '').replace(/\\/g, '/'))
    .join('/');
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

/* ─── Local ─── */

async function localPut({ rootPath, key, buffer }) {
  const full = path.join(rootPath, ...key.split('/'));
  await ensureDir(path.dirname(full));
  await fsp.writeFile(full, buffer);
  return { key, fullPath: full };
}

async function localGet({ rootPath, key }) {
  const full = path.join(rootPath, ...key.split('/'));
  return fsp.readFile(full);
}

async function localDelete({ rootPath, key }) {
  const full = path.join(rootPath, ...key.split('/'));
  try {
    await fsp.unlink(full);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function localExists({ rootPath, key }) {
  const full = path.join(rootPath, ...key.split('/'));
  try {
    await fsp.access(full, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function localList({ rootPath, prefix = '' }) {
  const base = path.join(rootPath, ...(prefix ? prefix.split('/') : []));
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs, relPath);
      else if (e.isFile()) {
        const st = await fsp.stat(abs);
        out.push({
          key: prefix ? joinKey(prefix, relPath) : relPath.replace(/\\/g, '/'),
          tamanio: st.size,
          updatedAt: st.mtime
        });
      }
    }
  }
  await walk(base, '');
  return out;
}

/* ─── S3 / Linode ─── */

function loadS3Client(cfg) {
  let S3Client;
  let PutObjectCommand;
  let GetObjectCommand;
  let DeleteObjectCommand;
  let ListObjectsV2Command;
  let HeadObjectCommand;
  try {
    ({
      S3Client,
      PutObjectCommand,
      GetObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
      HeadObjectCommand
    } = require('@aws-sdk/client-s3'));
  } catch {
    throw new Error(
      'Falta @aws-sdk/client-s3. Instálalo en el contenedor: npm install @aws-sdk/client-s3'
    );
  }
  if (!cfg.bucket) throw new Error('Bucket S3 requerido');
  if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('Access Key / Secret Key requeridos');

  const client = new S3Client({
    region: cfg.region || 'us-east-1',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: cfg.forcePathStyle !== false,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    }
  });

  return {
    client,
    bucket: cfg.bucket,
    prefix: cfg.prefix || '',
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand
  };
}

function s3FullKey(prefix, key) {
  return joinKey(prefix, key);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function s3Put(cfg, { key, buffer, contentType }) {
  const s = loadS3Client(cfg);
  await s.client.send(
    new s.PutObjectCommand({
      Bucket: s.bucket,
      Key: s3FullKey(s.prefix, key),
      Body: buffer,
      ContentType: contentType || 'application/octet-stream'
    })
  );
  return { key };
}

async function s3Get(cfg, { key }) {
  const s = loadS3Client(cfg);
  const resp = await s.client.send(
    new s.GetObjectCommand({ Bucket: s.bucket, Key: s3FullKey(s.prefix, key) })
  );
  return streamToBuffer(resp.Body);
}

async function s3Delete(cfg, { key }) {
  const s = loadS3Client(cfg);
  await s.client.send(
    new s.DeleteObjectCommand({ Bucket: s.bucket, Key: s3FullKey(s.prefix, key) })
  );
}

async function s3Exists(cfg, { key }) {
  const s = loadS3Client(cfg);
  try {
    await s.client.send(
      new s.HeadObjectCommand({ Bucket: s.bucket, Key: s3FullKey(s.prefix, key) })
    );
    return true;
  } catch {
    return false;
  }
}

async function s3List(cfg, { prefix = '' }) {
  const s = loadS3Client(cfg);
  const fullPrefix = s3FullKey(s.prefix, prefix);
  const out = [];
  let token;
  do {
    const resp = await s.client.send(
      new s.ListObjectsV2Command({
        Bucket: s.bucket,
        Prefix: fullPrefix ? `${fullPrefix}/`.replace(/\/\/+/g, '/') : undefined,
        ContinuationToken: token
      })
    );
    for (const obj of resp.Contents || []) {
      let key = obj.Key || '';
      if (s.prefix && key.startsWith(s.prefix)) {
        key = key.slice(s.prefix.length).replace(/^\//, '');
      }
      out.push({ key, tamanio: obj.Size || 0, updatedAt: obj.LastModified || null });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : null;
  } while (token);
  return out;
}

/**
 * @param {object} config Doc GestionDocumentalConfig (lean)
 */
function createStorageAdapter(config) {
  const proveedor = config.proveedor || 'local';
  if (proveedor === 'local') {
    const rootPath = config.local?.rootPath || '/data/documentos';
    return {
      proveedor: 'local',
      put: (args) => localPut({ rootPath, ...args }),
      get: (args) => localGet({ rootPath, ...args }),
      delete: (args) => localDelete({ rootPath, ...args }),
      exists: (args) => localExists({ rootPath, ...args }),
      list: (args) => localList({ rootPath, ...args })
    };
  }
  if (proveedor === 's3') {
    const s3 = config.s3 || {};
    return {
      proveedor: 's3',
      put: (args) => s3Put(s3, args),
      get: (args) => s3Get(s3, args),
      delete: (args) => s3Delete(s3, args),
      exists: (args) => s3Exists(s3, args),
      list: (args) => s3List(s3, args)
    };
  }
  throw new Error(`Proveedor de storage no soportado: ${proveedor}`);
}

function empresaRootSlug(config, empresa) {
  if (config.empresaSlug) return slugPath(config.empresaSlug);
  const name = empresa?.nombreComercial || empresa?.razonSocial || 'Empresa';
  return slugPath(name);
}

module.exports = {
  joinKey,
  createStorageAdapter,
  empresaRootSlug,
  slugPath
};
