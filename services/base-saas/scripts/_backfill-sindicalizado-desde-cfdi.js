#!/usr/bin/env node
'use strict';

/**
 * Rellena sindicalizado (Boolean) + tipoEmpleado desde XML CFDI guardados.
 *   node scripts/_backfill-sindicalizado-desde-cfdi.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { XMLParser } = require('fast-xml-parser');

const SUB_ID = '6abeeb4dc5a3517e2eb7aad2';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true
});

function readSindicalizado(xmlText) {
  try {
    const root = parser.parse(String(xmlText || ''));
    const walk = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.Sindicalizado != null) return String(node.Sindicalizado);
      if (node.Receptor && node.Receptor.Sindicalizado != null) {
        return String(node.Receptor.Sindicalizado);
      }
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') {
          const hit = walk(v);
          if (hit != null) return hit;
        }
      }
      return null;
    };
    return walk(root);
  } catch (_) {
    return null;
  }
}

function mapSind(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === 'sí' || s === 'si' || s === 'yes' || s === '1' || s === 'true') {
    return { sindicalizado: true, tipoEmpleado: 'sindicalizado' };
  }
  if (s === 'no' || s === '0' || s === 'false') {
    return { sindicalizado: false, tipoEmpleado: 'confianza' };
  }
  return null;
}

async function main() {
  await mongoose.connect(dbConfig.connectionStringConfig);
  const db = mongoose.connection.db;
  const subOid = new mongoose.Types.ObjectId(SUB_ID);
  const emps = await db
    .collection('empleados')
    .find({ subsidiariaId: subOid })
    .project({ _id: 1, firstName: 1, lastName: 1, tipoEmpleado: 1, sindicalizado: 1 })
    .toArray();

  let updated = 0;
  for (const e of emps) {
    const arch = await db
      .collection('nomina_cfdi_archivos')
      .find({ empleadoId: e._id, contenido: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    let mapped = null;
    for (const a of arch) {
      const buf = a.contenido;
      const xml =
        typeof buf === 'string'
          ? buf
          : Buffer.isBuffer(buf)
            ? buf.toString('utf8')
            : buf?.buffer
              ? Buffer.from(buf.buffer).toString('utf8')
              : '';
      mapped = mapSind(readSindicalizado(xml));
      if (mapped) break;
    }
    console.log(
      e.firstName,
      e.lastName,
      '→',
      mapped ? (mapped.sindicalizado ? 'Sí' : 'No') : '(sin dato en XML)',
      'archivos',
      arch.length
    );
    if (mapped) {
      await db.collection('empleados').updateOne({ _id: e._id }, { $set: mapped });
      updated += 1;
    }
  }
  console.log('actualizados', updated, '/', emps.length);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
