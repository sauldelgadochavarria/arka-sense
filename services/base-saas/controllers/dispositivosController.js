const getBiometricDeviceModel = require('../models/biometricDevice');
const getSubsidiariaModel = require('../models/subsidiaria');
const getZonaModel = require('../models/zona');
const getEmpleadoModel = require('../models/empleado');
const { resolverZona } = require('./zonasController');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId } = require('../libs/formHelpers');
const { TIPOS_DISPOSITIVO } = require('../config/integraciones');
const { pingDevice, syncCatalogToDevice } = require('../services/biometricDeviceService');

const PROPOSITOS = [
  { value: 'asistencia', label: 'Asistencia' },
  { value: 'acceso', label: 'Acceso' }
];

function etiquetaEmpleado(emp) {
  const nombre = [emp.firstName, emp.apellidoPaterno || emp.lastName, emp.apellidoMaterno]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return emp.numEmpleado ? `${nombre} (${emp.numEmpleado})` : nombre;
}

async function listDispositivos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const BiometricDevice = await getBiometricDeviceModel();
  const Subsidiaria = await getSubsidiariaModel();
  const Zona = await getZonaModel();

  const [dispositivos, subsidiarias, zonas] = empresa
    ? await Promise.all([
        BiometricDevice.find({ tenantId: req.session.tenantId }).sort({ nombre: 1 }).lean(),
        Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
        Zona.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean()
      ])
    : [[], [], []];

  const zonaMap = new Map(zonas.map((z) => [String(z._id), z.nombre]));

  res.render('Integraciones/dispositivos', {
    dispositivos,
    subsidiarias,
    zonas,
    zonaMap,
    tiposDispositivo: TIPOS_DISPOSITIVO,
    propositos: PROPOSITOS,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createDispositivo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/integraciones/dispositivos');
    }

    const subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
    const lugar = await resolverZona(
      req.session.tenantId,
      parseOptionalObjectId(req.body.zonaId),
      subsidiariaId
    );
    if (lugar.error) {
      req.flash('error', lugar.error);
      return res.redirect('/integraciones/dispositivos');
    }

    const proposito = trimString(req.body.proposito) === 'acceso' ? 'acceso' : 'asistencia';
    const BiometricDevice = await getBiometricDeviceModel();
    await BiometricDevice.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: lugar.subsidiariaId,
      zonaId: lugar.zonaId,
      nombre: trimString(req.body.nombre),
      numeroSerie: trimString(req.body.numeroSerie).toUpperCase(),
      proposito,
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
    req.flash('error', err.code === 11000 ? 'Ese número de serie ya está registrado' : 'Error al registrar dispositivo');
    res.redirect('/integraciones/dispositivos');
  }
}

async function editDispositivo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
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
  const Zona = await getZonaModel();
  const zonas = await Zona.find({ tenantId: req.session.tenantId, activo: true }).sort({ nombre: 1 }).lean();
  const Empleado = await getEmpleadoModel();
  const ids = Array.isArray(dispositivo.empleadosAutorizados) ? dispositivo.empleadosAutorizados : [];
  const autorizados = ids.length
    ? await Empleado.find({ _id: { $in: ids }, tenantId: req.session.tenantId })
        .select('numEmpleado firstName lastName apellidoPaterno apellidoMaterno')
        .sort({ numEmpleado: 1 })
        .lean()
    : [];

  res.render('Integraciones/dispositivo-edit', {
    dispositivo,
    subsidiarias,
    zonas,
    autorizados,
    etiquetaEmpleado,
    tiposDispositivo: TIPOS_DISPOSITIVO,
    propositos: PROPOSITOS,
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

    const lugar = await resolverZona(
      req.session.tenantId,
      parseOptionalObjectId(req.body.zonaId),
      parseOptionalObjectId(req.body.subsidiariaId)
    );
    if (lugar.error) {
      req.flash('error', lugar.error);
      return res.redirect(`/integraciones/dispositivos/${req.params.id}/edit`);
    }

    device.nombre = trimString(req.body.nombre) || device.nombre;
    device.tipo = trimString(req.body.tipo) || device.tipo;
    device.numeroSerie = trimString(req.body.numeroSerie).toUpperCase();
    device.proposito = trimString(req.body.proposito) === 'acceso' ? 'acceso' : 'asistencia';
    device.host = trimString(req.body.host);
    device.puerto = Number(req.body.puerto) || device.puerto;
    device.ubicacion = trimString(req.body.ubicacion);
    device.subsidiariaId = lugar.subsidiariaId;
    device.zonaId = lugar.zonaId;
    device.activo = req.body.activo === 'on' || req.body.activo === 'true';
    await device.save();

    req.flash('success', 'Dispositivo actualizado');
    res.redirect('/integraciones/dispositivos');
  } catch (err) {
    console.error('[dispositivos]', err);
    req.flash('error', err.code === 11000 ? 'Ese número de serie ya está registrado' : 'Error al actualizar');
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

async function agregarEmpleado(req, res) {
  const back = `/integraciones/dispositivos/${req.params.id}/edit`;
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
    const num = trimString(req.body.numEmpleado);
    if (!num) {
      req.flash('error', 'Indica el número de empleado');
      return res.redirect(back);
    }
    const Empleado = await getEmpleadoModel();
    const emp = await Empleado.findOne({
      tenantId: req.session.tenantId,
      numEmpleado: num,
      estatus: 'activo'
    })
      .select('_id subsidiariaId')
      .lean();
    if (!emp) {
      req.flash('error', `No hay un empleado activo con número ${num}`);
      return res.redirect(back);
    }
    if (device.subsidiariaId && emp.subsidiariaId && String(emp.subsidiariaId) !== String(device.subsidiariaId)) {
      req.flash('error', 'Ese empleado pertenece a otra subsidiaria');
      return res.redirect(back);
    }
    const ya = (device.empleadosAutorizados || []).some((id) => String(id) === String(emp._id));
    if (!ya) {
      device.empleadosAutorizados.push(emp._id);
      device.syncCatalogoPendiente = true;
      await device.save();
    }
    req.flash('success', 'Empleado agregado a la terminal');
    res.redirect(back);
  } catch (err) {
    console.error('[dispositivos.empleado]', err);
    req.flash('error', 'No se pudo agregar al empleado');
    res.redirect(back);
  }
}

async function quitarEmpleado(req, res) {
  const back = `/integraciones/dispositivos/${req.params.id}/edit`;
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
    device.empleadosAutorizados = (device.empleadosAutorizados || []).filter(
      (id) => String(id) !== String(req.params.empleadoId)
    );
    device.syncCatalogoPendiente = true;
    await device.save();
    req.flash('success', 'Empleado quitado de la terminal');
    res.redirect(back);
  } catch (err) {
    console.error('[dispositivos.empleado]', err);
    req.flash('error', 'No se pudo quitar al empleado');
    res.redirect(back);
  }
}

module.exports = {
  listDispositivos,
  createDispositivo,
  editDispositivo,
  updateDispositivo,
  agregarEmpleado,
  quitarEmpleado,
  pingDispositivo,
  sincronizarCatalogo
};
