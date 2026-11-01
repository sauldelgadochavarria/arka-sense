'use strict';

/**
 * Validación de geocerca para marcación móvil.
 * La decisión SIEMPRE es del backend (Haversine).
 */

const getPuntoAccesoModel = require('../../models/puntoAcceso');
const getZonaModel = require('../../models/zona');
const getAsignacionPuntoAccesoModel = require('../../models/asignacionPuntoAcceso');
const getDepartamentoModel = require('../../models/departamento');
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
    subsidiariaId: p.subsidiariaId ? String(p.subsidiariaId) : null,
    zonaId: p.zonaId ? String(p.zonaId) : null
  };
}

async function loadDepartamento(empleado) {
  if (!empleado?.departamentoId) return null;
  const Departamento = await getDepartamentoModel();
  return Departamento.findById(empleado.departamentoId)
    .select('puntoAccesoIds marcajePoliticaGeo')
    .lean();
}

/** Vacío o «heredar» toma el interruptor del departamento. */
function politicaEfectiva(empleado, departamento) {
  const propia = String(empleado?.marcajePoliticaGeo || '').trim();
  if (!propia || propia === 'heredar') {
    const delDepto = String(departamento?.marcajePoliticaGeo || '').trim();
    if (delDepto === 'subsidiaria_default' || delDepto === 'open_with_flag' || delDepto === 'disabled') {
      return delDepto;
    }
    return 'open_with_flag';
  }
  return propia;
}

async function puntosActivos(PuntoAcceso, tenantId, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return [];
  return PuntoAcceso.find({ _id: { $in: list }, tenantId, activo: true }).lean();
}

/**
 * Ubicaciones candidatas.
 * 1) Asignación temporal y, si hay, ubicaciones del trabajador.
 * 2) Si el trabajador no tiene, las del departamento.
 * 3) Si el departamento tampoco, los puntos de su subsidiaria.
 * La subsidiaria ya no es una geocerca: el círculo vive en el punto de acceso.
 */
async function resolveCandidateSites({ tenantId, empleado, at = new Date() }) {
  const departamento = await loadDepartamento(empleado);
  const politica = politicaEfectiva(empleado, departamento);
  const PuntoAcceso = await getPuntoAccesoModel();
  const Asignacion = await getAsignacionPuntoAccesoModel();

  const sites = [];
  const pushUnique = (site) => {
    if (!site) return;
    if (sites.some((s) => s.id === site.id)) return;
    sites.push(site);
  };
  const pushPuntos = (puntos) => puntos.forEach((p) => pushUnique(siteFromPunto(p)));

  if (politica === 'disabled') {
    return { politica, sites: [] };
  }

  if (politica === 'any_catalog_site') {
    const q = { tenantId, activo: true };
    if (empleado?.empresaId) q.empresaId = empleado.empresaId;
    const puntos = await PuntoAcceso.find(q).lean();
    pushPuntos(puntos);
    return { politica, sites };
  }

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
    pushPuntos(
      await puntosActivos(
        PuntoAcceso,
        tenantId,
        asignaciones.map((a) => a.puntoAccesoId)
      )
    );
  }

  const fijos = Array.isArray(empleado.puntoAccesoIds) ? empleado.puntoAccesoIds : [];
  if (fijos.length) {
    pushPuntos(await puntosActivos(PuntoAcceso, tenantId, fijos));
    return { politica, sites };
  }

  if (politica === 'strict_assignment') {
    return { politica, sites };
  }

  const delDepto = Array.isArray(departamento?.puntoAccesoIds) ? departamento.puntoAccesoIds : [];
  if (delDepto.length) {
    pushPuntos(await puntosActivos(PuntoAcceso, tenantId, delDepto));
    return { politica, sites };
  }

  if (empleado.subsidiariaId) {
    const deLaPlaza = await PuntoAcceso.find({
      tenantId,
      activo: true,
      subsidiariaId: empleado.subsidiariaId
    }).lean();
    pushPuntos(deLaPlaza);
  }

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
      politica: politicaEfectiva(empleado, null),
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

async function etiquetaZona(tenantId, match) {
  if (!match?.zonaId) return { zonaId: null, zonaNombre: '' };
  const Zona = await getZonaModel();
  const zona = await Zona.findOne({ _id: match.zonaId, tenantId }).select('nombre').lean();
  if (!zona) return { zonaId: null, zonaNombre: '' };
  return { zonaId: zona._id, zonaNombre: zona.nombre || '' };
}

module.exports = {
  haversineMeters,
  resolveCandidateSites,
  validatePunchLocation,
  etiquetaZona,
  POLITICAS_MARCAJE_GEO,
  DEFAULT_POLITICA_MARCAJE_GEO
};
