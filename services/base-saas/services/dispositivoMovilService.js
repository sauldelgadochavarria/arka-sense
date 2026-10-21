'use strict';

const crypto = require('crypto');
const getEmpleadoDispositivoModel = require('../models/empleadoDispositivo');
const getDispositivoOtpModel = require('../models/dispositivoOtp');
const getSubsidiariaModel = require('../models/subsidiaria');
const getEmpleadoModel = require('../models/empleado');
const { sendSms } = require('./smsService');

const OTP_TTL_MS = Number(process.env.DISPOSITIVO_OTP_TTL_MS || 10 * 60 * 1000);
const OTP_MAX_INTENTOS = Number(process.env.DISPOSITIVO_OTP_MAX_INTENTOS || 5);

function normalizeDeviceUuid(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function normalizePhone(v) {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  return digits.slice(0, 20);
}

function maskPhone(tel) {
  const s = String(tel || '');
  if (s.length < 4) return '****';
  return `${'*'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Política efectiva: subsidiaria exige AND empleado no está exento.
 * exigir = subsidiaria.exigirRegistroDispositivo && !empleado.exentoRegistroDispositivo
 */
async function getPoliticaSeguridadMovil(empleado) {
  const exento = Boolean(empleado?.exentoRegistroDispositivo);
  if (!empleado?.subsidiariaId) {
    return {
      exigirRegistroDispositivo: false,
      exigirPorSubsidiaria: false,
      exentoRegistroDispositivo: exento,
      subsidiariaId: null
    };
  }
  const Subsidiaria = await getSubsidiariaModel();
  const sub = await Subsidiaria.findById(empleado.subsidiariaId)
    .select('seguridadMovil nombre codigo')
    .lean();
  const exigirPorSubsidiaria = Boolean(sub?.seguridadMovil?.exigirRegistroDispositivo);
  const exigir = exigirPorSubsidiaria && !exento;
  return {
    exigirRegistroDispositivo: exigir,
    exigirPorSubsidiaria,
    exentoRegistroDispositivo: exento,
    subsidiariaId: sub?._id || empleado.subsidiariaId,
    subsidiariaNombre: sub?.nombre || ''
  };
}

async function findDispositivoActivo({ tenantId, empleadoId, deviceUuid }) {
  const uuid = normalizeDeviceUuid(deviceUuid);
  if (!uuid) return null;
  const Model = await getEmpleadoDispositivoModel();
  return Model.findOne({
    tenantId,
    empleadoId,
    deviceUuid: uuid,
    activo: true
  }).lean();
}

async function buildSeguridadMovilStatus({ tenantId, empleado, deviceUuid }) {
  const politica = await getPoliticaSeguridadMovil(empleado);
  const uuid = normalizeDeviceUuid(deviceUuid);
  let dispositivoRegistrado = false;
  if (uuid) {
    const d = await findDispositivoActivo({
      tenantId,
      empleadoId: empleado._id,
      deviceUuid: uuid
    });
    dispositivoRegistrado = Boolean(d);
  }
  const tel = empleado.telefono || '';
  return {
    exigirRegistroDispositivo: politica.exigirRegistroDispositivo,
    exigirPorSubsidiaria: Boolean(politica.exigirPorSubsidiaria),
    exentoRegistroDispositivo: Boolean(politica.exentoRegistroDispositivo),
    dispositivoRegistrado,
    telefonoEnmascarado: tel ? maskPhone(tel) : '',
    tieneTelefonoEnExpediente: Boolean(tel),
    subsidiariaId: politica.subsidiariaId ? String(politica.subsidiariaId) : null
  };
}

/**
 * Solicita OTP SMS para vincular deviceUuid.
 * Usa teléfono del body o el del expediente del empleado.
 */
async function solicitarOtp({
  tenantId,
  empleadoId,
  deviceUuid,
  telefono,
  plataforma,
  modelo,
  appVersion
}) {
  const uuid = normalizeDeviceUuid(deviceUuid);
  if (!uuid || uuid.length < 8) {
    const err = new Error('deviceUuid inválido');
    err.status = 400;
    err.code = 'DEVICE_UUID_INVALID';
    throw err;
  }

  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado || empleado.estatus !== 'activo') {
    const err = new Error('Empleado no disponible');
    err.status = 403;
    err.code = 'EMPLEADO_INACTIVO';
    throw err;
  }

  const politica = await getPoliticaSeguridadMovil(empleado);
  if (!politica.exigirRegistroDispositivo) {
    const err = new Error('Esta subsidiaria no exige registro de dispositivo');
    err.status = 400;
    err.code = 'FEATURE_DISABLED';
    throw err;
  }

  const tel = normalizePhone(telefono || empleado.telefono);
  if (!tel || tel.replace(/\D/g, '').length < 10) {
    const err = new Error('Indica un teléfono válido (o captura el celular en el expediente)');
    err.status = 400;
    err.code = 'PHONE_REQUIRED';
    throw err;
  }

  const code = randomOtp();
  const Otp = await getDispositivoOtpModel();
  await Otp.deleteMany({ tenantId, empleadoId, deviceUuid: uuid, consumedAt: null });
  void plataforma;
  void modelo;
  void appVersion;
  await Otp.create({
    tenantId,
    empleadoId,
    deviceUuid: uuid,
    telefono: tel,
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS)
  });

  await sendSms({
    to: tel,
    body: `ArkaSense: tu código de verificación es ${code}. Vigente ${Math.round(OTP_TTL_MS / 60000)} min.`
  });

  const out = {
    ok: true,
    telefonoEnmascarado: maskPhone(tel),
    expiresInSec: Math.round(OTP_TTL_MS / 1000)
  };
  // Solo en desarrollo / provider console: facilita QA sin SMS real
  if (String(process.env.SMS_PROVIDER || 'console').toLowerCase() === 'console') {
    out.devCode = code;
  }
  return out;
}

async function verificarOtp({
  tenantId,
  empleadoId,
  deviceUuid,
  codigo,
  plataforma,
  modelo,
  appVersion
}) {
  const uuid = normalizeDeviceUuid(deviceUuid);
  const code = String(codigo || '').trim();
  if (!uuid || !code) {
    const err = new Error('deviceUuid y código son obligatorios');
    err.status = 400;
    err.code = 'OTP_REQUIRED';
    throw err;
  }

  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) {
    const err = new Error('Empleado no encontrado');
    err.status = 404;
    throw err;
  }

  const Otp = await getDispositivoOtpModel();
  const otp = await Otp.findOne({
    tenantId,
    empleadoId,
    deviceUuid: uuid,
    consumedAt: null
  }).sort({ createdAt: -1 });

  if (!otp || otp.expiresAt < new Date()) {
    const err = new Error('Código expirado o inexistente. Solicita uno nuevo.');
    err.status = 400;
    err.code = 'OTP_EXPIRED';
    throw err;
  }
  if (otp.intentos >= OTP_MAX_INTENTOS) {
    const err = new Error('Demasiados intentos. Solicita un código nuevo.');
    err.status = 429;
    err.code = 'OTP_LOCKED';
    throw err;
  }

  otp.intentos += 1;
  if (otp.codeHash !== hashOtp(code)) {
    await otp.save();
    const err = new Error('Código incorrecto');
    err.status = 400;
    err.code = 'OTP_INVALID';
    throw err;
  }

  otp.consumedAt = new Date();
  await otp.save();

  const Model = await getEmpleadoDispositivoModel();
  const doc = await Model.findOneAndUpdate(
    { tenantId, empleadoId, deviceUuid: uuid },
    {
      $set: {
        telefono: otp.telefono,
        plataforma: String(plataforma || '').slice(0, 40),
        modelo: String(modelo || '').slice(0, 80),
        appVersion: String(appVersion || '').slice(0, 40),
        activo: true,
        verificadoEn: new Date(),
        ultimoUsoAt: new Date(),
        subsidiariaId: empleado.subsidiariaId || null
      }
    },
    { upsert: true, new: true }
  );

  // Actualiza teléfono en expediente si estaba vacío
  if (!empleado.telefono && otp.telefono) {
    await Empleado.updateOne({ _id: empleadoId }, { $set: { telefono: otp.telefono } });
  }

  return {
    ok: true,
    dispositivo: {
      id: String(doc._id),
      deviceUuid: doc.deviceUuid,
      telefonoEnmascarado: maskPhone(doc.telefono),
      verificadoEn: doc.verificadoEn
    }
  };
}

/**
 * Valida deviceUuid en marcación. Si la subsidiaria no exige registro, solo audita.
 * @returns {{ deviceUuid: string, registrado: boolean }}
 */
async function assertDispositivoParaMarcacion({ tenantId, empleado, deviceUuid }) {
  const uuid = normalizeDeviceUuid(deviceUuid);
  if (!uuid) {
    const err = new Error('deviceUuid del móvil es obligatorio en la marcación');
    err.status = 400;
    err.code = 'DEVICE_UUID_REQUIRED';
    throw err;
  }

  const politica = await getPoliticaSeguridadMovil(empleado);
  const activo = await findDispositivoActivo({
    tenantId,
    empleadoId: empleado._id,
    deviceUuid: uuid
  });

  if (politica.exigirRegistroDispositivo && !activo) {
    const err = new Error(
      'Este teléfono no está registrado. Verifica el dispositivo con el código SMS.'
    );
    err.status = 403;
    err.code = 'DEVICE_NOT_REGISTERED';
    throw err;
  }

  if (activo) {
    const Model = await getEmpleadoDispositivoModel();
    await Model.updateOne({ _id: activo._id }, { $set: { ultimoUsoAt: new Date() } });
  }

  return { deviceUuid: uuid, registrado: Boolean(activo) };
}

module.exports = {
  normalizeDeviceUuid,
  getPoliticaSeguridadMovil,
  buildSeguridadMovilStatus,
  solicitarOtp,
  verificarOtp,
  assertDispositivoParaMarcacion,
  findDispositivoActivo
};
