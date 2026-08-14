'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, trimUpper, parseCheckbox, parsePositiveNumber } = require('../libs/formHelpers');
const getCorreoConfigModel = require('../models/correoConfig');
const { CORREO_PROVEEDORES, CORREO_SEGURIDAD, presetProveedor } = require('../config/correoCatalog');
const { maskCorreo, aplicarPreset, probarCorreo, resolverCorreoConfig, modoDeConfig } = require('../services/mailerService');

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function fromBody(body, tenantId, empresaId) {
  const proveedor = CORREO_PROVEEDORES.some((p) => p.value === body.proveedor)
    ? body.proveedor
    : 'smtp';
  const preset = presetProveedor(proveedor);
  const password = body.password != null ? String(body.password) : '';
  const keepPassword = password === '' || password === '********';
  const payload = {
    tenantId,
    empresaId,
    codigo: trimUpper(body.codigo),
    nombre: trimString(body.nombre) || trimUpper(body.codigo),
    proveedor,
    activo: body.activo == null ? true : parseCheckbox(body, 'activo'),
    esDefault: parseCheckbox(body, 'esDefault'),
    fromNombre: trimString(body.fromNombre),
    fromEmail: trimString(body.fromEmail).toLowerCase(),
    replyTo: trimString(body.replyTo).toLowerCase(),
    host: trimString(body.host) || preset.host,
    port: parsePositiveNumber(body.port) ?? (preset.port || 587),
    seguridad: CORREO_SEGURIDAD.some((s) => s.value === body.seguridad)
      ? body.seguridad
      : preset.seguridad,
    usuario: preset.usuarioFijo || trimString(body.usuario),
    notas: trimString(body.notas)
  };
  if (!keepPassword) payload.password = password;
  return payload;
}

async function ensureUnicoDefault(Correo, tenantId, empresaId, id) {
  await Correo.updateMany(
    { tenantId, empresaId, _id: { $ne: id } },
    { $set: { esDefault: false } }
  );
}

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Correo = await getCorreoConfigModel();
  const rows = empresa
    ? await Correo.find({ tenantId: req.session.tenantId, empresaId: empresa._id })
        .sort({ esDefault: -1, codigo: 1 })
        .lean()
    : [];
  res.render('Nomina/correo/list', {
    session: req.session,
    empresa,
    error,
    rows: rows.map(maskCorreo),
    proveedores: CORREO_PROVEEDORES
  });
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Nomina/correo/edit', {
    session: req.session,
    empresa,
    error,
    isNew: true,
    cfg: { proveedor: 'smtp', port: 587, seguridad: 'starttls', activo: true },
    proveedores: CORREO_PROVEEDORES,
    seguridades: CORREO_SEGURIDAD,
    presetsJson: JSON.stringify(CORREO_PROVEEDORES)
  });
}

async function edit(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Correo = await getCorreoConfigModel();
  const doc = await Correo.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  }).lean();
  if (!doc) return res.status(404).send('Perfil no encontrado');
  res.render('Nomina/correo/edit', {
    session: req.session,
    empresa,
    error,
    isNew: false,
    cfg: maskCorreo(doc),
    proveedores: CORREO_PROVEEDORES,
    seguridades: CORREO_SEGURIDAD,
    presetsJson: JSON.stringify(CORREO_PROVEEDORES)
  });
}

async function create(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/correo', 'error', error || 'Sin empresa');
  const Correo = await getCorreoConfigModel();
  const payload = fromBody(req.body, req.session.tenantId, empresa._id);
  if (!payload.codigo) return flashRedirect(req, res, '/nomina/correo/nuevo', 'error', 'Código requerido');
  try {
    const count = await Correo.countDocuments({ tenantId: req.session.tenantId, empresaId: empresa._id });
    if (!count) payload.esDefault = true;
    const created = await Correo.create(payload);
    if (created.esDefault) {
      await ensureUnicoDefault(Correo, req.session.tenantId, empresa._id, created._id);
    }
    return flashRedirect(req, res, '/nomina/correo', 'success', 'Perfil de correo creado');
  } catch (err) {
    if (err.code === 11000) {
      return flashRedirect(req, res, '/nomina/correo/nuevo', 'error', 'Ya existe un perfil con ese código');
    }
    return flashRedirect(req, res, '/nomina/correo/nuevo', 'error', err.message);
  }
}

