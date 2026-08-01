'use strict';

const getCentroCostoModel = require('../models/centroCosto');

async function listCentrosCosto(tenantId) {
  const CentroCosto = await getCentroCostoModel();
  return CentroCosto.find({ tenantId }).sort({ codigo: 1 }).lean();
}

async function crearCentroCosto(tenantId, empresaId, data) {
  const CentroCosto = await getCentroCostoModel();
  const codigo = String(data.codigo || '').trim().toUpperCase();
  if (!codigo) throw new Error('Código requerido');

  return CentroCosto.create({
    tenantId,
    empresaId,
    codigo,
    nombre: String(data.nombre || '').trim(),
    descripcion: String(data.descripcion || '').trim(),
    codigoLegado: data.codigoLegado != null ? Number(data.codigoLegado) : null,
    codigoExterno: String(data.codigoExterno || '').trim(),
    cuentaContableExterna: String(data.cuentaContableExterna || '').trim(),
    activo: true
  });
}

async function toggleCentroCosto(tenantId, id) {
  const CentroCosto = await getCentroCostoModel();
  const doc = await CentroCosto.findOne({ tenantId, _id: id });
  if (!doc) throw new Error('Centro de costo no encontrado');
  doc.activo = !doc.activo;
  await doc.save();
}

async function getCentroCostoById(tenantId, id) {
  const CentroCosto = await getCentroCostoModel();
  return CentroCosto.findOne({ tenantId, _id: id }).lean();
}

async function actualizarCentroCosto(tenantId, id, data) {
  const CentroCosto = await getCentroCostoModel();
  const doc = await CentroCosto.findOne({ tenantId, _id: id });
  if (!doc) throw new Error('Centro de costo no encontrado');

  const codigo = String(data.codigo || doc.codigo).trim().toUpperCase();
  if (!codigo) throw new Error('Código requerido');

  doc.codigo = codigo;
  doc.nombre = String(data.nombre || '').trim();
  doc.descripcion = String(data.descripcion || '').trim();
  doc.codigoLegado = data.codigoLegado != null && data.codigoLegado !== '' ? Number(data.codigoLegado) : null;
  doc.codigoExterno = String(data.codigoExterno || '').trim();
  doc.cuentaContableExterna = String(data.cuentaContableExterna || '').trim();
  await doc.save();
  return doc.toObject();
}

module.exports = {
  listCentrosCosto,
  crearCentroCosto,
  getCentroCostoById,
  actualizarCentroCosto,
  toggleCentroCosto
};
