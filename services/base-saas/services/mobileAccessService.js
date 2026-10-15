'use strict';

/**
 * Revocación de acceso móvil (JWT) y sesión web ligada al empleado/usuario.
 */

const { getUserModel } = require('../models/user');
const getEmpleadoModel = require('../models/empleado');

/**
 * Invalida tokens móviles (y sesión web) de usuarios vinculados al empleado.
 * El JWT lleva `mtv`; al incrementar mobileTokenVersion dejan de pasar el middleware.
 */
async function revokeMobileAccessForEmpleado(empleadoId, { tenantId } = {}) {
  if (!empleadoId) return { matched: 0 };
  const User = await getUserModel();
  // Solo por empleadoId (no filtrar tenantId: a veces viene vacío en User).
  void tenantId;
  const result = await User.updateMany(
    { empleadoId },
    {
      $inc: { mobileTokenVersion: 1 },
      $set: { activeSessionToken: '' }
    }
  );
  return { matched: result.matchedCount ?? result.n ?? 0 };
}

/**
 * Al desactivar un usuario SaaS: cierra web + móvil.
 */
async function revokeMobileAccessForUser(userId) {
  if (!userId) return;
  const User = await getUserModel();
  await User.updateOne(
    { _id: userId },
    {
      $inc: { mobileTokenVersion: 1 },
      $set: { activeSessionToken: '' }
    }
  );
}

/**
 * Valida claims JWT contra DB (usuario activo, versión de token, empleado activo).
 * @returns {{ user, empleado }}
 * @throws {{ status: number, error: string, code: string }}
 */
async function assertMobileAccess(decoded) {
  const User = await getUserModel();
  const user = await User.findById(decoded.userId)
    .select('activo tenantId empleadoId mobileTokenVersion email firstName lastName')
    .lean();

  if (!user || user.activo === false) {
    const err = new Error('Cuenta de usuario desactivada');
    err.status = 401;
    err.code = 'USER_INACTIVE';
    throw err;
  }

  const tokenMtv = Number(decoded.mtv ?? 0);
  const dbMtv = Number(user.mobileTokenVersion || 0);
  if (tokenMtv !== dbMtv) {
    const err = new Error('Sesión revocada. Inicia sesión de nuevo.');
    err.status = 401;
    err.code = 'SESSION_REVOKED';
    throw err;
  }

  if (user.tenantId && decoded.tenantId && String(user.tenantId) !== String(decoded.tenantId)) {
    const err = new Error('Token no válido para esta cuenta');
    err.status = 401;
    err.code = 'TENANT_MISMATCH';
    throw err;
  }

  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({
    _id: decoded.empleadoId,
    tenantId: decoded.tenantId
  })
    .select('estatus activo firstName lastName numEmpleado subsidiariaId')
    .lean();

  if (!empleado || empleado.estatus !== 'activo' || empleado.activo === false) {
    const err = new Error('Tu acceso fue dado de baja. Contacta a RRHH.');
    err.status = 401;
    err.code = 'EMPLEADO_BAJA';
    throw err;
  }

  return { user, empleado };
}

module.exports = {
  revokeMobileAccessForEmpleado,
  revokeMobileAccessForUser,
  assertMobileAccess
};
