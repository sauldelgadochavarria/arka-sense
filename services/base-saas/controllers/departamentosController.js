const getDepartamentoModel = require('../models/departamento');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId, parseOptionalLegadoCode } = require('../libs/formHelpers');

async function listDepartamentos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Departamento = await getDepartamentoModel();
  const departamentos = empresa
    ? await Departamento.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean()
    : [];
  const parentMap = new Map(departamentos.map((d) => [String(d._id), d.nombre]));

  res.render('Personal/departamentos', {
    departamentos,
    parentMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newDepartamento(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Departamento = await getDepartamentoModel();
  const departamentos = empresa
    ? await Departamento.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean()
    : [];

  res.render('Personal/departamento-nuevo', {
    departamentos,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createDepartamento(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-departamentos');
    }

    const Departamento = await getDepartamentoModel();
    await Departamento.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      parentId: parseOptionalObjectId(req.body.parentId),
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      cuentaContableExterna: trimString(req.body.cuentaContableExterna),
      activo: true
    });
    req.flash('success', 'Departamento creado');
    res.redirect('/personal-departamentos');
  } catch (err) {
    console.error('[departamentos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un departamento con ese nombre' : 'Error al crear departamento');
    res.redirect('/personal-departamentos');
  }
}

async function editDepartamento(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Departamento = await getDepartamentoModel();
  const departamento = await findOneByTenant(Departamento, req.session.tenantId, req.params.id);
  if (!departamento) return res.status(404).send('Departamento no encontrado');

  const departamentos = empresa
    ? await Departamento.find({ tenantId: req.session.tenantId, activo: true, _id: { $ne: departamento._id } })
        .sort({ nombre: 1 })
        .lean()
    : [];

  res.render('Personal/departamento-edit', {
    departamento,
    departamentos,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateDepartamento(req, res) {
  try {
    const Departamento = await getDepartamentoModel();
    const departamento = await findOneDocByTenant(Departamento, req.session.tenantId, req.params.id);
    if (!departamento) return res.status(404).send('Departamento no encontrado');

    const parentId = parseOptionalObjectId(req.body.parentId);
    if (parentId && String(parentId) === String(departamento._id)) {
      req.flash('error', 'Un departamento no puede ser su propio padre');
      return res.redirect(`/personal-departamentos/${departamento._id}/edit`);
    }

    departamento.nombre = trimString(req.body.nombre);
    departamento.descripcion = trimString(req.body.descripcion);
    departamento.parentId = parentId;
    departamento.codigoLegado = parseOptionalLegadoCode(req.body.codigoLegado);
    departamento.codigoExterno = trimString(req.body.codigoExterno);
    departamento.cuentaContableExterna = trimString(req.body.cuentaContableExterna);
    await departamento.save();

    req.flash('success', 'Departamento actualizado');
    res.redirect('/personal-departamentos');
  } catch (err) {
    console.error('[departamentos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un departamento con ese nombre' : 'Error al actualizar');
    res.redirect(`/personal-departamentos/${req.params.id}/edit`);
  }
}

async function toggleDepartamento(req, res) {
  const Departamento = await getDepartamentoModel();
  const departamento = await findOneDocByTenant(Departamento, req.session.tenantId, req.params.id);
  if (!departamento) return res.status(404).send('Departamento no encontrado');

  departamento.activo = !departamento.activo;
  await departamento.save();
  req.flash('success', departamento.activo ? 'Departamento activado' : 'Departamento desactivado');
  res.redirect('/personal-departamentos');
}

module.exports = {
  listDepartamentos,
  newDepartamento,
  createDepartamento,
  editDepartamento,
  updateDepartamento,
  toggleDepartamento
};
