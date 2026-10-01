'use strict';

/**
 * Rellena empleado.nombreSat desde:
 *  1) histórico de recibos (empleado.nombre del snapshot CFDI)
 *  2) staging de cargas CFDI (payload.empleado.nombre)
 *
 * Uso:
 *   node scripts/_backfill-empleado-nombre-sat.js
 *   node scripts/_backfill-empleado-nombre-sat.js --force   # sobrescribe aunque ya tenga valor
 *   node scripts/_backfill-empleado-nombre-sat.js --dry
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');

function normNombre(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function keyEmp(emp = {}) {
  const rfc = String(emp.rfc || '')
    .trim()
    .toUpperCase();
  const curp = String(emp.curp || '')
    .trim()
    .toUpperCase();
  const nss = String(emp.nss || '')
    .trim()
    .replace(/\D/g, '');
  const num = String(emp.numEmpleado || '')
    .trim()
    .toUpperCase();
  if (rfc && rfc.length >= 12) return `rfc:${rfc}`;
  if (curp && curp.length === 18) return `curp:${curp}`;
  if (nss && nss.length >= 10) return `nss:${nss}`;
  if (num) return `num:${num}`;
  return '';
}

(async () => {
  const getEmpleado = require('../models/empleado');
  const getHistorico = require('../models/nominaHistoricoRecibo');
  const getStaging = require('../models/cargaCfdiStaging');
  const Empleado = await getEmpleado();
  const Historico = await getHistorico();
  const Staging = await getStaging();

  /** empleadoId -> { nombre, at } */
  const byId = new Map();

  const histCursor = Historico.find({
    'empleado.nombre': { $exists: true, $nin: [null, ''] }
  })
    .select('empleadoId empleado.nombre createdAt updatedAt')
    .sort({ updatedAt: 1, createdAt: 1 })
    .cursor();

  let histHits = 0;
  for await (const h of histCursor) {
    const nombre = normNombre(h.empleado?.nombre);
    if (!nombre || !h.empleadoId) continue;
    histHits += 1;
    byId.set(String(h.empleadoId), {
      nombre,
      at: h.updatedAt || h.createdAt || new Date(0),
      src: 'historico'
    });
  }

  /** key rfc/curp/… -> { nombre, empresaId, at } */
  const byKey = new Map();
  const stgCursor = Staging.find({
    estatus: 'ok',
    'payload.empleado.nombre': { $exists: true, $nin: [null, ''] }
  })
    .select('empresaId tenantId payload.empleado createdAt')
    .sort({ createdAt: 1 })
    .cursor();

  let stgHits = 0;
  for await (const s of stgCursor) {
    const emp = s.payload?.empleado || {};
    const nombre = normNombre(emp.nombre);
    if (!nombre) continue;
    const k = keyEmp(emp);
    if (!k) continue;
    stgHits += 1;
    byKey.set(`${s.tenantId || ''}|${s.empresaId || ''}|${k}`, {
      nombre,
      at: s.createdAt || new Date(0),
      src: 'staging'
    });
  }

  const empQ = force
    ? {}
    : {
        $or: [{ nombreSat: { $exists: false } }, { nombreSat: null }, { nombreSat: '' }]
      };

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const samples = [];

  const empCursor = Empleado.find(empQ)
    .select('_id tenantId empresaId numEmpleado rfc curp nss nombreSat firstName lastName')
    .cursor();

  for await (const e of empCursor) {
    scanned += 1;
    let pick = byId.get(String(e._id)) || null;

    if (!pick) {
      const keys = [
        keyEmp({ rfc: e.rfc }),
        keyEmp({ curp: e.curp }),
        keyEmp({ nss: e.nss }),
        keyEmp({ numEmpleado: e.numEmpleado })
      ].filter(Boolean);
      for (const k of keys) {
        const hit = byKey.get(`${e.tenantId}|${e.empresaId}|${k}`);
        if (hit && (!pick || hit.at >= pick.at)) pick = hit;
      }
    }

    if (!pick?.nombre) {
      skipped += 1;
      continue;
    }
    if (!force && normNombre(e.nombreSat) === pick.nombre) {
      skipped += 1;
      continue;
    }
    if (!force && normNombre(e.nombreSat)) {
      skipped += 1;
      continue;
    }

    if (!dry) {
      await Empleado.updateOne({ _id: e._id }, { $set: { nombreSat: pick.nombre } });
    }
    updated += 1;
    if (samples.length < 12) {
      samples.push({
        num: e.numEmpleado,
        de: e.nombreSat || `${e.firstName || ''} ${e.lastName || ''}`.trim(),
        a: pick.nombre,
        src: pick.src
      });
    }
  }

  console.log({
    dry,
    force,
    histHits,
    stgHits,
    scanned,
    updated,
    skipped,
    samples
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
