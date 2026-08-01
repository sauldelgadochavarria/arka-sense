'use strict';

const {
  trimString,
  trimUpper,
  trimLower,
  parseOptionalObjectId,
  parseDate,
  parsePositiveNumber,
  parseCheckbox
} = require('./formHelpers');

const TIPOS_REGISTRO_VALIDOS = ['ninguno', 'rol_turnos', 'planilla'];
const TIPOS_CREDITO_INFONAVIT_VALIDOS = ['', 'porcentaje', 'vsm', 'cuota_fija'];

function buildNominaConfigPayload(body) {
  const tipoCredito = trimString(body.nomina_tipoCreditoInfonavit);
  return {
    aplicaFondoAhorro: parseCheckbox(body, 'nomina_aplicaFondoAhorro'),
    porcentajeFondoAhorro: parsePositiveNumber(body.nomina_porcentajeFondoAhorro) ?? 0,
    tipoCreditoInfonavit: TIPOS_CREDITO_INFONAVIT_VALIDOS.includes(tipoCredito) ? tipoCredito : '',
    tasaInfonavit: parsePositiveNumber(body.nomina_tasaInfonavit) ?? 0,
    infonavitDescuento: parsePositiveNumber(body.nomina_infonavitDescuento) ?? 0,
    diasCotizacionImss: parsePositiveNumber(body.nomina_diasCotizacionImss) ?? 0,
    sueldoIntegrado: parsePositiveNumber(body.nomina_sueldoIntegrado) ?? 0,
    diasPrimaVacacional: parsePositiveNumber(body.nomina_diasPrimaVacacional) ?? 0,
    proporcionAguinaldoFiniquito: parsePositiveNumber(body.nomina_proporcionAguinaldoFiniquito) ?? 0,
    fondoAhorroSaldoFiniquito: parsePositiveNumber(body.nomina_fondoAhorroSaldoFiniquito) ?? 0
  };
}

function buildEmpleadoPayload(body, tenantId, empresaId) {
  const estatus = trimString(body.estatus) || 'activo';
  const fechaBaja = parseDate(body.fechaBaja);
  const tipoRegistro = trimString(body.tipoRegistro);
  const tipoRegistroFinal = TIPOS_REGISTRO_VALIDOS.includes(tipoRegistro) ? tipoRegistro : 'rol_turnos';

  return {
    tenantId,
    empresaId,
    subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
    numEmpleado: trimString(body.numEmpleado),
    firstName: trimString(body.firstName),
    lastName: trimString(body.lastName),
    curp: trimUpper(body.curp),
    rfc: trimUpper(body.rfc),
    nss: trimString(body.nss),
    fechaNacimiento: parseDate(body.fechaNacimiento),
    sexo: trimString(body.sexo),
    email: trimLower(body.email),
    emailPersonal: trimLower(body.emailPersonal),
    telefono: trimString(body.telefono),
    telefonoFijo: trimString(body.telefonoFijo),
    departamentoId: parseOptionalObjectId(body.departamentoId),
    puestoId: parseOptionalObjectId(body.puestoId),
    turnoId: parseOptionalObjectId(body.turnoId),
    supervisorId: parseOptionalObjectId(body.supervisorId),
    tipoContrato: trimString(body.tipoContrato) || 'indefinido',
    salarioDiario: parsePositiveNumber(body.salarioDiario),
    fechaIngreso: parseDate(body.fechaIngreso),
    fechaBaja: estatus === 'baja' ? fechaBaja || new Date() : null,
    motivoBaja: estatus === 'baja' ? trimString(body.motivoBaja) : '',
    estatus,
    activo: estatus !== 'baja',
    codigoExterno: trimString(body.codigoExterno),
    tipoRegistro: tipoRegistroFinal,
    grupoDispositivosId: parseOptionalObjectId(body.grupoDispositivosId),
    exportarFaltas: parseCheckbox(body, 'exportarFaltas'),
    exportarRetardos: parseCheckbox(body, 'exportarRetardos'),
    exportarHorasExtra: parseCheckbox(body, 'exportarHorasExtra'),
    nominaConfig: buildNominaConfigPayload(body)
  };
}

module.exports = { buildEmpleadoPayload, buildNominaConfigPayload };
