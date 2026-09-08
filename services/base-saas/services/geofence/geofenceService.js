'use strict';

/**
 * Validación de geocerca para marcación móvil.
 * La decisión SIEMPRE es del backend (Haversine).
 */

const getPuntoAccesoModel = require('../../models/puntoAcceso');
const getAsignacionPuntoAccesoModel = require('../../models/asignacionPuntoAcceso');
const getSubsidiariaModel = require('../../models/subsidiaria');
const {
  POLITICAS_MARCAJE_GEO,
  DEFAULT_POLITICA_MARCAJE_GEO
} = require('../../config/asistencia');

const EARTH_RADIUS_M = 6371e3;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function siteFromPunto(p) {
  return {
    id: String(p._id),
    source: 'punto_acceso',
    nombre: p.nombre,
    codigo: p.codigo || '',
    lat: Number(p.lat),
    lng: Number(p.lng),
    radioMetros: Number(p.radioMetros) || 120,
    subsidiariaId: p.subsidiariaId ? String(p.subsidiariaId) : null
  };
}

function siteFromSubsidiaria(s) {
  if (s.lat == null || s.lng == null) return null;
  const radio = Number(s.geocercaRadioMetros);
  if (!Number.isFinite(radio) || radio <= 0) return null;
  return {
    id: `sub:${s._id}`,
    source: 'subsidiaria',
    nombre: s.nombre,
    codigo: s.codigo || '',
    lat: Number(s.lat),
    lng: Number(s.lng),
    radioMetros: radio,
    subsidiariaId: String(s._id)
  };
}

/**
 * Resuelve sitios candidatos según política del empleado.
 */
async function resolveCandidateSites({ tenantId, empleado, at = new Date() }) {
  const politica = empleado.marcajePoliticaGeo || DEFAULT_POLITICA_MARCAJE_GEO;
  const PuntoAcceso = await getPuntoAccesoModel();
  const Asignacion = await getAsignacionPuntoAccesoModel();
  const Subsidiaria = await getSubsidiariaModel();

  const sites = [];
  const pushUnique = (site) => {
    if (!site) return;
    if (sites.some((s) => s.id === site.id)) return;
    sites.push(site);
  };

  if (politica === 'disabled') {
    return { politica, sites: [] };
  }

  if (politica === 'any_catalog_site') {
    const puntos = await PuntoAcceso.find({ tenantId, activo: true }).lean();
    puntos.forEach((p) => pushUnique(siteFromPunto(p)));
    // Incluir subsidiarias con geocerca configurada
    const subs = await Subsidiaria.find({
      empresaId: empleado.empresaId,
      activo: true,
      lat: { $ne: null },
      lng: { $ne: null }
    }).lean();
    for (const s of subs) pushUnique(siteFromSubsidiaria(s));
    return { politica, sites };
  }

  // strict_assignment | open_with_flag | subsidiaria_default
  // 1) Asignaciones temporales vigentes
  const asignaciones = await Asignacion.find({
    tenantId,
    empleadoId: empleado._id,
    activo: true,
    validFrom: { $lte: at },
    $or: [{ validTo: null }, { validTo: { $gte: at } }]
  })
    .select('puntoAccesoId')
    .lean();

  if (asignaciones.length) {
    const ids = asignaciones.map((a) => a.puntoAccesoId);
    const puntos = await PuntoAcceso.find({
      _id: { $in: ids },
      tenantId,
      activo: true
    }).lean();
    puntos.forEach((p) => pushUnique(siteFromPunto(p)));
  }

  // 2) Puntos fijos en ficha del empleado
  const fijos = Array.isArray(empleado.puntoAccesoIds) ? empleado.puntoAccesoIds : [];
  if (fijos.length) {
    const puntos = await PuntoAcceso.find({
      _id: { $in: fijos },
      tenantId,
      activo: true
    }).lean();
    puntos.forEach((p) => pushUnique(siteFromPunto(p)));
  }

  // 3) Geocerca de la subsidiaria del empleado
  if (empleado.subsidiariaId) {
    const sub = await Subsidiaria.findById(empleado.subsidiariaId).lean();
    if (sub) pushUnique(siteFromSubsidiaria(sub));
  }

  // strict: solo lo asignado (si no hay nada, sites vacío → bloquear o avisar)
  // open_with_flag / subsidiaria_default: mismos candidatos
  return { politica, sites };
}

