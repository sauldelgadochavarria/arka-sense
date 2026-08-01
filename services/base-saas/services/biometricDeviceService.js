'use strict';

const getBiometricDeviceModel = require('../models/biometricDevice');
const getEmpleadoModel = require('../models/empleado');
const getSyncLogModel = require('../models/syncLog');

async function pingDevice(deviceId, tenantId) {
  const BiometricDevice = await getBiometricDeviceModel();
  const device = await BiometricDevice.findOne({ _id: deviceId, tenantId });
  if (!device) throw new Error('DEVICE_NOT_FOUND');

  let estatus = 'offline';
  let detalle = 'Sin host configurado';

  if (device.host) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const url = `http://${device.host}:${device.puerto || 80}`;
      await fetch(url, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      estatus = 'online';
      detalle = `Respuesta HTTP desde ${url}`;
    } catch (err) {
      estatus = 'offline';
      detalle = err.name === 'AbortError' ? `Timeout al contactar ${device.host}` : `Sin respuesta: ${device.host}`;
    }
  }

  device.estatus = estatus;
  device.ultimoPing = new Date();
  await device.save();

  return { device: device.toObject(), detalle };
}

async function syncCatalogToDevice(deviceId, tenantId, userId = '') {
  const BiometricDevice = await getBiometricDeviceModel();
  const Empleado = await getEmpleadoModel();

  const device = await BiometricDevice.findOne({ _id: deviceId, tenantId });
  if (!device) throw new Error('DEVICE_NOT_FOUND');

  const empleados = await Empleado.find({ tenantId, estatus: 'activo', activo: true })
    .select('numEmpleado firstName lastName')
    .lean();

  const payload = empleados.map((e) => ({
    pin: e.numEmpleado,
    nombre: `${e.firstName} ${e.lastName}`.trim()
  }));

  device.ultimaSincCatalogo = new Date();
  device.syncCatalogoPendiente = false;
  device.empleadosSincronizados = payload.length;
  device.estatus = device.host ? device.estatus : 'desconocido';
  await device.save();

  const SyncLog = await getSyncLogModel();
  await SyncLog.create({
    tenantId,
    empresaId: device.empresaId,
    tipo: 'catalogo_dispositivo',
    adaptador: device.tipo,
    referenciaId: String(device._id),
    estatus: 'ok',
    registrosOk: payload.length,
    registrosError: 0,
    detalle: `Catálogo enviado a «${device.nombre}» — ${payload.length} empleados`,
    archivoNombre: `catalogo_${device.nombre.replace(/\s+/g, '_')}.json`,
    archivoContenido: JSON.stringify(payload, null, 2),
    userId
  });

  return { device: device.toObject(), empleados: payload.length };
}

module.exports = { pingDevice, syncCatalogToDevice };
