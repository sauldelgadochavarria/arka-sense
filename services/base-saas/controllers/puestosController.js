const getPuestoModel = require('../models/puesto');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant,
  sessionSubsidiariaId,
  scopeEmpresaFilter
} = require('../libs/tenantScope');
const { trimString, parseOptionalLegadoCode } = require('../libs/formHelpers');

function puestoDeLaSubsidiaria(puesto, req) {
  const subId = sessionSubsidiariaId(req);
  if (!subId) return true;
  return puesto && String(puesto.subsidiariaId || '') === String(subId);
}

async function listPuestos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Puesto = await getPuestoModel();
  const filtro = scopeEmpresaFilter(req, empresa);
  const puestos = filtro ? await Puesto.find(filtro).sort({ nombre: 1 }).lean() : [];

  res.render('Personal/puestos', { puestos, empresa, error: error || null, session: req.session });
}

async function createPuesto(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-puestos');
    }

    const subId = sessionSubsidiariaId(req);
    if (!subId) {
      req.flash('error', 'Elige una subsidiaria antes de crear el puesto');
      return res.redirect('/personal-puestos');
    }

    const Puesto = await getPuestoModel();
    await Puesto.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId,
      nombre: trimString(req.body.nombre),
      nivel: trimString(req.body.nivel),
      descripcion: trimString(req.body.descripcion),
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      activo: true
    });
    req.flash('success', 'Puesto creado');
    res.redirect('/personal-puestos');
  } catch (err) {
    console.error('[puestos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un puesto con ese nombre' : 'Error al crear puesto');
    res.redirect('/personal-puestos');
  }
}

async function editPuesto(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Puesto = await getPuestoModel();
  const puesto = await findOneByTenant(Puesto, req.session.tenantId, req.params.id);
  if (!puesto || !puestoDeLaSubsidiaria(puesto, req)) return res.status(404).send('Puesto no encontrado');

  res.render('Personal/puesto-edit', { puesto, empresa, error: error || null, session: req.session });
}

async function updatePuesto(req, res) {
  try {
    const Puesto = await getPuestoModel();
    const puesto = await findOneDocByTenant(Puesto, req.session.tenantId, req.params.id);
    if (!puesto || !puestoDeLaSubsidiaria(puesto, req)) return res.status(404).send('Puesto no encontrado');

    puesto.nombre = trimString(req.body.nombre);
    puesto.nivel = trimString(req.body.nivel);
    puesto.descripcion = trimString(req.body.descripcion);
    puesto.codigoLegado = parseOptionalLegadoCode(req.body.codigoLegado);
    await puesto.save();

    req.flash('success', 'Puesto actualizado');
    res.redirect('/personal-puestos');
  } catch (err) {
    console.error('[puestos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un puesto con ese nombre' : 'Error al actualizar');
    res.redirect(`/personal-puestos/${req.params.id}/edit`);
  }
}

async function togglePuesto(req, res) {
  const Puesto = await getPuestoModel();
  const puesto = await findOneDocByTenant(Puesto, req.session.tenantId, req.params.id);
  if (!puesto || !puestoDeLaSubsidiaria(puesto, req)) return res.status(404).send('Puesto no encontrado');

  puesto.activo = !puesto.activo;
  await puesto.save();
  req.flash('success', puesto.activo ? 'Puesto activado' : 'Puesto desactivado');
  res.redirect('/personal-puestos');
}

module.exports = {
  listPuestos,
  createPuesto,
  editPuesto,
  updatePuesto,
  togglePuesto
};
