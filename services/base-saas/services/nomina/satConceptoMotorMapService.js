'use strict';

const getSatConceptoMotorMapModel = require('../../models/satConceptoMotorMap');
const {
  SAT_MOTOR_UNICO,
  SAT_MOTOR_AMBIGUO,
  padClaveSat,
  mapKey
} = require('../../config/satConceptoMotorMap');

function buildSystemRows() {
  const rows = [];
  for (const [key, hit] of Object.entries(SAT_MOTOR_UNICO)) {
    const [tipo, claveSat] = key.split('|');
    rows.push({
      key,
      tipo,
      claveSat,
      conceptoCodigo: hit.codigo,
      categoria: hit.categoria || '',
      matchNombre: '',
      esDefault: true,
      source: 'sistema',
      overrideId: null,
      activo: true
    });
  }
  for (const [key, candidates] of Object.entries(SAT_MOTOR_AMBIGUO)) {
    const [tipo, claveSat] = key.split('|');
    for (const c of candidates) {
      rows.push({
        key,
        tipo,
        claveSat,
        conceptoCodigo: c.codigo,
        categoria: c.categoria || '',
        matchNombre: c.match ? String(c.match).replace(/^\/|\/[a-z]*$/gi, '') : '',
        matchRegex: c.match ? String(c.match) : '',
        esDefault: !!c.default,
        source: 'sistema',
        overrideId: null,
        activo: true,
        ambiguo: true
      });
    }
  }
  return rows;
}

async function listOverrides({ tenantId, empresaId, subsidiariaId = null }) {
  const MapModel = await getSatConceptoMotorMapModel();
  return MapModel.find({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    activo: true
  })
    .sort({ tipo: 1, claveSat: 1, esDefault: -1 })
    .lean();
}

/**
 * Mapa efectivo para UI: sistema + overrides de la sub (overrides ganan por tipo|clave[+match]).
 */
async function listMapaEfectivo({ tenantId, empresaId, subsidiariaId = null }) {
  const system = buildSystemRows();
  const overrides = tenantId && empresaId ? await listOverrides({ tenantId, empresaId, subsidiariaId }) : [];

  const byIdentity = new Map();
  for (const r of system) {
    const id = `${r.tipo}|${r.claveSat}|${String(r.matchNombre || '').toLowerCase()}|${r.conceptoCodigo}`;
    byIdentity.set(id, r);
  }

  // Overrides que reemplazan el default de una clave (sin match) o añaden filas
  const overrideKeys = new Set();
  for (const o of overrides) {
    const claveSat = padClaveSat(o.claveSat);
    const tipo = String(o.tipo || '').toLowerCase();
    const matchNombre = String(o.matchNombre || '');
    const id = `${tipo}|${claveSat}|${matchNombre.toLowerCase()}|${String(o.conceptoCodigo).toUpperCase()}`;
    overrideKeys.add(`${tipo}|${claveSat}`);
    byIdentity.set(id, {
      key: mapKey(tipo, claveSat),
      tipo,
      claveSat,
      conceptoCodigo: String(o.conceptoCodigo).toUpperCase(),
      categoria: 'override',
      matchNombre,
      esDefault: o.esDefault !== false,
      source: 'override',
      overrideId: String(o._id),
      activo: o.activo !== false,
      notas: o.notas || '',
      ambiguo: !!matchNombre
    });
  }

  // Si hay override default para una clave unívoca del sistema, ocultar el sistema default
  const rows = [...byIdentity.values()].filter((r) => {
    if (r.source !== 'sistema') return true;
    if (!r.esDefault) return true;
    const k = `${r.tipo}|${r.claveSat}`;
    const hasOverrideDefault = overrides.some(
      (o) =>
        String(o.tipo).toLowerCase() === r.tipo &&
        padClaveSat(o.claveSat) === r.claveSat &&
        o.esDefault !== false &&
        !String(o.matchNombre || '').trim()
    );
    return !hasOverrideDefault;
  });

  rows.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    if (a.claveSat !== b.claveSat) return a.claveSat.localeCompare(b.claveSat);
    if (!!a.esDefault !== !!b.esDefault) return a.esDefault ? -1 : 1;
    return String(a.conceptoCodigo).localeCompare(String(b.conceptoCodigo));
  });

  return { rows, overridesCount: overrides.length, overrideKeys: [...overrideKeys] };
}

async function upsertOverride({
  tenantId,
  empresaId,
  subsidiariaId = null,
  tipo,
  claveSat,
  conceptoCodigo,
  matchNombre = '',
  esDefault = true,
  notas = ''
}) {
  const MapModel = await getSatConceptoMotorMapModel();
  const t = String(tipo || '').toLowerCase();
  const k = padClaveSat(claveSat);
  const codigo = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  if (!tenantId || !empresaId || !['percepcion', 'deduccion', 'otro_pago'].includes(t) || !k || !codigo) {
    throw new Error('Datos incompletos: tipo, clave SAT y código motor son obligatorios');
  }
  const filter = {
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    tipo: t,
    claveSat: k,
    matchNombre: String(matchNombre || '').trim()
  };
  await MapModel.updateOne(
    filter,
    {
      $set: {
        conceptoCodigo: codigo,
        esDefault: esDefault !== false,
        activo: true,
        notas: String(notas || '').trim()
      },
      $setOnInsert: {
        tenantId,
        empresaId,
        subsidiariaId: subsidiariaId || null,
        tipo: t,
        claveSat: k,
        matchNombre: String(matchNombre || '').trim()
      }
    },
    { upsert: true }
  );
  return MapModel.findOne(filter).lean();
}

async function deleteOverride({ tenantId, empresaId, subsidiariaId = null, id }) {
  const MapModel = await getSatConceptoMotorMapModel();
  const q = { _id: id, tenantId, empresaId };
  if (subsidiariaId) q.subsidiariaId = subsidiariaId;
  else q.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];
  const r = await MapModel.deleteOne(q);
  return r.deletedCount > 0;
}

/**
 * Candidatos override activos para una línea CFDI (prioridad sobre mapa sistema).
 */
async function findOverrideCandidates({ tenantId, empresaId, subsidiariaId, tipo, claveSat }) {
  if (!tenantId || !empresaId || !tipo || !claveSat) return [];
  const MapModel = await getSatConceptoMotorMapModel();
  return MapModel.find({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    tipo: String(tipo).toLowerCase(),
    claveSat: padClaveSat(claveSat),
    activo: true
  })
    .sort({ esDefault: -1 })
    .lean();
}

module.exports = {
  buildSystemRows,
  listOverrides,
  listMapaEfectivo,
  upsertOverride,
  deleteOverride,
  findOverrideCandidates
};