async function update(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/correo', 'error', error || 'Sin empresa');
  const Correo = await getCorreoConfigModel();
  const doc = await Correo.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  });
  if (!doc) return flashRedirect(req, res, '/nomina/correo', 'error', 'Perfil no encontrado');
  const payload = fromBody(req.body, req.session.tenantId, empresa._id);
  delete payload.codigo;
  delete payload.tenantId;
  delete payload.empresaId;
  Object.assign(doc, payload);
  await doc.save();
  if (doc.esDefault) {
    await ensureUnicoDefault(Correo, req.session.tenantId, empresa._id, doc._id);
  }
  return flashRedirect(req, res, '/nomina/correo', 'success', 'Perfil actualizado');
}

async function toggle(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const Correo = await getCorreoConfigModel();
  const doc = await Correo.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa?._id
  });
  if (doc) {
    doc.activo = !doc.activo;
    if (!doc.activo) doc.esDefault = false;
    await doc.save();
  }
  return res.redirect('/nomina/correo');
}

async function setDefault(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/correo', 'error', error || 'Sin empresa');
  const Correo = await getCorreoConfigModel();
  const doc = await Correo.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  });
  if (!doc) return flashRedirect(req, res, '/nomina/correo', 'error', 'Perfil no encontrado');
  doc.activo = true;
  doc.esDefault = true;
  await doc.save();
  await ensureUnicoDefault(Correo, req.session.tenantId, empresa._id, doc._id);
  return flashRedirect(req, res, '/nomina/correo', 'success', `${doc.codigo} es ahora el correo que envía`);
}

async function probar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const dest = trimString(req.body.destinatarioPrueba).toLowerCase();
  const back = `/nomina/correo/${req.params.id}/edit`;
  if (error || !empresa) return flashRedirect(req, res, '/nomina/correo', 'error', error || 'Sin empresa');
  if (!dest || !dest.includes('@')) {
    return flashRedirect(req, res, back, 'error', 'Indica un correo de prueba');
  }
  const Correo = await getCorreoConfigModel();
  const doc = await Correo.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  }).lean();
  if (!doc) return flashRedirect(req, res, '/nomina/correo', 'error', 'Perfil no encontrado');
  try {
    const cfg = aplicarPreset(doc);
    await probarCorreo(cfg, dest);
    await Correo.updateOne(
      { _id: doc._id },
      {
        $set: {
          ultimaPruebaAt: new Date(),
          ultimaPruebaOk: true,
          ultimaPruebaError: ''
        }
      }
    );
    return flashRedirect(req, res, back, 'success', `Prueba enviada a ${dest}`);
  } catch (err) {
    await Correo.updateOne(
      { _id: doc._id },
      {
        $set: {
          ultimaPruebaAt: new Date(),
          ultimaPruebaOk: false,
          ultimaPruebaError: err.message || String(err)
        }
      }
    );
    return flashRedirect(req, res, back, 'error', err.message || 'Falló la prueba');
  }
}

async function seedEjemplo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) return flashRedirect(req, res, '/nomina/correo', 'error', error || 'Sin empresa');
  const Correo = await getCorreoConfigModel();
  const exists = await Correo.findOne({
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    codigo: 'SIM'
  });
  if (!exists) {
    const count = await Correo.countDocuments({ tenantId: req.session.tenantId, empresaId: empresa._id });
    await Correo.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      codigo: 'SIM',
      nombre: 'Simulación (pruebas)',
      proveedor: 'simulacion',
      activo: true,
      esDefault: count === 0,
      fromNombre: empresa.razonSocial || empresa.nombreComercial || 'Nómina',
      fromEmail: 'nomina@localhost',
      notas: 'No conecta a SMTP. Marca recibos como enviados.'
    });
  }
  return flashRedirect(req, res, '/nomina/correo', 'success', 'Perfil de simulación listo');
}

module.exports = {
  list,
  newForm,
  edit,
  create,
  update,
  toggle,
  setDefault,
  probar,
  seedEjemplo
};
