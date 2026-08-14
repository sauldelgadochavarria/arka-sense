'use strict';

/**
 * Política de descuentos voluntarios / CCT por concepto.
 *
 * empresa.nominaDescuentos = {
 *   items: [
 *     { conceptoCodigo, enTope30, base, ordenPrelacion, activo }
 *   ]
 * }
 *
 * Compat legado: cuotaSindicalEnTope30 / cuotaSindicalBase → item CUOTA_SINDICAL.
 */

const CONCEPTOS_GOBIERNO_TOPE30 = new Set(['INFONAVIT', 'FONACOT']);

const ITEM_DEFAULT = {
  enTope30: false,
  base: 'bruto',
  ordenPrelacion: 100,
  activo: true
};

function truthy(v) {
  return v === true || v === '1' || v === 'si' || v === 'true' || v === 1;
}

function normalizeBase(v) {
  return String(v || 'bruto').toLowerCase() === 'neto_fiscal' ? 'neto_fiscal' : 'bruto';
}

function normalizeItem(raw = {}) {
  const codigo = String(raw.conceptoCodigo || raw.codigo || '')
    .trim()
    .toUpperCase();
  if (!codigo) return null;
  const orden = Number(raw.ordenPrelacion);
  return {
    conceptoCodigo: codigo,
    enTope30: truthy(raw.enTope30),
    base: normalizeBase(raw.base),
    ordenPrelacion: Number.isFinite(orden) && orden > 0 ? orden : ITEM_DEFAULT.ordenPrelacion,
    activo: raw.activo === false || raw.activo === '0' || raw.activo === 'no' ? false : true
  };
}

/**
 * Normaliza política; migra campos flat legado a lista.
 */
function mergePoliticaDescuentos(partial = {}) {
  let items = [];
  if (Array.isArray(partial.items)) {
    items = partial.items.map(normalizeItem).filter(Boolean);
  } else if (Array.isArray(partial.politicas)) {
    items = partial.politicas.map(normalizeItem).filter(Boolean);
  }

  // Legado flat → CUOTA_SINDICAL
  if (!items.some((i) => i.conceptoCodigo === 'CUOTA_SINDICAL')) {
    const hasLegacy =
      partial.cuotaSindicalEnTope30 != null ||
      partial.cuotaSindicalBase != null ||
      Object.prototype.hasOwnProperty.call(partial, 'cuotaSindicalEnTope30');
    if (hasLegacy || items.length === 0) {
      // Si no hay items y no hay legado explícito, sembrar default sindical fuera del tope
      items.push(
        normalizeItem({
          conceptoCodigo: 'CUOTA_SINDICAL',
          enTope30: truthy(partial.cuotaSindicalEnTope30),
          base: partial.cuotaSindicalBase || 'bruto',
          ordenPrelacion: 100,
          activo: true
        })
      );
    }
  }

  // Deduplicar por código (último gana)
  const byCode = new Map();
  for (const it of items) byCode.set(it.conceptoCodigo, it);
  items = [...byCode.values()].sort(
    (a, b) => (a.ordenPrelacion || 100) - (b.ordenPrelacion || 100) || a.conceptoCodigo.localeCompare(b.conceptoCodigo)
  );

  const sindical = items.find((i) => i.conceptoCodigo === 'CUOTA_SINDICAL') || {
    ...ITEM_DEFAULT,
    conceptoCodigo: 'CUOTA_SINDICAL'
  };

  return {
    items,
    /** Compat lectura antigua */
    cuotaSindicalEnTope30: !!sindical.enTope30,
    cuotaSindicalBase: sindical.base || 'bruto'
  };
}

function getPoliticaConcepto(politicaEmpresa = {}, conceptoCodigo) {
  const pol = mergePoliticaDescuentos(politicaEmpresa);
  const code = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  const found = pol.items.find((i) => i.conceptoCodigo === code && i.activo !== false);
  if (found) return found;
  return {
    conceptoCodigo: code,
    ...ITEM_DEFAULT,
    enTope30: CONCEPTOS_GOBIERNO_TOPE30.has(code) ? true : ITEM_DEFAULT.enTope30
  };
}

/**
 * Empleado puede override solo para sindical hoy (`si`/`no`/`empresa`).
 * Para otros conceptos usa solo la lista empresa (salvo override genérico futuro).
 */
function resolveConceptoEnTope30(conceptoCodigo, empleadoCfg = {}, politicaEmpresa = {}) {
  const code = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  const item = getPoliticaConcepto(politicaEmpresa, code);

  if (code === 'CUOTA_SINDICAL') {
    const raw = empleadoCfg.cuotaSindicalEnTope30;
    if (raw === true || raw === 'si' || raw === '1' || raw === 1) return true;
    if (raw === false || raw === 'no' || raw === '0' || raw === 0) return false;
  }

  return !!item.enTope30;
}

function resolveConceptoBase(conceptoCodigo, empleadoCfg = {}, politicaEmpresa = {}) {
  const code = String(conceptoCodigo || '')
    .trim()
    .toUpperCase();
  if (code === 'CUOTA_SINDICAL') {
    const empBase = String(empleadoCfg.cuotaSindicalBase || '').toLowerCase();
    if (empBase === 'bruto' || empBase === 'neto_fiscal') return empBase;
  }
  return getPoliticaConcepto(politicaEmpresa, code).base || 'bruto';
}

/** Compat */
function resolveCuotaSindicalEnTope30(empleadoCfg = {}, politicaEmpresa = {}) {
  return resolveConceptoEnTope30('CUOTA_SINDICAL', empleadoCfg, politicaEmpresa);
}

/**
 * Parsea arrays del form de configuración.
 */
function parsePoliticaDescuentosFromBody(body = {}) {
  const codigos = [].concat(body.conceptoCodigo || []);
  const enTopes = [].concat(body.enTope30 || []);
  const bases = [].concat(body.base || []);
  const ordenes = [].concat(body.ordenPrelacion || []);
  const activos = [].concat(body.activoItem || []);
  const items = [];
  for (let i = 0; i < codigos.length; i += 1) {
    const codigo = String(codigos[i] || '')
      .trim()
      .toUpperCase();
    if (!codigo) continue;
    items.push({
      conceptoCodigo: codigo,
      enTope30: truthy(enTopes[i]),
      base: bases[i],
      ordenPrelacion: ordenes[i],
      activo: activos[i] == null || activos[i] === '' ? true : truthy(activos[i])
    });
  }
  return mergePoliticaDescuentos({ items });
}

module.exports = {
  ITEM_DEFAULT,
  CONCEPTOS_GOBIERNO_TOPE30,
  mergePoliticaDescuentos,
  getPoliticaConcepto,
  resolveConceptoEnTope30,
  resolveConceptoBase,
  resolveCuotaSindicalEnTope30,
  parsePoliticaDescuentosFromBody,
  normalizeItem
};
