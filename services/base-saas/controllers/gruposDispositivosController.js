const getGrupoDispositivosModel = require('../models/grupoDispositivos');
const getBiometricDeviceModel = require('../models/biometricDevice');
const getSubsidiariaModel = require('../models/subsidiaria');
const {
  requireEmpresaForTenant,
  findOneByTenant,
  findOneDocByTenant
} = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId, parseObjectIdArray } = require('../libs/formHelpers');

async function listGrupos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const GrupoDispositivos = await getGrupoDispositivosModel();
  const BiometricDevice = await getBiometricDeviceModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [grupos, dispositivos, subsidiarias] = empresa
    ? await Promise.all([
        GrupoDispositivos.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        BiometricDevice.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], [], []];

  const deviceMap = new Map(dispositivos.map((d) => [String(d._id), d.nombre]));
  const subMap = new Map(subsidiarias.map((s) => [String(s._id), s.nombre]));

  res.render('Integraciones/grupos-dispositivos', {
    grupos,
    dispositivos,
    subsidiarias,
    deviceMap,
    subMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createGrupo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/integraciones/grupos-dispositivos');
    }

    const GrupoDispositivos = await getGrupoDispositivosModel();
    await GrupoDispositivos.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      subsidiariaId: parseOptionalObjectId(req.body.subsidiariaId),
      dispositivoIds: parseObjectIdArray(req.body.dispositivoIds),
      activo: true
    });

    req.flash('success', 'Grupo de dispositivos creado');
    res.redirect('/integraciones/grupos-dispositivos');
  } catch (err) {
    console.error('[grupos-dispositivos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un grupo con ese nombre' : 'Error al crear grupo');
    res.redirect('/integraciones/grupos-dispositivos');
  }
}

async function editGrupo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const GrupoDispositivos = await getGrupoDispositivosModel();
  const BiometricDevice = await getBiometricDeviceModel();
  const Subsidiaria = await getSubsidiariaModel();

  const grupo = await findOneByTenant(GrupoDispositivos, req.session.tenantId, req.params.id);
  if (!grupo) return res.status(404).send('Grupo no encontrado');

  const [dispositivos, subsidiarias] = empresa
    ? await Promise.all([
        BiometricDevice.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], []];

  res.render('Integraciones/grupo-dispositivos-edit', {
    grupo,
    dispositivos,
    subsidiarias,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateGrupo(req, res) {
  try {
    const GrupoDispositivos = await getGrupoDispositivosModel();
    const grupo = await findOneDocByTenant(GrupoDispositivos, req.session.tenantId, req.params.id);
    if (!grupo) return res.status(404).send('Grupo no encontrado');

    grupo.nombre = trimString(req.body.nombre);
    grupo.descripcion = trimString(req.body.descripcion);
    grupo.subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
    grupo.dispositivoIds = parseObjectIdArray(req.body.dispositivoIds);
    await grupo.save();

    req.flash('success', 'Grupo actualizado');
    res.redirect('/integraciones/grupos-dispositivos');
  } catch (err) {
    console.error('[grupos-dispositivos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un grupo con ese nombre' : 'Error al actualizar');
    res.redirect(`/integraciones/grupos-dispositivos/${req.params.id}/edit`);
  }
}

async function toggleGrupo(req, res) {
  const GrupoDispositivos = await getGrupoDispositivosModel();
  const grupo = await findOneDocByTenant(GrupoDispositivos, req.session.tenantId, req.params.id);
  if (!grupo) return res.status(404).send('Grupo no encontrado');

  grupo.activo = !grupo.activo;
  await grupo.save();
  req.flash('success', grupo.activo ? 'Grupo activado' : 'Grupo desactivado');
  res.redirect('/integraciones/grupos-dispositivos');
}

module.exports = {
  listGrupos,
  createGrupo,
  editGrupo,
  updateGrupo,
  toggleGrupo
};
