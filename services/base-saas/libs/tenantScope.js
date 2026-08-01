'use strict';

const mongoose = require('mongoose');
const getEmpresaModel = require('../models/empresa');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

async function findOneByTenant(Model, tenantId, id) {
  if (!tenantId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, tenantId }).lean();
}

async function findOneDocByTenant(Model, tenantId, id) {
  if (!tenantId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, tenantId });
}

async function findOneByEmpresa(Model, empresaId, id) {
  if (!empresaId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, empresaId }).lean();
}

async function findOneDocByEmpresa(Model, empresaId, id) {
  if (!empresaId || !isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, empresaId });
}

async function requireEmpresaForTenant(tenantId) {
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  if (!empresa) return { error: 'Empresa no encontrada para este tenant' };
  return { empresa };
}

module.exports = {
  isValidObjectId,
  findOneByTenant,
  findOneDocByTenant,
  findOneByEmpresa,
  findOneDocByEmpresa,
  requireEmpresaForTenant
};
