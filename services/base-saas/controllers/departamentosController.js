const getDepartamentoModel = require('../models/departamento');
const getPuntoAccesoModel = require('../models/puntoAcceso');
const getSubsidiariaModel = require('../models/subsidiaria');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant,
  sessionSubsidiariaId,
  scopeDepartamentoFilter,
  scopeLugarFilter
} = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId, parseOptionalLegadoCode, parseObjectIdArray } = require('../libs/formHelpers');
const { POLITICAS_GEO_DEPARTAMENTO } = require('../config/asistencia');

function politicaDepartamento(body) {
  const v = trimString(body.marcajePoliticaGeo);
  return POLITICAS_GEO_DEPARTAMENTO.some((p) => p.value === v) ? v : 'open_with_flag';
}

async function catalogoUbicaciones(tenantId, empresa, subsidiariaId) {
  if (!empresa) return { puntosAcceso: [], subMap: new Map() };
  const Punto = await getPuntoAccesoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const lugarQ = scopeLugarFilter(tenantId, subsidiariaId, { incluirCompartidos: true });
  const [puntosAcceso, subs] = await Promise.all([
    Punto.find({ ...lugarQ, empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
    Subsidiaria.find({ empresaId: empresa._id }).select('nombre').lean()
  ]);
  return {
    puntosAcceso,
    subMap: new Map(subs.map((s) => [String(s._id), s.nombre]))
  };
}

async function listDepartamentos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Departamento = await getDepartamentoModel();
  const filtro = scopeDepartamentoFilter(req, empresa);
  const departamentos = filtro
    ? await Departamento.find(filtro).sort({ nombre: 1 }).lean()
    : [];
  const parentMap = new Map(departamentos.map((d) => [String(d._id), d.nombre]));

  const geoLabel = new Map(POLITICAS_GEO_DEPARTAMENTO.map((p) => [p.value, p.label]));
  res.render('Personal/departamentos', {
    departamentos,
    parentMap,
    geoLabel,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newDepartamento(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Departamento = await getDepartamentoModel();
  const filtro = scopeDepartamentoFilter(req, empresa, { activo: true });
  const departamentos = filtro
    ? await Departamento.find(filtro).sort({ nombre: 1 }).lean()
    : [];

  const catalogo = await catalogoUbicaciones(req.session.tenantId, empresa, sessionSubsidiariaId(req));
  res.render('Personal/departamento-nuevo', {
    departamentos,
    ...catalogo,
    politicasGeo: POLITICAS_GEO_DEPARTAMENTO,
    departamento: null,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createDepartamento(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/personal-departamentos');
    }

    const subId = sessionSubsidiariaId(req);
    if (!subId) {
      req.flash('error', 'Elige una subsidiaria antes de crear el departamento');
      return res.redirect('/personal-departamentos');
    }

    const Departamento = await getDepartamentoModel();
    await Departamento.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: subId,
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      parentId: parseOptionalObjectId(req.body.parentId),
      codigoLegado: parseOptionalLegadoCode(req.body.codigoLegado),
      codigoExterno: trimString(req.body.codigoExterno),
      cuentaContableExterna: trimString(req.body.cuentaContableExterna),
      puntoAccesoIds: parseObjectIdArray(req.body.puntoAccesoIds),
      marcajePoliticaGeo: politicaDepartamento(req.body),
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
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Departamento = await getDepartamentoModel();
  const departamento = await findOneByTenant(Departamento, req.session.tenantId, req.params.id);
  if (!departamento) return res.status(404).send('Departamento no encontrado');

  const subDelDepto = departamento.subsidiariaId || sessionSubsidiariaId(req);
  const departamentos = empresa
    ? await Departamento.find({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        ...(subDelDepto ? { subsidiariaId: subDelDepto } : {}),
        activo: true,
        _id: { $ne: departamento._id }
      })
        .sort({ nombre: 1 })
        .lean()
    : [];

  const catalogo = await catalogoUbicaciones(req.session.tenantId, empresa, subDelDepto);
  res.render('Personal/departamento-edit', {
    departamento,
    departamentos,
    ...catalogo,
    politicasGeo: POLITICAS_GEO_DEPARTAMENTO,
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
    departamento.puntoAccesoIds = parseObjectIdArray(req.body.puntoAccesoIds);
    departamento.marcajePoliticaGeo = politicaDepartamento(req.body);
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
