'use strict';

/**
 * Infiere código motor PayPilot a partir de clave SAT (+ tipo + nombre CFDI).
 * Preferencia: override por subsidiaria → mapa canónico ley/prestaciones → concept_catalog.
 */

const {
  SAT_MOTOR_UNICO,
  SAT_MOTOR_AMBIGUO,
  CODIGOS_MOTOR_CONOCIDOS,
  padClaveSat,
  mapKey
} = require('../../config/satConceptoMotorMap');

let catalogIndexPromise = null;

async function loadCatalogIndex() {
  if (catalogIndexPromise) return catalogIndexPromise;
  catalogIndexPromise = (async () => {
    const byKey = new Map();
    try {
      const getConceptCatalogModel = require('../../models/conceptCatalog');
      const Catalog = await getConceptCatalogModel();
      const rows = await Catalog.find({ activo: true })
        .select('codigo nombre tipo claveSAT sat')
        .lean();
      for (const r of rows) {
        const clave = padClaveSat(r.claveSAT || r.sat?.clave);
        const tipo = String(r.sat?.tipo || r.tipo || '').toLowerCase();
        if (!clave || !tipo) continue;
        const key = mapKey(tipo, clave);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({
          codigo: String(r.codigo).toUpperCase(),
          nombre: r.nombre || ''
        });
      }
    } catch (err) {
      console.warn('[satConceptoInfer] catalog:', err.message);
    }
    return byKey;
  })();
  return catalogIndexPromise;
}

function matchNombreOverride(pattern, nombre) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  const n = String(nombre || '');
  if (p.startsWith('/') && p.lastIndexOf('/') > 0) {
    try {
      const last = p.lastIndexOf('/');
      const body = p.slice(1, last);
      const flags = p.slice(last + 1) || 'i';
      return new RegExp(body, flags).test(n);
    } catch (_) {
      return false;
    }
  }
  return n.toUpperCase().includes(p.toUpperCase());
}

function pickAmbiguo(candidates, nombre) {
  const n = String(nombre || '');
  const matched = candidates.find((c) => c.match && c.match.test(n));
  if (matched) return matched;
  return candidates.find((c) => c.default) || candidates[0] || null;
}

function pickOverride(overrides, nombre) {
  if (!overrides.length) return null;
  const withMatch = overrides.filter((o) => String(o.matchNombre || '').trim());
  for (const o of withMatch) {
    if (matchNombreOverride(o.matchNombre, nombre)) return o;
  }
  return overrides.find((o) => o.esDefault !== false && !String(o.matchNombre || '').trim()) || null;
}

/**
 * @param {object} line
 * @param {{ tenantId?: string, empresaId?: *, subsidiariaId?: * }} [scope]
 */
