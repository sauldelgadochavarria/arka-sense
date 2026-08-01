const getBiometricDeviceModel = require('../models/biometricDevice');
const getSubsidiariaModel = require('../models/subsidiaria');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');
const { TIPOS_DISPOSITIVO } = require('../config/integraciones');
const { pingDevice, syncCatalogToDevice } = require('../services/biometricDeviceService');

async function listDispositivos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const BiometricDevice = await getBiometricDeviceModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [dispositivos, subsidiarias] = empresa
    ? await Promise.all([
        BiometricDevice.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], []];

  res.render('Integraciones/dispositivos', {
    dispositivos,
    subsidiarias,
    tiposDispositivo: TIPOS_DISPOSITIVO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createDispositivo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/integraciones/dispositivos');
    }

    const BiometricDevice = await getBiometricDeviceModel();
    await BiometricDevice.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: parseOptionalObjectId(req.body.subsidiariaId),
      nombre: trimString(req.body.nombre),
      tipo: trimString(req.body.tipo) || 'generico',
      host: trimString(req.body.host),
      puerto: Number(req.body.puerto) || 4370,
      ubicacion: trimString(req.body.ubicacion),
      activo: true
    });

    req.flash('success', 'Dispositivo registrado');
    res.redirect('/integraciones/dispositivos');
  } catch (err) {
    console.error('[dispositivos]', err);
    req.flash('error', 'Error al registrar dispositivo');
    res.redirect('/integraciones/dispositivos');
  }
}

async function editDispositivo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const BiometricDevice = await getBiometricDeviceModel();
  const Subsidiaria = await getSubsidiariaModel();

  const dispositivo = await BiometricDevice.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId
  }).lean();
  if (!dispositivo) return res.status(404).send('Dispositivo no encontrado');

  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
    : [];

  res.render('Integraciones/dispositivo-edit', {
    dispositivo,
    subsidiarias,
    tiposDispositivo: TIPOS_DISPOSITIVO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateDispositivo(req, res) {
  try {
    const BiometricDevice = await getBiometricDeviceModel();
    const device = await BiometricDevice.findOne({
      _id: req.params.id,
      tenantId: req.session.tenantId
    });
    if (!device) {
      req.flash('error', 'Dispositivo no encontrado');
      return res.redirect('/integraciones/dispositivos');
    }

    device.nombre = trimString(req.body.nombre) || device.nombre;
    device.tipo = trimString(req.body.tipo) || device.tipo;
    device.host = trimString(req.body.host);
    device.puerto = Number(req.body.puerto) || device.puerto;
    device.ubicacion = trimString(req.body.ubicacion);
    device.subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
    device.activo = req.body.activo === 'on' || req.body.activo === 'true';
    await device.save();

    req.flash('success', 'Dispositivo actualizado');
    res.redirect('/integraciones/dispositivos');
  } catch (err) {
    console.error('[dispositivos]', err);
    req.flash('error', 'Error al actualizar');
    res.redirect('/integraciones/dispositivos');
  }
}

async function pingDispositivo(req, res) {
  try {
    const { device, detalle } = await pingDevice(req.params.id, req.session.tenantId);
    req.flash(device.estatus === 'online' ? 'success' : 'error', detalle);
    res.redirect('/integraciones/dispositivos');
  } catch (err) {
    console.error('[dispositivos]', err);
    req.flash('error', 'Error al verificar dispositivo');
    res.redirect('/integraciones/dispositivos');
  }
}

async function sincronizarCatalogo(req, res) {
  try {
    const { empleados } = await syncCatalogToDevice(
      req.params.id,
      req.session.tenantId,
      req.session.userid || ''
    );
    req.flash('success', `Catálogo sincronizado — ${empleados} empleados`);
    res.redirect('/integraciones/dispositivos');
  } catch (err) {
    console.error('[dispositivos]', err);
    req.flash('error', 'Error al sincronizar catálogo');
    res.redirect('/integraciones/dispositivos');
  }
}

module.exports = {
  listDispositivos,
  createDispositivo,
  editDispositivo,
  updateDispositivo,
  pingDispositivo,
  sincronizarCatalogo
};
