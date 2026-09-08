'use strict';

const getPuntoAccesoModel = require('../models/puntoAcceso');
const getSubsidiariaModel = require('../models/subsidiaria');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');

function parseCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRadio(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 10) return 120;
  return Math.min(5000, Math.round(n));
}

function buildPayload(body, empresaId) {
  const lat = parseCoord(body.lat);
  const lng = parseCoord(body.lng);
  return {
    empresaId,
    subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
    codigo: trimString(body.codigo).toUpperCase(),
    nombre: trimString(body.nombre),
    descripcion: trimString(body.descripcion),
    lat,
    lng,
    radioMetros: parseRadio(body.radioMetros)
  };
}

async function listPuntos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PuntoAcceso = await getPuntoAccesoModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [puntos, subsidiarias] = empresa
    ? await Promise.all([
        PuntoAcceso.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id }).sort({ nombre: 1 }).lean()
      ])
    : [[], []];

  const subMap = new Map(subsidiarias.map((s) => [String(s._id), s.nombre]));

  res.render('Configurations/puntos-acceso', {
    title: 'Puntos de acceso',
    puntos,
    subsidiarias,
    subMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createPunto(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-puntos-acceso');
    }
    const payload = buildPayload(req.body, empresa._id);
    if (!payload.nombre || payload.lat == null || payload.lng == null) {
      req.flash('error', 'Nombre, latitud y longitud son obligatorios');
      return res.redirect('/config-puntos-acceso');
    }
    if (Math.abs(payload.lat) > 90 || Math.abs(payload.lng) > 180) {
      req.flash('error', 'Coordenadas fuera de rango');
      return res.redirect('/config-puntos-acceso');
    }

    const PuntoAcceso = await getPuntoAccesoModel();
    await PuntoAcceso.create({
      tenantId: req.session.tenantId,
      ...payload,
      activo: true
    });
    req.flash('success', 'Punto de acceso creado');
    res.redirect('/config-puntos-acceso');
  } catch (err) {
    console.error('[puntos-acceso.create]', err);
    req.flash(
      'error',
      err.code === 11000 ? 'Ya existe un punto con ese código' : err.message || 'Error al crear'
    );
    res.redirect('/config-puntos-acceso');
  }
}

async function editPunto(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PuntoAcceso = await getPuntoAccesoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const punto = await findOneByTenant(PuntoAcceso, req.session.tenantId, req.params.id);
  if (!punto) return res.status(404).send('Punto no encontrado');

  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id }).sort({ nombre: 1 }).lean()
    : [];

  res.render('Configurations/punto-acceso-edit', {
    title: `Editar · ${punto.nombre}`,
    punto,
    subsidiarias,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updatePunto(req, res) {
  try {
    const PuntoAcceso = await getPuntoAccesoModel();
    const punto = await findOneDocByTenant(PuntoAcceso, req.session.tenantId, req.params.id);
    if (!punto) return res.status(404).send('Punto no encontrado');

    const payload = buildPayload(req.body, punto.empresaId);
    if (!payload.nombre || payload.lat == null || payload.lng == null) {
      req.flash('error', 'Nombre, latitud y longitud son obligatorios');
      return res.redirect(`/config-puntos-acceso/${req.params.id}/edit`);
    }

    punto.nombre = payload.nombre;
    punto.codigo = payload.codigo;
    punto.descripcion = payload.descripcion;
    punto.subsidiariaId = payload.subsidiariaId;
    punto.lat = payload.lat;
    punto.lng = payload.lng;
    punto.radioMetros = payload.radioMetros;
    await punto.save();

    req.flash('success', 'Punto de acceso actualizado');
    res.redirect('/config-puntos-acceso');
  } catch (err) {
    console.error('[puntos-acceso.update]', err);
    req.flash(
      'error',
      err.code === 11000 ? 'Código duplicado' : err.message || 'Error al actualizar'
    );
    res.redirect(`/config-puntos-acceso/${req.params.id}/edit`);
  }
}

async function togglePunto(req, res) {
  const PuntoAcceso = await getPuntoAccesoModel();
  const punto = await findOneDocByTenant(PuntoAcceso, req.session.tenantId, req.params.id);
  if (!punto) return res.status(404).send('Punto no encontrado');
  punto.activo = !punto.activo;
  await punto.save();
  req.flash('success', punto.activo ? 'Punto activado' : 'Punto desactivado');
  res.redirect('/config-puntos-acceso');
}

module.exports = {
  listPuntos,
  createPunto,
  editPunto,
  updatePunto,
  togglePunto
};
