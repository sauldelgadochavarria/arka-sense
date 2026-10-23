'use strict';

const getZonaModel = require('../models/zona');
const getSubsidiariaModel = require('../models/subsidiaria');
const { requireEmpresaForTenant, findOneByTenant, findOneDocByTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');

async function resolverZona(tenantId, zonaId, subsidiariaId) {
  if (!zonaId) return { zonaId: null, subsidiariaId: subsidiariaId || null };
  const Zona = await getZonaModel();
  const zona = await Zona.findOne({ _id: zonaId, tenantId }).lean();
  if (!zona) return { error: 'Zona no encontrada' };
  if (subsidiariaId && String(zona.subsidiariaId) !== String(subsidiariaId)) {
    return { error: 'La zona no pertenece a la subsidiaria elegida' };
  }
  return {
    zonaId: zona._id,
    subsidiariaId: subsidiariaId || zona.subsidiariaId
  };
}

async function listZonas(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Zona = await getZonaModel();
  const Subsidiaria = await getSubsidiariaModel();
  const [zonas, subsidiarias] = empresa
    ? await Promise.all([
        Zona.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], []];
  const subMap = new Map(subsidiarias.map((s) => [String(s._id), s.nombre]));

  res.render('Configurations/zonas', {
    title: 'Zonas',
    zonas,
    subsidiarias,
    subMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createZona(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-zonas');
    }
    const nombre = trimString(req.body.nombre);
    const subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
    if (!nombre || !subsidiariaId) {
      req.flash('error', 'Nombre y subsidiaria son obligatorios');
      return res.redirect('/config-zonas');
    }
    const Subsidiaria = await getSubsidiariaModel();
    const sub = await Subsidiaria.findOne({ _id: subsidiariaId, empresaId: empresa._id }).lean();
    if (!sub) {
      req.flash('error', 'Subsidiaria no encontrada');
      return res.redirect('/config-zonas');
    }
    const Zona = await getZonaModel();
    await Zona.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId,
      codigo: trimString(req.body.codigo).toUpperCase(),
      nombre,
      descripcion: trimString(req.body.descripcion),
      activo: true
    });
    req.flash('success', 'Zona creada');
    res.redirect('/config-zonas');
  } catch (err) {
    console.error('[zonas.create]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe una zona con ese nombre o código' : 'Error al crear la zona');
    res.redirect('/config-zonas');
  }
}

async function editZona(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Zona = await getZonaModel();
  const Subsidiaria = await getSubsidiariaModel();
  const zona = await findOneByTenant(Zona, req.session.tenantId, req.params.id);
  if (!zona) return res.status(404).send('Zona no encontrada');
  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
    : [];
  res.render('Configurations/zona-edit', {
    title: `Editar · ${zona.nombre}`,
    zona,
    subsidiarias,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateZona(req, res) {
  try {
    const Zona = await getZonaModel();
    const zona = await findOneDocByTenant(Zona, req.session.tenantId, req.params.id);
    if (!zona) return res.status(404).send('Zona no encontrada');
    const nombre = trimString(req.body.nombre);
    const subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
    if (!nombre || !subsidiariaId) {
      req.flash('error', 'Nombre y subsidiaria son obligatorios');
      return res.redirect(`/config-zonas/${req.params.id}/edit`);
    }
    zona.nombre = nombre;
    zona.codigo = trimString(req.body.codigo).toUpperCase();
    zona.descripcion = trimString(req.body.descripcion);
    zona.subsidiariaId = subsidiariaId;
    await zona.save();
    req.flash('success', 'Zona actualizada');
    res.redirect('/config-zonas');
  } catch (err) {
    console.error('[zonas.update]', err);
    req.flash('error', err.code === 11000 ? 'Nombre o código duplicado' : 'Error al actualizar');
    res.redirect(`/config-zonas/${req.params.id}/edit`);
  }
}

async function toggleZona(req, res) {
  const Zona = await getZonaModel();
  const zona = await findOneDocByTenant(Zona, req.session.tenantId, req.params.id);
  if (!zona) return res.status(404).send('Zona no encontrada');
  zona.activo = !zona.activo;
  await zona.save();
  req.flash('success', zona.activo ? 'Zona activada' : 'Zona desactivada');
  res.redirect('/config-zonas');
}

module.exports = {
  resolverZona,
  listZonas,
  createZona,
  editZona,
  updateZona,
  toggleZona
};
