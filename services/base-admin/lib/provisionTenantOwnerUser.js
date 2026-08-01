'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const generator = require('generate-password');

const ROLES_COLL = (process.env.BASE_COLLECTION_ROLES || 'saas_roles').trim();
const USERS_COLL = (process.env.BASE_COLLECTION_USERS || 'saas_users').trim();
const ROLE_NAME = (process.env.BASE_OWNER_ROLE_NAME || 'Admin Completo').trim();

async function resolveOwnerRole(roles, options) {
  const idStr = String(options.ownerRoleId || process.env.BASE_OWNER_ROLE_ID || '').trim();
  if (idStr && mongoose.Types.ObjectId.isValid(idStr)) {
    const byId = await roles.findOne({ _id: new mongoose.Types.ObjectId(idStr) });
    if (byId) return byId;
    return null;
  }
  return roles.findOne({
    nombre: ROLE_NAME,
    $or: [{ activo: true }, { activo: { $exists: false } }]
  });
}

async function provisionTenantOwnerUser(tenantLean, options = {}) {
  if (!tenantLean?.tenantId) return { skipped: true, reason: 'MISSING_TENANT' };

  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongo no conectado');

  const tenantId = tenantLean.tenantId;
  const users = db.collection(USERS_COLL);
  const roles = db.collection(ROLES_COLL);

  if ((await users.countDocuments({ tenantId })) > 0) {
    return { skipped: true, reason: 'ALREADY_HAS_USERS' };
  }

  let email = String(options.ownerEmail || process.env.BASE_DEFAULT_OWNER_EMAIL || '').trim().toLowerCase();
  if (!email) {
    return { skipped: true, reason: 'NO_EMAIL' };
  }

  if (await users.findOne({ email })) {
    return { skipped: true, reason: 'EMAIL_TAKEN', email };
  }

  const roleDoc = await resolveOwnerRole(roles, options);
  if (!roleDoc) {
    return { skipped: true, reason: 'ROLE_NOT_FOUND', hint: `Ejecuta seed en arka-presence-saas o crea rol "${ROLE_NAME}"` };
  }

  let plainPassword =
    String(options.ownerPassword || '').trim() ||
    String(process.env.BASE_OWNER_DEFAULT_PASSWORD || '').trim();
  if (!plainPassword) {
    plainPassword = generator.generate({ length: 10, numbers: true, uppercase: true, lowercase: true, strict: true });
  }

  const hash = await bcrypt.hash(plainPassword, 10);
  const slug = String(tenantLean.slug || 'tenant').replace(/[^a-z0-9-]/gi, '-');
  let userName = `admin.${slug}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48);
  let n = 0;
  while (await users.findOne({ userName })) {
    n += 1;
    userName = `admin.${slug}.${n}`.slice(0, 60);
  }

  const now = new Date();
  await users.insertOne({
    firstName: options.ownerFirstName || 'Admin',
    lastName: options.ownerLastName || String(tenantLean.displayName || '').slice(0, 80),
    userName,
    email,
    password: hash,
    roles: [roleDoc._id],
    tenantId,
    activo: true,
    createdAt: now,
    updatedAt: now
  });

  return { ok: true, email, userName, temporaryPassword: plainPassword, role: roleDoc.nombre };
}

module.exports = { provisionTenantOwnerUser };
