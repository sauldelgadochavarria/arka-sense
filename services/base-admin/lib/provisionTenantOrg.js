'use strict';

const mongoose = require('mongoose');

/**
 * Crea empresa + subsidiaria inicial al activar un tenant.
 */
async function provisionEmpresaYSubsidiaria(tenantDoc, options = {}) {
  if (!tenantDoc?.tenantId) return { ok: false, error: 'missing_tenant' };

  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo no conectado');

  const tenantId = tenantDoc.tenantId;
  const displayName = tenantDoc.displayName || tenantDoc.slug || 'Organización';
  const codigo = String(options.codigo || 'MAIN').trim().toUpperCase();

  const empresas = db.collection('empresas');
  const subsidiarias = db.collection('subsidiarias');
  const now = new Date();

  let empresaId;
  const existingEmp = await empresas.findOne({ tenantId });
  if (existingEmp) {
    empresaId = existingEmp._id;
    await empresas.updateOne(
      { _id: empresaId },
      { $set: { razonSocial: displayName, activo: true, updatedAt: now } }
    );
  } else {
    const r = await empresas.insertOne({
      tenantId,
      razonSocial: displayName,
      nombreComercial: displayName,
      activo: true,
      createdAt: now,
      updatedAt: now
    });
    empresaId = r.insertedId;
  }

  const subEx = await subsidiarias.findOne({ codigo });
  if (subEx && String(subEx.empresaId) !== String(empresaId)) {
    return { ok: false, code: 'CODIGO_CONFLICT', error: 'El código ya existe en otra subsidiaria' };
  }

  if (subEx) {
    return { ok: true, empresaId, subsidiariaId: subEx._id, updated: true };
  }

  const r2 = await subsidiarias.insertOne({
    empresaId,
    nombre: `${displayName} — Principal`,
    codigo,
    direccion: options.direccion || 'Por definir',
    ciudad: options.ciudad || '',
    activo: true,
    createdAt: now,
    updatedAt: now
  });

  return { ok: true, empresaId, subsidiariaId: r2.insertedId, created: true };
}

module.exports = { provisionEmpresaYSubsidiaria };
