'use strict';

function getEmpleadoExportId(empleado) {
  const codigo = String(empleado?.codigoExterno || '').trim();
  return codigo || empleado?.numEmpleado || '';
}

function shouldQualifyAttendance(empleado) {
  const tipo = empleado?.tipoRegistro || 'rol_turnos';
  return tipo !== 'ninguno';
}

module.exports = { getEmpleadoExportId, shouldQualifyAttendance };