async function inferCodigoMotorFromSat(line = {}, scope = {}) {
  const claveInterna = String(line.claveInterna || line.conceptoCodigo || '')
    .trim()
    .toUpperCase();
  const codigoActual = String(line.conceptoCodigo || '')
    .trim()
    .toUpperCase();
  const claveSat = padClaveSat(line.claveSat || line.tipoSat);
  const tipo = String(line.tipo || '').toLowerCase();
  const nombre = line.nombre || '';

  if (codigoActual && CODIGOS_MOTOR_CONOCIDOS.has(codigoActual)) {
    return {
      codigo: codigoActual,
      inferred: false,
      source: 'already_motor',
      claveSat,
      claveInterna: claveInterna || codigoActual
    };
  }

  if (scope.tenantId && scope.empresaId && claveSat && tipo) {
    try {
      const { findOverrideCandidates } = require('./satConceptoMotorMapService');
      const overrides = await findOverrideCandidates({
        tenantId: scope.tenantId,
        empresaId: scope.empresaId,
        subsidiariaId: scope.subsidiariaId || null,
        tipo,
        claveSat
      });
      const hit = pickOverride(overrides, nombre);
      if (hit) {
        return {
          codigo: String(hit.conceptoCodigo).toUpperCase(),
          inferred: true,
          categoria: 'override',
          source: 'sub_override',
          claveSat,
          claveInterna
        };
      }
    } catch (err) {
      console.warn('[satConceptoInfer] override:', err.message);
    }
  }

  const key = mapKey(tipo, claveSat);
  if (!key) {
    return {
      codigo: codigoActual || claveInterna || 'SIN_CLAVE',
      inferred: false,
      source: 'cfdi_clave',
      claveSat,
      claveInterna
    };
  }

  if (SAT_MOTOR_UNICO[key]) {
    const hit = SAT_MOTOR_UNICO[key];
    return {
      codigo: hit.codigo,
      inferred: true,
      categoria: hit.categoria,
      source: 'sat_map_unico',
      claveSat,
      claveInterna
    };
  }

  if (SAT_MOTOR_AMBIGUO[key]) {
    const hit = pickAmbiguo(SAT_MOTOR_AMBIGUO[key], nombre);
    if (hit) {
      return {
        codigo: hit.codigo,
        inferred: true,
        categoria: hit.categoria,
        source: 'sat_map_ambiguo',
        claveSat,
        claveInterna
      };
    }
  }

  const catalog = await loadCatalogIndex();
  const cats = catalog.get(key) || [];
  if (cats.length === 1) {
    return {
      codigo: cats[0].codigo,
      inferred: true,
      categoria: 'catalog',
      source: 'concept_catalog',
      claveSat,
      claveInterna
    };
  }
  if (cats.length > 1) {
    const n = String(nombre).toUpperCase();
    const byName = cats.find((c) => n && String(c.nombre).toUpperCase().includes(n.slice(0, 12)));
    const pick = byName || cats[0];
    return {
      codigo: pick.codigo,
      inferred: true,
      categoria: 'catalog',
      source: 'concept_catalog_multi',
      claveSat,
      claveInterna
    };
  }

  return {
    codigo: codigoActual || claveInterna || `SAT${claveSat}`,
    inferred: false,
    source: 'cfdi_clave',
    claveSat,
    claveInterna
  };
}

function normalizeClaveInterna(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function slugNombreConcepto(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

/**
 * Identidad del concepto en import CFDI: Clave del XML (no clave SAT).
 * Varias líneas pueden compartir TipoPercepcion=001 (sueldo vs séptimo día).
 */
function codigoIdentidadDesdeCfdi(line = {}) {
  const clave = normalizeClaveInterna(line.claveInterna);
  if (clave) return clave;
  const sat = padClaveSat(line.claveSat || line.tipoSat);
  const slug = slugNombreConcepto(line.nombre);
  if (sat && slug) return `SAT${sat}_${slug}`.slice(0, 40);
  const actual = normalizeClaveInterna(line.conceptoCodigo);
  if (actual) return actual;
  return sat ? `SAT${sat}` : 'SIN_CLAVE';
}

async function applyInferenciaSatAConcepto(line, scope = {}) {
  const inferred = await inferCodigoMotorFromSat(line, scope);
  // Por defecto la carga masiva conserva la Clave CFDI como código de concepto.
  // La inferencia SAT solo sugiere motor (sueldo/séptimo…) sin colapsar líneas distintas.
  const preferClave = scope.preferClaveInterna !== false;
  const codigoCatalogo = preferClave
    ? codigoIdentidadDesdeCfdi(line)
    : String(inferred.codigo || line.conceptoCodigo || '')
        .trim()
        .toUpperCase();

  line.conceptoCodigo = codigoCatalogo;
  line.codigoMotorSugerido = inferred.codigo || codigoCatalogo;
  if (inferred.claveSat) line.claveSat = inferred.claveSat;
  if (inferred.claveInterna && !line.claveInterna) line.claveInterna = inferred.claveInterna;
  line._satInfer = {
    ...inferred,
    codigo: codigoCatalogo,
    codigoMotor: inferred.codigo || codigoCatalogo
  };
  return line._satInfer;
}

function resetCatalogIndexCache() {
  catalogIndexPromise = null;
}

module.exports = {
  inferCodigoMotorFromSat,
  applyInferenciaSatAConcepto,
  codigoIdentidadDesdeCfdi,
  resetCatalogIndexCache,
  padClaveSat,
  mapKey
};
