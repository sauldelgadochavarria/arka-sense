const getSubsidiariaModel = require('../models/subsidiaria');
const {
  requireEmpresaForTenant,
  findOneByEmpresa,
  findOneDocByEmpresa
} = require('../libs/tenantScope');
const { trimString, parsePositiveNumber, parseOptionalLegadoCode } = require('../libs/formHelpers');

function buildSubsidiariaPayload(body) {
  const lat = body.lat === '' || body.lat === undefined ? undefined : Number(body.lat);
  const lng = body.lng === '' || body.lng === undefined ? undefined : Number(body.lng);

  return {
    nombre: trimString(body.nombre),
    codigo: trimString(body.codigo).toUpperCase(),
    codigoLegado: parseOptionalLegadoCode(body.codigoLegado),
    direccion: trimString(body.direccion),
    ciudad: trimString(body.ciudad),
    estado: trimString(body.estado),
    codigoPostal: trimString(body.codigoPostal),
    lat: Number.isNaN(lat) ? undefined : lat,
    lng: Number.isNaN(lng) ? undefined : lng,
    geocercaRadioMetros: parsePositiveNumber(body.geocercaRadioMetros)
  };
}

async function listSubsidiarias(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Subsidiaria = await getSubsidiariaModel();
  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id }).sort({ nombre: 1 }).lean()
    : [];
  res.render('Configurations/subsidiarias', { subsidiarias, empresa, error: error || null, session: req.session });
}

async function createSubsidiaria(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-subsidiarias');
    }

    const Subsidiaria = await getSubsidiariaModel();
    await Subsidiaria.create({
      empresaId: empresa._id,
      ...buildSubsidiariaPayload(req.body),
      activo: true
    });
    req.flash('success', 'Subsidiaria creada');
    res.redirect('/config-subsidiarias');
  } catch (err) {
    console.error('[subsidiarias]', err);
    req.flash('error', err.code === 11000 ? 'El código de subsidiaria ya existe' : 'Error al crear subsidiaria');
    res.redirect('/config-subsidiarias');
  }
}

async function editSubsidiaria(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Subsidiaria = await getSubsidiariaModel();
  const subsidiaria = empresa
    ? await findOneByEmpresa(Subsidiaria, empresa._id, req.params.id)
    : null;
  if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

  res.render('Configurations/subsidiaria-edit', { subsidiaria, empresa, error: error || null, session: req.session });
}

async function updateSubsidiaria(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-subsidiarias');
    }

    const Subsidiaria = await getSubsidiariaModel();
    const subsidiaria = await findOneDocByEmpresa(Subsidiaria, empresa._id, req.params.id);
    if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

    const payload = buildSubsidiariaPayload(req.body);
    subsidiaria.nombre = payload.nombre;
    subsidiaria.codigo = payload.codigo;
    subsidiaria.codigoLegado = payload.codigoLegado;
    subsidiaria.direccion = payload.direccion;
    subsidiaria.ciudad = payload.ciudad;
    subsidiaria.estado = payload.estado;
    subsidiaria.codigoPostal = payload.codigoPostal;
    subsidiaria.lat = payload.lat;
    subsidiaria.lng = payload.lng;
    subsidiaria.geocercaRadioMetros = payload.geocercaRadioMetros;
    await subsidiaria.save();

    req.flash('success', 'Subsidiaria actualizada');
    res.redirect('/config-subsidiarias');
  } catch (err) {
    console.error('[subsidiarias]', err);
    req.flash('error', err.code === 11000 ? 'El código de subsidiaria ya existe' : 'Error al actualizar');
    res.redirect(`/config-subsidiarias/${req.params.id}/edit`);
  }
}

async function toggleSubsidiaria(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) return res.status(400).send('Empresa no encontrada');

  const Subsidiaria = await getSubsidiariaModel();
  const subsidiaria = await findOneDocByEmpresa(Subsidiaria, empresa._id, req.params.id);
  if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

  subsidiaria.activo = !subsidiaria.activo;
  await subsidiaria.save();
  req.flash('success', subsidiaria.activo ? 'Subsidiaria activada' : 'Subsidiaria desactivada');
  res.redirect('/config-subsidiarias');
}

module.exports = {
  listSubsidiarias,
  createSubsidiaria,
  editSubsidiaria,
  updateSubsidiaria,
  toggleSubsidiaria
};
