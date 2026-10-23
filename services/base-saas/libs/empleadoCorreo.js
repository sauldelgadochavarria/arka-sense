'use strict';

function normalizarCorreo(value) {
  return String(value || '').trim().toLowerCase();
}

function correosDeEmpleado(src) {
  return [...new Set(
    [normalizarCorreo(src?.email), normalizarCorreo(src?.emailPersonal)].filter(Boolean)
  )];
}

function nombreEmpleado(emp) {
  return [emp?.firstName, emp?.apellidoPaterno || emp?.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Busca si alguno de los correos ya está en otro empleado del mismo tenant
 * (corporativo o personal). Los vacíos no cuentan.
 * @returns {Promise<string|null>} mensaje listo para mostrar, o null
 */
async function mensajeCorreoDuplicado(Empleado, tenantId, src, excludeId) {
  const correos = correosDeEmpleado(src);
  if (!tenantId || !correos.length) return null;

  const filter = {
    tenantId,
    $or: [{ email: { $in: correos } }, { emailPersonal: { $in: correos } }]
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const otros = await Empleado.find(filter)
    .select('numEmpleado firstName lastName apellidoPaterno email emailPersonal')
    .limit(10)
    .lean();
  if (!otros.length) return null;

  const partes = [];
  for (const correo of correos) {
    const otro = otros.find(
      (e) => normalizarCorreo(e.email) === correo || normalizarCorreo(e.emailPersonal) === correo
    );
    if (!otro) continue;
    const nombre = nombreEmpleado(otro);
    partes.push(`${correo} (No. ${otro.numEmpleado}${nombre ? `, ${nombre}` : ''})`);
  }
  if (!partes.length) return null;
  return `Ese correo ya está en otro empleado de esta cuenta: ${partes.join('; ')}.`;
}

function errorCorreoDuplicado(mensaje) {
  const err = new Error(mensaje);
  err.code = 'CORREO_DUPLICADO';
  return err;
}

module.exports = {
  normalizarCorreo,
  correosDeEmpleado,
  mensajeCorreoDuplicado,
  errorCorreoDuplicado
};