/**
 * @returns {{
 *   allowed: boolean,
 *   fueraDeZona: boolean,
 *   skipped: boolean,
 *   reason?: string,
 *   match?: object,
 *   politica: string,
 *   distanceMeters?: number,
 *   candidatesChecked: number
 * }}
 */
async function validatePunchLocation({
  tenantId,
  empleado,
  lat,
  lng,
  accuracyMeters = null,
  isMocked = false,
  at = new Date(),
  justificacionFueraZona = ''
}) {
  if (isMocked) {
    return {
      allowed: false,
      fueraDeZona: true,
      skipped: false,
      politica: empleado.marcajePoliticaGeo || DEFAULT_POLITICA_MARCAJE_GEO,
      reason: 'Ubicación simulada (Fake GPS) no permitida',
      candidatesChecked: 0,
      isMocked: true
    };
  }

  const { politica, sites } = await resolveCandidateSites({ tenantId, empleado, at });

  if (politica === 'disabled') {
    return {
      allowed: true,
      fueraDeZona: false,
      skipped: true,
      politica,
      reason: 'Validación geocerca desactivada',
      candidatesChecked: 0
    };
  }

  if (!sites.length) {
    // Sin catálogo/asignación: no bloquear (evita romper tenants sin geocercas)
    return {
      allowed: true,
      fueraDeZona: false,
      skipped: true,
      politica,
      reason: 'Sin geocercas configuradas para este empleado',
      candidatesChecked: 0
    };
  }

  let best = null;
  for (const site of sites) {
    const distanceMeters = haversineMeters(lat, lng, site.lat, site.lng);
    const effectiveRadius = site.radioMetros;
    // Tolerancia suave por imprecisión GPS (no ampliar más del 50% del radio)
    const accuracyBonus =
      accuracyMeters != null && accuracyMeters > 0
        ? Math.min(accuracyMeters, site.radioMetros * 0.5)
        : 0;
    const inside = distanceMeters <= effectiveRadius + accuracyBonus;
    const row = {
      ...site,
      distanceMeters: Math.round(distanceMeters * 10) / 10,
      effectiveRadius: Math.round((effectiveRadius + accuracyBonus) * 10) / 10,
      inside
    };
    if (!best || row.distanceMeters < best.distanceMeters) best = row;
  }

  const match = best && best.inside ? best : null;
  const fueraDeZona = !match;

  if (!fueraDeZona) {
    return {
      allowed: true,
      fueraDeZona: false,
      skipped: false,
      politica,
      match,
      distanceMeters: match.distanceMeters,
      candidatesChecked: sites.length
    };
  }

  // Fuera de zona
  if (politica === 'open_with_flag') {
    return {
      allowed: true,
      fueraDeZona: true,
      skipped: false,
      politica,
      match: best,
      distanceMeters: best?.distanceMeters,
      reason: 'Fuera de geocerca (registrado con bandera)',
      justificacionFueraZona: String(justificacionFueraZona || '').trim().slice(0, 300),
      candidatesChecked: sites.length
    };
  }

  // strict_assignment | any_catalog_site | subsidiaria_default → bloquear
  return {
    allowed: false,
    fueraDeZona: true,
    skipped: false,
    politica,
    match: best,
    distanceMeters: best?.distanceMeters,
    reason: best
      ? `Fuera de zona: a ${best.distanceMeters} m de «${best.nombre}» (radio ${best.radioMetros} m)`
      : 'Fuera de las geocercas autorizadas',
    candidatesChecked: sites.length
  };
}

module.exports = {
  haversineMeters,
  resolveCandidateSites,
  validatePunchLocation,
  POLITICAS_MARCAJE_GEO,
  DEFAULT_POLITICA_MARCAJE_GEO
};
