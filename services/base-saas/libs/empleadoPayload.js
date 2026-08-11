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
const { TIPOS_BASE_COTIZACION } = require('../config/empleadoCatalogos');

const TIPOS_REGISTRO_VALIDOS = ['ninguno', 'rol_turnos', 'planilla'];
const TIPOS_CREDITO_INFONAVIT_VALIDOS = ['', 'porcentaje', 'vsm', 'cuota_fija'];
const TIPOS_SALARIO_VALIDOS = TIPOS_BASE_COTIZACION.map((t) => t.value);

function buildNominaConfigPayload(body) {
  const tipoCredito = trimString(body.nomina_tipoCreditoInfonavit);
  const despensaModalidadRaw = trimString(body.nomina_despensaModalidad) || 'ninguna';
  const despensaModalidad = ['ninguna', 'fijo', 'porcentaje'].includes(despensaModalidadRaw)
    ? despensaModalidadRaw
    : 'ninguna';
  const despensaTopeModoRaw = trimString(body.nomina_despensaTopeModo) || 'imss_40_uma';
  const despensaTopeModo = ['imss_40_uma', 'uma_mensual', 'monto', 'sin_tope'].includes(
    despensaTopeModoRaw
  )
    ? despensaTopeModoRaw
    : 'imss_40_uma';
  const despensaMontoMensual =
    parsePositiveNumber(body.nomina_despensaMontoMensual) ??
    parsePositiveNumber(body.nomina_despensaMonto) ??
    0;
  return {
    aplicaFondoAhorro: parseCheckbox(body, 'nomina_aplicaFondoAhorro'),
    porcentajeFondoAhorro: parsePositiveNumber(body.nomina_porcentajeFondoAhorro) ?? 0,
    despensaModalidad,
    despensaMonto: despensaMontoMensual,
    despensaMontoMensual,
    despensaPorcentaje: parsePositiveNumber(body.nomina_despensaPorcentaje) ?? 0,
    despensaTopeModo,
    despensaTopeMonto: parsePositiveNumber(body.nomina_despensaTopeMonto) ?? 0,
    seguroVidaMonto: parsePositiveNumber(body.nomina_seguroVidaMonto) ?? 0,
    sgmmMonto: parsePositiveNumber(body.nomina_sgmmMonto) ?? 0,
    tipoCreditoInfonavit: TIPOS_CREDITO_INFONAVIT_VALIDOS.includes(tipoCredito) ? tipoCredito : '',
    tasaInfonavit: parsePositiveNumber(body.nomina_tasaInfonavit) ?? 0,
    infonavitDescuento: parsePositiveNumber(body.nomina_infonavitDescuento) ?? 0,
    diasCotizacionImss: parsePositiveNumber(body.nomina_diasCotizacionImss) ?? 0,
    sueldoIntegrado: parsePositiveNumber(body.nomina_sueldoIntegrado) ?? 0,
    diasPrimaVacacional: parsePositiveNumber(body.nomina_diasPrimaVacacional) ?? 0,
    primaVacacionalPct: parsePositiveNumber(body.nomina_primaVacacionalPct) ?? 0,
    proporcionAguinaldoFiniquito: parsePositiveNumber(body.nomina_proporcionAguinaldoFiniquito) ?? 0,
    fondoAhorroSaldoFiniquito: parsePositiveNumber(body.nomina_fondoAhorroSaldoFiniquito) ?? 0
  };
}

function composeLastName(apellidoPaterno, apellidoMaterno, fallback) {
  const parts = [apellidoPaterno, apellidoMaterno].map((s) => String(s || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return trimString(fallback) || '';
}

function buildEmpleadoPayload(body, tenantId, empresaId) {
  const estatus = trimString(body.estatus) || 'activo';
  const fechaBaja = parseDate(body.fechaBaja);
  const tipoRegistro = trimString(body.tipoRegistro);
  const tipoRegistroFinal = TIPOS_REGISTRO_VALIDOS.includes(tipoRegistro) ? tipoRegistro : 'rol_turnos';
  const apellidoPaterno = trimString(body.apellidoPaterno);
  const apellidoMaterno = trimString(body.apellidoMaterno);
  const lastName = composeLastName(apellidoPaterno, apellidoMaterno, body.lastName);
  const tipoSalarioRaw = trimString(body.tipoSalario) || 'fijo';
  const tipoSalario = TIPOS_SALARIO_VALIDOS.includes(tipoSalarioRaw) ? tipoSalarioRaw : 'fijo';

  const cp = trimString(body.domicilio_codigoPostal || body.codigoPostal).replace(/\D/g, '').slice(0, 5);

  return {
    tenantId,
    empresaId,
    subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
    numEmpleado: trimString(body.numEmpleado),
    firstName: trimString(body.firstName),
    apellidoPaterno,
    apellidoMaterno,
    lastName: lastName || trimString(body.lastName) || '.',
    curp: trimUpper(body.curp),
    rfc: trimUpper(body.rfc),
    nss: trimString(body.nss),
    fechaNacimiento: parseDate(body.fechaNacimiento),
    sexo: trimString(body.sexo),
    estadoCivil: trimString(body.estadoCivil),
    entidadNacimiento: trimUpper(body.entidadNacimiento),
    ciudadNacimiento: trimString(body.ciudadNacimiento),
    registroPatronal: trimUpper(body.registroPatronal),
    umf: trimString(body.umf),
    email: trimLower(body.email),
    emailPersonal: trimLower(body.emailPersonal),
    telefono: trimString(body.telefono),
    telefonoFijo: trimString(body.telefonoFijo),
    domicilio: {
      calle: trimString(body.domicilio_calle),
      numeroExt: trimString(body.domicilio_numeroExt),
      numeroInt: trimString(body.domicilio_numeroInt),
      colonia: trimString(body.domicilio_colonia),
      poblacion: trimString(body.domicilio_poblacion),
      entidad: trimString(body.domicilio_entidad),
      codigoPostal: cp
    },
    departamentoId: parseOptionalObjectId(body.departamentoId),
    puestoId: parseOptionalObjectId(body.puestoId),
    tablaPrestacionesId: parseOptionalObjectId(body.tablaPrestacionesId),
    turnoId: parseOptionalObjectId(body.turnoId),
    tipoPeriodoId: parseOptionalObjectId(body.tipoPeriodoId),
    supervisorId: parseOptionalObjectId(body.supervisorId),
    tipoContrato: trimString(body.tipoContrato) || 'indefinido',
    tipoEmpleado: trimString(body.tipoEmpleado),
    salarioDiario: parsePositiveNumber(body.salarioDiario),
    tipoSalario,
    sdi: parsePositiveNumber(body.sdi) ?? 0,
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

module.exports = { buildEmpleadoPayload, buildNominaConfigPayload, composeLastName };
