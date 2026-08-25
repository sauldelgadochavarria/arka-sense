'use strict';

const crypto = require('crypto');
const getFiniquitoCalculoModel = require('../../models/finiquitoCalculo');
const getEmpleadoModel = require('../../models/empleado');
const getEmpresaModel = require('../../models/empresa');
const getPeriodoNominaModel = require('../../models/periodoNomina');
const getReciboNominaModel = require('../../models/reciboNomina');
const getConceptoAplicadoModel = require('../../models/conceptoAplicado');
const {
  DEFAULTS_FINIQUITO,
  sugerenciaPorCausa,
  mapMotivoBajaToCausa,
  causaByCodigo
} = require('../../config/finiquitoCatalog');
const {
  calcularComponentesLaborales,
  aplicarNegociacion,
  clasificarFiscalBasico,
  totalizar
} = require('./finiquitoCalculators');
const { resolverTablaPrestaciones } = require('../sdiCalculoService');
const { obtenerParametrosVigentes } = require('../nomina/tablasFiscalesService');
const { parseDate } = require('../../libs/formHelpers');
const { asignarNumeroPeriodo } = require('../../libs/periodoNumero');
const { startOfDay, endOfDay, diasCalendarioInclusive } = require('../../libs/timeHelpers');
const { getTipoPeriodoById } = require('../tipoPeriodoNominaService');
const {
  calcularDeduccionesFiniquito,
  fusionarConceptosConDeducciones
} = require('./finiquitoDeduccionesService');
const { buildSeparacionIndemnizacionData } = require('../cfdi/separacionIndemnizacionBuilder');

function nombreEmp(e) {
  return `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.numEmpleado || '';
}

function omitUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildParametrosDesdeEmpleado(empleado, tabla, overrides = {}) {
  const clean = omitUndefined(overrides);
  const sugerencia = sugerenciaPorCausa(clean.causaTerminacion || mapMotivoBajaToCausa(empleado.motivoBaja));
  const salarioDiario = Number(clean.salarioDiario != null ? clean.salarioDiario : empleado.salarioDiario) || 0;
  const pctPrimaTabla = Number(tabla?.primaVacacionalPct);
  const pctPrima =
    clean.porcentajePrimaVacacional != null
      ? Number(clean.porcentajePrimaVacacional)
      : pctPrimaTabla > 1
        ? pctPrimaTabla / 100
        : pctPrimaTabla > 0
          ? pctPrimaTabla
          : DEFAULTS_FINIQUITO.porcentajePrimaVacacional;

  const aniosMinPrima = sugerencia.aplicaPrimaAntiguedadSiAnios;
  let aplicaPrima = clean.aplicaPrimaAntiguedad;
  if (aplicaPrima == null && aniosMinPrima != null) {
    aplicaPrima = undefined;
  }

  return {
    ...DEFAULTS_FINIQUITO,
    fechaIngreso: clean.fechaIngreso || empleado.fechaIngreso || empleado.fechaAlta || empleado.hireDate,
    fechaBaja: clean.fechaBaja || empleado.fechaBaja || new Date(),
    salarioDiario,
    salarioMinimo: Number(clean.salarioMinimo) || 0,
    vecesSalarioMinimoTopeLft:
      Number(clean.vecesSalarioMinimoTopeLft) > 0
        ? Number(clean.vecesSalarioMinimoTopeLft)
        : DEFAULTS_FINIQUITO.vecesSalarioMinimoTopeLft,
    salarioBaseIndemnizacion: Number(
      clean.salarioBaseIndemnizacion != null ? clean.salarioBaseIndemnizacion : salarioDiario
    ),
    salarioBasePrimaAntiguedad: Number(
      clean.salarioBasePrimaAntiguedad != null ? clean.salarioBasePrimaAntiguedad : salarioDiario
    ),
    diasAguinaldo:
      Number(clean.diasAguinaldo != null ? clean.diasAguinaldo : tabla?.diasAguinaldo) ||
      DEFAULTS_FINIQUITO.diasAguinaldo,
    porcentajePrimaVacacional: pctPrima,
    diasVacacionesPendientes: Number(clean.diasVacacionesPendientes) || 0,
    diasVacacionesProporcionales: clean.diasVacacionesProporcionales,
    diasVacacionesAnuales: clean.diasVacacionesAnuales,
    diasPendientes: Number(clean.diasPendientes) || 0,
    variablesDevengadas: Number(clean.variablesDevengadas) || 0,
    fondoAhorroSaldo:
      Number(
        clean.fondoAhorroSaldo != null
          ? clean.fondoAhorroSaldo
          : empleado.nominaConfig?.fondoAhorroSaldoFiniquito
      ) || 0,
    tablaVacaciones: tabla?.vacacionesPorAntiguedad || [],
    aplicaPrimaAntiguedad: aplicaPrima,
    aplicaPrimaAntiguedadSiAnios: aniosMinPrima,
    aplicaIndemnizacionTresMeses:
      clean.aplicaIndemnizacionTresMeses != null
        ? !!clean.aplicaIndemnizacionTresMeses
        : !!sugerencia.aplicaIndemnizacionTresMeses,
    aplica20DiasPorAnio:
      clean.aplica20DiasPorAnio != null ? !!clean.aplica20DiasPorAnio : !!sugerencia.aplica20DiasPorAnio,
    aplicaSalariosVencidos: !!clean.aplicaSalariosVencidos,
    salariosVencidosImporte: Number(clean.salariosVencidosImporte) || 0,
    salariosVencidosDias: Number(clean.salariosVencidosDias) || 0,
    conceptosExtra: clean.conceptosExtra || [],
    usarAniosProporcionalesIndemnizacion:
      clean.usarAniosProporcionalesIndemnizacion != null
        ? !!clean.usarAniosProporcionalesIndemnizacion
        : DEFAULTS_FINIQUITO.usarAniosProporcionalesIndemnizacion,
    // Solo overrides explícitos (sin undefined) para no pisar salario/fechas del expediente
    ...omitUndefined({
      fechaIngreso: clean.fechaIngreso,
      diasAguinaldo: clean.diasAguinaldo,
      porcentajePrimaVacacional: clean.porcentajePrimaVacacional,
      diasVacacionesPendientes: clean.diasVacacionesPendientes,
      diasVacacionesProporcionales: clean.diasVacacionesProporcionales,
      diasVacacionesAnuales: clean.diasVacacionesAnuales,
      diasPendientes: clean.diasPendientes,
      variablesDevengadas: clean.variablesDevengadas,
      fondoAhorroSaldo: clean.fondoAhorroSaldo,
      salarioDiario: clean.salarioDiario,
      salarioMinimo: clean.salarioMinimo,
      vecesSalarioMinimoTopeLft: clean.vecesSalarioMinimoTopeLft,
      salarioBaseIndemnizacion: clean.salarioBaseIndemnizacion,
      salarioBasePrimaAntiguedad: clean.salarioBasePrimaAntiguedad,
      aplicaPrimaAntiguedad: clean.aplicaPrimaAntiguedad,
      aplicaIndemnizacionTresMeses: clean.aplicaIndemnizacionTresMeses,
      aplica20DiasPorAnio: clean.aplica20DiasPorAnio,
      aplicaSalariosVencidos: clean.aplicaSalariosVencidos,
      salariosVencidosImporte: clean.salariosVencidosImporte,
      salariosVencidosDias: clean.salariosVencidosDias,
      conceptosExtra: clean.conceptosExtra,
      usarAniosProporcionalesIndemnizacion: clean.usarAniosProporcionalesIndemnizacion,
      usarAniosProporcionalesPrima: clean.usarAniosProporcionalesPrima,
      diasAnio: clean.diasAnio,
      fechaBaja: clean.fechaBaja
    })
  };
}

async function previewCalculo({ tenantId, empresaId, empleadoId, causaTerminacion, fechaBaja, parametros = {}, negociacion = {} }) {
  const Empleado = await getEmpleadoModel();
  const Empresa = await getEmpresaModel();
  const empleado = await Empleado.findOne({ _id: empleadoId, tenantId }).lean();
  if (!empleado) throw new Error('Empleado no encontrado');
  const empresa = await Empresa.findOne({ _id: empresaId, tenantId }).lean();
  const resolved = await resolverTablaPrestaciones(tenantId, empresaId, empleado);
  const tabla = resolved?.tabla || resolved || null;
  const fechaRef = fechaBaja || parametros.fechaBaja || empleado.fechaBaja || new Date();
  let salarioMinimoVigente = Number(parametros.salarioMinimo) || 0;
  let umaDiaria = Number(empresa?.parametrosFiscales?.uma || empresa?.uma || 0) || 0;
  let topeUmaFondoAhorro = 1.3;
  let diasAnioFondoAhorro = 365;
  let fondoAhorroTopeExento = 0;
  let multiplicadorExencionSeparacion = 90;
  let diasRedondeoAnioLisr = 183;
  let diasAnioLisr = 365;
  try {
    const fiscalesParams = await obtenerParametrosVigentes(fechaRef);
    if (!(salarioMinimoVigente > 0)) {
      salarioMinimoVigente = Number(fiscalesParams?.salarioMinimo) || 0;
    }
    umaDiaria = Number(fiscalesParams.uma) || umaDiaria;
    topeUmaFondoAhorro = Number(fiscalesParams.topeUmaFondoAhorro) || 1.3;
    diasAnioFondoAhorro = Number(fiscalesParams.diasAnioFondoAhorro) || 365;
    fondoAhorroTopeExento = Number(fiscalesParams.topeAnualFondoAhorro) || 0;
    multiplicadorExencionSeparacion = Number(fiscalesParams.multiplicadorExencionSeparacion) || 90;
    diasRedondeoAnioLisr = Number(fiscalesParams.diasRedondeoAnioLisr) || 183;
    diasAnioLisr = Number(fiscalesParams.diasAnioLisr) || 365;
  } catch {
    /* fallback: UMA/SM ya tomados de empresa / override */
  }

  const causa = String(causaTerminacion || mapMotivoBajaToCausa(empleado.motivoBaja) || 'OTRO').toUpperCase();
  if (!causaByCodigo(causa)) throw new Error(`Causa de terminación inválida: ${causa}`);

  const fechaIngresoOverride = parametros.fechaIngreso ? parseDate(parametros.fechaIngreso) || parametros.fechaIngreso : undefined;

  const params = buildParametrosDesdeEmpleado(empleado, tabla, {
    ...parametros,
    causaTerminacion: causa,
    fechaBaja: fechaBaja || parametros.fechaBaja || empleado.fechaBaja || new Date(),
    fechaIngreso: fechaIngresoOverride,
    salarioMinimo: salarioMinimoVigente
  });

  const laboral = calcularComponentesLaborales(params);
  const neg = aplicarNegociacion(laboral.conceptos, negociacion, params);

  const fiscales = clasificarFiscalBasico(neg.conceptos, {
    umaDiaria,
    diasTotalesServicio: laboral.antiguedad.diasTotales,
    fondoAhorroTopeExento,
    topeUmaFondoAhorro,
    diasAnioFondoAhorro,
    multiplicadorExencionSeparacion,
    diasRedondeoAnioLisr,
    diasAnioLisr
  });

  let conceptosFinales = fiscales;
  let resumenDeducciones = null;
  try {
    const ded = await calcularDeduccionesFiniquito({
      conceptos: fiscales,
      empleado,
      parametros: params,
      tenantId,
      fechaRef: params.fechaBaja || fechaRef
    });
    conceptosFinales = fusionarConceptosConDeducciones(fiscales, ded.deducciones);
    resumenDeducciones = ded.resumen;
  } catch (err) {
    console.warn('[finiquito] deducciones:', err.message);
  }

  const totales = totalizar(conceptosFinales);
  totales.ajustesNegociacion = neg.ajustesNegociacion;
  totales.umaDiaria = umaDiaria;
  const sepDet = (conceptosFinales.find((c) => c.detalle && c.detalle.topeExentoSeparacion != null) || {}).detalle || {};
  totales.fiscalSeparacion = {
    aniosServicioLisr: sepDet.aniosServicioLisr ?? 0,
    multiplicadorExencionSeparacion,
    diasRedondeoAnioLisr,
    diasAnioLisr,
    topeExentoSeparacion: sepDet.topeExentoSeparacion ?? 0,
    sumaTotalSeparacion: sepDet.sumaTotalSeparacion ?? 0,
    exentoTotalSeparacion: sepDet.exentoTotalSeparacion ?? 0,
    gravadoTotalSeparacion: sepDet.gravadoTotalSeparacion ?? 0
  };
  if (resumenDeducciones) totales.deduccionesDetalle = resumenDeducciones;

  const sepCfdi = buildSeparacionIndemnizacionData({
    conceptos: conceptosFinales,
    antiguedad: laboral.antiguedad,
    salarioDiario: params.salarioDiario,
    fiscalSeparacion: totales.fiscalSeparacion
  });
  if (sepCfdi.aplica) {
    totales.fiscalSeparacion = {
      ...totales.fiscalSeparacion,
      ultimoSueldoMensOrd: sepCfdi.UltimoSueldoMensOrd,
      ingresoAcumulable: sepCfdi.IngresoAcumulable,
      ingresoNoAcumulable: sepCfdi.IngresoNoAcumulable,
      totalPagadoSeparacion: sepCfdi.TotalPagado,
      numAniosServicioSat: sepCfdi.NumAniosServicio
    };
    totales.cfdiSeparacionIndemnizacion = {
      TotalPagado: sepCfdi.TotalPagado,
      NumAniosServicio: sepCfdi.NumAniosServicio,
      UltimoSueldoMensOrd: sepCfdi.UltimoSueldoMensOrd,
      IngresoAcumulable: sepCfdi.IngresoAcumulable,
      IngresoNoAcumulable: sepCfdi.IngresoNoAcumulable,
      TotalSeparacionIndemnizacion: sepCfdi.TotalSeparacionIndemnizacion,
      conceptos: sepCfdi.conceptos,
      fuente: sepCfdi.fuente
    };
  } else {
    totales.cfdiSeparacionIndemnizacion = null;
  }

  return {
    empleado: {
      id: String(empleado._id),
      numEmpleado: empleado.numEmpleado,
      nombre: nombreEmp(empleado),
      fechaIngreso: params.fechaIngreso,
      fechaBaja: params.fechaBaja,
      salarioDiario: params.salarioDiario
    },
    causaTerminacion: causa,
    parametros: params,
    negociacion,
    antiguedad: laboral.antiguedad,
    conceptos: conceptosFinales,
    totales,
    resumenLaboral: laboral.resumen,
    resumenDeducciones,
    alertas: [
      ...(params.salarioDiario <= 0 ? ['Salario diario en 0: revisa el expediente o captura un override.'] : []),
      ...(!(params.salarioMinimo > 0)
        ? ['Sin salario mínimo vigente en parámetros fiscales: no se aplicó tope Arts. 485/486.']
        : []),
      ...(laboral.antiguedad.aniosCompletos >= 40
        ? [
            `Antigüedad muy alta (${laboral.antiguedad.aniosCompletos} años). Fecha de ingreso usada: ${
              params.fechaIngreso ? new Date(params.fechaIngreso).toISOString().slice(0, 10) : 'sin fecha'
            }. Corrígela en el campo «Fecha de ingreso (cálculo)» o en el expediente.`
          ]
        : []),
      ...(!params.fechaIngreso ? ['El empleado no tiene fecha de ingreso.'] : []),
      ...(conceptosFinales.some((c) => c.codigo === 'FIN_PRIMA_ANTIGUEDAD' && c.detalle && c.detalle.topado)
        ? [
            `Prima de antigüedad: base topada a ${params.vecesSalarioMinimoTopeLft}× SM ($${Number(params.salarioMinimo).toFixed(2)}) = $${Number(
              conceptosFinales.find((c) => c.codigo === 'FIN_PRIMA_ANTIGUEDAD').detalle.tope
            ).toFixed(2)} (LFT Arts. 485 y 486).`
          ]
        : []),
      ...(resumenDeducciones?.isrSeparacion > 0
        ? ['ISR de separación es estimación Art. 95 (tasa del sueldo mensual); el motor CFDI definitivo está pendiente.']
        : [])
    ]
  };
}

async function crearYCalcular({
  tenantId,
  empresaId,
  empleadoId,
  causaTerminacion,
  fechaBaja,
  parametros = {},
  negociacion = {},
  periodoId = null,
  notas = '',
  user = {}
}) {
  const preview = await previewCalculo({
    tenantId,
    empresaId,
    empleadoId,
    causaTerminacion,
    fechaBaja,
    parametros,
    negociacion
  });

  const Finiquito = await getFiniquitoCalculoModel();
  const doc = await Finiquito.create({
    tenantId,
    empresaId,
    empleadoId,
    numEmpleado: preview.empleado.numEmpleado,
    nombreEmpleado: preview.empleado.nombre,
    periodoId: periodoId || null,
    fechaIngreso: preview.parametros.fechaIngreso,
    fechaBaja: preview.parametros.fechaBaja,
    causaTerminacion: preview.causaTerminacion,
    estatus: 'calculado',
    parametros: {
      salarioDiario: preview.parametros.salarioDiario,
      salarioBaseIndemnizacion: preview.parametros.salarioBaseIndemnizacion,
      salarioBasePrimaAntiguedad: preview.parametros.salarioBasePrimaAntiguedad,
      diasAguinaldo: preview.parametros.diasAguinaldo,
      porcentajePrimaVacacional: preview.parametros.porcentajePrimaVacacional,
      diasVacacionesPendientes: preview.parametros.diasVacacionesPendientes,
      diasPendientes: preview.parametros.diasPendientes,
      aplicaPrimaAntiguedad: preview.parametros.aplicaPrimaAntiguedad,
      aplicaPrimaAntiguedadSiAnios: preview.parametros.aplicaPrimaAntiguedadSiAnios,
      aplicaIndemnizacionTresMeses: preview.parametros.aplicaIndemnizacionTresMeses,
      aplica20DiasPorAnio: preview.parametros.aplica20DiasPorAnio,
      fondoAhorroSaldo: preview.parametros.fondoAhorroSaldo,
      descuentoEmpresa: preview.parametros.descuentoEmpresa,
      prestamoSaldo: preview.parametros.prestamoSaldo
    },
    negociacion: {
      activa: !!negociacion.activa,
      gratificacion: Number(negociacion.gratificacion) || 0,
      gratificacionEsSeparacion: !!negociacion.gratificacionEsSeparacion,
      ajustes: negociacion.ajustes || [],
      notas: negociacion.notas || ''
    },
    antiguedad: preview.antiguedad,
    conceptos: preview.conceptos,
    totales: preview.totales,
    notas,
    creadoPorUserId: user.id || user.userId || '',
    creadoPorLabel: user.label || user.user || '',
    auditoria: [
      {
        at: new Date(),
        userId: user.id || '',
        userLabel: user.label || user.user || '',
        campo: 'estatus',
        valorAnterior: 'borrador',
        valorNuevo: 'calculado',
        motivo: 'Cálculo inicial'
      }
    ]
  });

  return doc.toObject ? doc.toObject() : doc;
}

async function recalcular(docId, { tenantId, parametros, negociacion, fechaBaja, causaTerminacion, notas, user = {}, reinjectarPeriodo = true } = {}) {
  const Finiquito = await getFiniquitoCalculoModel();
  const doc = await Finiquito.findOne({ _id: docId, tenantId });
  if (!doc) throw new Error('Finiquito no encontrado');

  const bloqueo = await resolverBloqueoEdicion(doc, tenantId);
  if (!bloqueo.puedeRecalcular) {
    throw new Error(
      bloqueo.permanente
        ? `Cálculo permanente (${bloqueo.motivo}). No se puede recalcular.`
        : `No se puede recalcular: ${bloqueo.motivo}`
    );
  }

  const mergedParams = { ...(doc.parametros || {}), ...(parametros || {}) };
  const mergedNeg = negociacion != null ? negociacion : doc.negociacion || {};
  if (fechaBaja) doc.fechaBaja = fechaBaja;
  if (causaTerminacion) doc.causaTerminacion = String(causaTerminacion).toUpperCase();
  if (typeof notas === 'string') doc.notas = notas;

  const preview = await previewCalculo({
    tenantId,
    empresaId: doc.empresaId,
    empleadoId: doc.empleadoId,
    causaTerminacion: doc.causaTerminacion,
    fechaBaja: doc.fechaBaja,
    parametros: mergedParams,
    negociacion: mergedNeg
  });

  doc.fechaIngreso = preview.parametros.fechaIngreso || doc.fechaIngreso;
  doc.parametros = {
    salarioDiario: preview.parametros.salarioDiario,
    salarioBaseIndemnizacion: preview.parametros.salarioBaseIndemnizacion,
    salarioBasePrimaAntiguedad: preview.parametros.salarioBasePrimaAntiguedad,
    diasAguinaldo: preview.parametros.diasAguinaldo,
    porcentajePrimaVacacional: preview.parametros.porcentajePrimaVacacional,
    diasVacacionesPendientes: preview.parametros.diasVacacionesPendientes,
    diasPendientes: preview.parametros.diasPendientes,
    aplicaPrimaAntiguedad: preview.parametros.aplicaPrimaAntiguedad,
    aplicaPrimaAntiguedadSiAnios: preview.parametros.aplicaPrimaAntiguedadSiAnios,
    aplicaIndemnizacionTresMeses: preview.parametros.aplicaIndemnizacionTresMeses,
    aplica20DiasPorAnio: preview.parametros.aplica20DiasPorAnio,
    fondoAhorroSaldo: preview.parametros.fondoAhorroSaldo
  };
  doc.negociacion = {
    activa: !!mergedNeg.activa,
    gratificacion: Number(mergedNeg.gratificacion) || 0,
    gratificacionEsSeparacion: !!mergedNeg.gratificacionEsSeparacion,
    ajustes: mergedNeg.ajustes || [],
    notas: mergedNeg.notas || ''
  };
  doc.antiguedad = preview.antiguedad;
  doc.conceptos = preview.conceptos;
  doc.totales = preview.totales;
  doc.estatus = 'calculado';
  doc.auditoria.push({
    at: new Date(),
    userId: user.id || '',
    userLabel: user.label || user.user || '',
    campo: 'recalculo',
    valorAnterior: null,
    valorNuevo: preview.totales.netoPagar,
    motivo: doc.periodoId ? 'Recálculo (con período vinculado)' : 'Recálculo'
  });
  await doc.save();

  let emit = null;
  if (reinjectarPeriodo && doc.periodoId) {
    emit = await emitirAPeriodoNomina(doc._id, {
      tenantId,
      user,
      omitirDispersionBancaria: bloqueo.periodo?.omitirDispersionBancaria !== false
    });
  }

  return { finiquito: doc.toObject(), emit, bloqueo };
}

/**
 * Borrar cálculo. Permitido mientras el período no esté cerrado.
 * Si ya estaba vinculado, limpia recibo/conceptos del período.
 */
async function eliminarCalculo(docId, { tenantId, user = {} } = {}) {
  const Finiquito = await getFiniquitoCalculoModel();
  const doc = await Finiquito.findOne({ _id: docId, tenantId });
  if (!doc) throw new Error('Finiquito no encontrado');

  const bloqueo = await resolverBloqueoEdicion(doc, tenantId);
  if (!bloqueo.puedeEliminar) {
    throw new Error(
      bloqueo.permanente
        ? `Cálculo permanente (${bloqueo.motivo}). No se puede borrar.`
        : `No se puede borrar: ${bloqueo.motivo}`
    );
  }

  if (doc.periodoId) {
    const Periodo = await getPeriodoNominaModel();
    const Recibo = await getReciboNominaModel();
    const Aplicado = await getConceptoAplicadoModel();

    const recibo =
      (doc.reciboId && (await Recibo.findOne({ _id: doc.reciboId, tenantId }))) ||
      (await Recibo.findOne({ tenantId, periodoId: doc.periodoId, empleadoId: doc.empleadoId }));

    if (recibo) {
      await Aplicado.deleteMany({ tenantId, reciboId: recibo._id });
      await Recibo.deleteOne({ _id: recibo._id, tenantId });
    }

    await Periodo.updateOne(
      { _id: doc.periodoId, tenantId },
      { $pull: { empleadoIds: doc.empleadoId } }
    );

    const recibosRestantes = await Recibo.find({ tenantId, periodoId: doc.periodoId }).lean();
    if (!recibosRestantes.length) {
      await Periodo.updateOne(
        { _id: doc.periodoId, tenantId, estatus: { $ne: 'cerrado' } },
        {
          $set: {
            estatus: 'abierto',
            totales: { empleados: 0, empleadosConError: 0, percepciones: 0, deducciones: 0, neto: 0 },
            calculadoAt: null,
            fechaCalculo: null
          }
        }
      );
    } else {
      const totPer = recibosRestantes.reduce((s, r) => s + (Number(r.totalPercepciones) || 0), 0);
      const totDed = recibosRestantes.reduce((s, r) => s + (Number(r.totalDeducciones) || 0), 0);
      const totNeto = recibosRestantes.reduce((s, r) => s + (Number(r.netoPagar) || 0), 0);
      await Periodo.updateOne(
        { _id: doc.periodoId, tenantId },
        {
          $set: {
            totales: {
              empleados: recibosRestantes.length,
              empleadosConError: recibosRestantes.filter((r) => r.errorCalculo).length,
              percepciones: Math.round(totPer * 100) / 100,
              deducciones: Math.round(totDed * 100) / 100,
              neto: Math.round(totNeto * 100) / 100
            }
          }
        }
      );
    }
  }

  await Finiquito.deleteOne({ _id: doc._id, tenantId });
  return {
    eliminado: true,
    teniaPeriodo: !!doc.periodoId,
    numEmpleado: doc.numEmpleado,
    userLabel: user.label || ''
  };
}

async function resolverBloqueoEdicion(doc, tenantId) {
  const est = String(doc.estatus || '').toLowerCase();
  if (['pagado', 'timbrado', 'cancelado'].includes(est)) {
    return {
      permanente: true,
      motivo: `estatus «${est}»`,
      puedeRecalcular: false,
      puedeEliminar: false,
      puedeEmitir: false,
      periodo: null
    };
  }

  let periodo = null;
  if (doc.periodoId) {
    const Periodo = await getPeriodoNominaModel();
    periodo = await Periodo.findOne({ _id: doc.periodoId, tenantId }).lean();
    if (periodo && String(periodo.estatus).toLowerCase() === 'cerrado') {
      return {
        permanente: true,
        motivo: 'período de nómina cerrado',
        puedeRecalcular: false,
        puedeEliminar: false,
        puedeEmitir: false,
        periodo
      };
    }
  }

  return {
    permanente: false,
    motivo: '',
    puedeRecalcular: true,
    // Borrar permitido sin vínculo, o con vínculo si el período aún no cerró
    puedeEliminar: true,
    puedeEmitir: true,
    periodo
  };
}

async function listar({ tenantId, empresaId, limit = 50 }) {
  const Finiquito = await getFiniquitoCalculoModel();
  return Finiquito.find({ tenantId, empresaId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function obtener(tenantId, id) {
  const Finiquito = await getFiniquitoCalculoModel();
  return Finiquito.findOne({ _id: id, tenantId }).lean();
}

function tipoNominaDesdeCausa(causaTerminacion) {
  const causa = causaByCodigo(causaTerminacion);
  return causa?.grupo === 'liquidacion' ? 'indemnizacion' : 'finiquito';
}

async function resolverTipoPeriodoEmpleado(tenantId, empleado) {
  if (empleado?.tipoPeriodoId) {
    try {
      const tp = await getTipoPeriodoById(tenantId, empleado.tipoPeriodoId);
      const motor = String(tp?.tipoMotor || '').toLowerCase();
      if (['semanal', 'quincenal', 'catorcenal', 'mensual', 'decena'].includes(motor)) {
        return motor;
      }
    } catch {
      /* fallback */
    }
  }
  return 'quincenal';
}

/**
 * Crea o reutiliza un PeriodoNomina especial, inyecta recibo + conceptos FIN_*
 * desde el cálculo laboral (sin pasar por el motor de fórmulas ordinaria).
 * Sin período vinculado no se puede timbrar.
 */
async function emitirAPeriodoNomina(docId, { tenantId, user = {}, omitirDispersionBancaria = true } = {}) {
  const Finiquito = await getFiniquitoCalculoModel();
  const doc = await Finiquito.findOne({ _id: docId, tenantId });
  if (!doc) throw new Error('Finiquito no encontrado');
  if (doc.estatus === 'cancelado') throw new Error('Finiquito cancelado');
  if (!(doc.conceptos || []).length) throw new Error('El finiquito no tiene conceptos calculados');

  const bloqueoEmit = await resolverBloqueoEdicion(doc, tenantId);
  if (bloqueoEmit.permanente) {
    throw new Error(`Cálculo permanente (${bloqueoEmit.motivo}). No se puede emitir ni modificar el recibo.`);
  }

  const Empleado = await getEmpleadoModel();
  const empleado = await Empleado.findOne({ _id: doc.empleadoId, tenantId }).lean();
  if (!empleado) throw new Error('Empleado no encontrado');

  const Periodo = await getPeriodoNominaModel();
  const Recibo = await getReciboNominaModel();
  const Aplicado = await getConceptoAplicadoModel();

  const tipoNomina = tipoNominaDesdeCausa(doc.causaTerminacion);
  const tipoPeriodo = await resolverTipoPeriodoEmpleado(tenantId, empleado);
  const fechaBaja = doc.fechaBaja ? new Date(doc.fechaBaja) : new Date();
  const fechaInicio = startOfDay(fechaBaja);
  const fechaFin = endOfDay(fechaBaja);
  const omitirDisp = omitirDispersionBancaria !== false;

  let periodo = null;
  let periodoCreado = false;

  if (doc.periodoId) {
    periodo = await Periodo.findOne({ _id: doc.periodoId, tenantId });
    if (!periodo) throw new Error('El período vinculado ya no existe');
    if (String(periodo.estatus) === 'cerrado') {
      throw new Error('El período vinculado está cerrado; desvincula o abre otro período');
    }
  } else {
    // Reutilizar período abierto/calculado del mismo día y tipo (lote del día)
    periodo = await Periodo.findOne({
      tenantId,
      empresaId: doc.empresaId,
      tipoNomina,
      fechaInicio,
      fechaFin,
      estatus: { $in: ['abierto', 'calculado'] }
    });
    if (!periodo) {
      const { anio, numeroPeriodo } = await asignarNumeroPeriodo(Periodo, {
        tenantId,
        tipoPeriodo,
        fechaInicio
      });
      periodo = await Periodo.create({
        tenantId,
        empresaId: doc.empresaId,
        tipoPeriodo,
        tipoNomina,
        fechaInicio,
        fechaFin,
        anio,
        numeroPeriodo,
        diasPeriodo: diasCalendarioInclusive(fechaInicio, fechaFin),
        estatus: 'abierto',
        empleadoIds: [doc.empleadoId],
        omitirDispersionBancaria: omitirDisp,
        notas: `Finiquito ${doc.numEmpleado} · ${doc.causaTerminacion} · baja ${fechaInicio.toISOString().slice(0, 10)}. Dispersión bancaria ${
          omitirDisp ? 'opcional (pago cheque/firma permitido)' : 'habilitada'
        }.`
      });
      periodoCreado = true;
    }
  }

  await Periodo.updateOne(
    { _id: periodo._id, tenantId },
    {
      $addToSet: { empleadoIds: doc.empleadoId },
      $set: {
        omitirDispersionBancaria: omitirDisp || !!periodo.omitirDispersionBancaria
      }
    }
  );
  periodo = await Periodo.findById(periodo._id);

  const conceptosActivos = (doc.conceptos || []).filter((c) => c.aplica !== false);
  const percepciones = conceptosActivos
    .filter((c) => c.tipo !== 'deduccion')
    .reduce((s, c) => s + (Number(c.importeFinal) || 0), 0);
  const deducciones = conceptosActivos
    .filter((c) => c.tipo === 'deduccion')
    .reduce((s, c) => s + (Number(c.importeFinal) || 0), 0);
  const gravado = conceptosActivos.reduce((s, c) => s + (Number(c.gravadoISR) || 0), 0);
  const exento = conceptosActivos.reduce((s, c) => s + (Number(c.exentoISR) || 0), 0);
  const neto = Math.round((percepciones - deducciones) * 100) / 100;
  const loteId = `FIN-${doc._id}-${Date.now()}`;
  const calculoId = crypto.randomBytes(8).toString('hex');

  const sepSnap =
    doc.totales?.cfdiSeparacionIndemnizacion ||
    buildSeparacionIndemnizacionData({
      conceptos: conceptosActivos,
      antiguedad: doc.antiguedad || {},
      salarioDiario: Number(doc.parametros?.salarioDiario) || 0,
      fiscalSeparacion: doc.totales?.fiscalSeparacion || {}
    });
  const cfdiSep = sepSnap?.aplica
    ? {
        TotalPagado: sepSnap.TotalPagado,
        NumAniosServicio: sepSnap.NumAniosServicio,
        UltimoSueldoMensOrd: sepSnap.UltimoSueldoMensOrd,
        IngresoAcumulable: sepSnap.IngresoAcumulable,
        IngresoNoAcumulable: sepSnap.IngresoNoAcumulable,
        TotalSeparacionIndemnizacion: sepSnap.TotalSeparacionIndemnizacion,
        conceptos: sepSnap.conceptos || [],
        fuente: 'finiquito'
      }
    : null;

  let recibo = await Recibo.findOne({
    tenantId,
    periodoId: periodo._id,
    empleadoId: doc.empleadoId
  });

  if (recibo) {
    await Aplicado.deleteMany({ tenantId, reciboId: recibo._id });
    recibo.totalPercepciones = Math.round(percepciones * 100) / 100;
    recibo.totalDeducciones = Math.round(deducciones * 100) / 100;
    recibo.netoPagar = neto;
    recibo.cfdiSeparacionIndemnizacion = cfdiSep;
    recibo.basesFiscales = {
      PERCEPCIONES_GRAVADAS: Math.round(gravado * 100) / 100,
      PERCEPCIONES_EXENTAS: Math.round(exento * 100) / 100,
      BASE_ISR: Math.round(gravado * 100) / 100,
      BASE_IMSS: Math.round(
        (Number(doc.totales?.deduccionesDetalle?.sdi) || 0) *
          (Number(doc.totales?.deduccionesDetalle?.bloqueNomina?.diasPendientes) || 0) *
          100
      ) / 100
    };
    recibo.fechaCalculo = new Date();
    recibo.calculoId = calculoId;
    recibo.calculoLoteId = loteId;
    recibo.insumosFuente = 'finiquito';
    recibo.insumosResumen = {
      diasTrabajados: Number(doc.parametros?.diasPendientes) || 0,
      faltas: 0,
      minutosRetardo: 0,
      horasExtraDobles: 0,
      horasExtraTriples: 0,
      sueldoDiario: Number(doc.parametros?.salarioDiario) || 0,
      payrollPeriodId: null
    };
    recibo.errorCalculo = '';
    recibo.cerrado = false;
    await recibo.save();
  } else {
    recibo = await Recibo.create({
      tenantId,
      empleadoId: doc.empleadoId,
      periodoId: periodo._id,
      diasLaborados: Number(doc.parametros?.diasPendientes) || 0,
      totalPercepciones: Math.round(percepciones * 100) / 100,
      totalDeducciones: Math.round(deducciones * 100) / 100,
      netoPagar: neto,
      basesFiscales: {
        PERCEPCIONES_GRAVADAS: Math.round(gravado * 100) / 100,
        PERCEPCIONES_EXENTAS: Math.round(exento * 100) / 100,
        BASE_ISR: Math.round(gravado * 100) / 100,
        BASE_IMSS: Math.round(
          (Number(doc.totales?.deduccionesDetalle?.sdi) || 0) *
            (Number(doc.totales?.deduccionesDetalle?.bloqueNomina?.diasPendientes) || 0) *
            100
        ) / 100
      },
      cfdiSeparacionIndemnizacion: cfdiSep,
      fechaCalculo: new Date(),
      calculoId,
      calculoLoteId: loteId,
      insumosFuente: 'finiquito',
      insumosResumen: {
        diasTrabajados: Number(doc.parametros?.diasPendientes) || 0,
        faltas: 0,
        minutosRetardo: 0,
        horasExtraDobles: 0,
        horasExtraTriples: 0,
        sueldoDiario: Number(doc.parametros?.salarioDiario) || 0,
        payrollPeriodId: null
      }
    });
  }

  const aplicados = conceptosActivos.map((c) => ({
    tenantId,
    reciboId: recibo._id,
    conceptoCodigo: String(c.codigo || '').toUpperCase(),
    formulaUsada: 'finiquito_laboral',
    condicionUsada: c.reglaFiscal || c.tipoFiscal || '',
    variablesUsadas: {
      origen: c.origen,
      importeLegal: c.importeLegal,
      ajuste: c.ajuste,
      detalle: c.detalle || {}
    },
    importe: Number(c.importeFinal) || 0,
    gravado: Number(c.gravadoISR) || 0,
    exento: Number(c.exentoISR) || 0,
    isr: {
      gravado: Number(c.gravadoISR) || 0,
      exento: Number(c.exentoISR) || 0
    },
    imss: { integraSBC: 0, noIntegra: Number(c.importeFinal) || 0 },
    desgloseModo: c.reglaFiscal || 'finiquito',
    claveSAT: c.claveSAT || '',
    tipo: c.tipo === 'deduccion' ? 'deduccion' : 'percepcion',
    requiereRevision: false,
    errorCalculo: '',
    versionFormula: 1
  }));
  if (aplicados.length) await Aplicado.insertMany(aplicados);

  // Totales del período = suma de recibos actuales
  const recibosPeriodo = await Recibo.find({ tenantId, periodoId: periodo._id }).lean();
  const totPer = recibosPeriodo.reduce((s, r) => s + (Number(r.totalPercepciones) || 0), 0);
  const totDed = recibosPeriodo.reduce((s, r) => s + (Number(r.totalDeducciones) || 0), 0);
  const totNeto = recibosPeriodo.reduce((s, r) => s + (Number(r.netoPagar) || 0), 0);
  const conError = recibosPeriodo.filter((r) => r.errorCalculo).length;

  await Periodo.updateOne(
    { _id: periodo._id },
    {
      $set: {
        estatus: 'calculado',
        calculadoAt: new Date(),
        fechaCalculo: new Date(),
        calculoLoteId: loteId,
        calculadoPorUserId: user.id || user.userId || '',
        calculadoPorLabel: user.label || user.user || '',
        totales: {
          empleados: recibosPeriodo.length,
          empleadosConError: conError,
          percepciones: Math.round(totPer * 100) / 100,
          deducciones: Math.round(totDed * 100) / 100,
          neto: Math.round(totNeto * 100) / 100
        }
      }
    }
  );

  const periodoIdAnterior = doc.periodoId;
  doc.periodoId = periodo._id;
  doc.reciboId = recibo._id;
  doc.auditoria = doc.auditoria || [];
  doc.auditoria.push({
    at: new Date(),
    userId: user.id || '',
    userLabel: user.label || user.user || '',
    campo: 'periodoId',
    valorAnterior: periodoIdAnterior,
    valorNuevo: periodo._id,
    motivo: periodoCreado
      ? 'Período finiquito creado e inyectado a nómina'
      : 'Finiquito emitido/actualizado en período de nómina'
  });
  await doc.save();

  return {
    finiquito: doc.toObject(),
    periodo: (await Periodo.findById(periodo._id).lean()),
    recibo: recibo.toObject ? recibo.toObject() : recibo,
    periodoCreado
  };
}

module.exports = {
  buildParametrosDesdeEmpleado,
  previewCalculo,
  crearYCalcular,
  recalcular,
  eliminarCalculo,
  resolverBloqueoEdicion,
  listar,
  obtener,
  emitirAPeriodoNomina,
  tipoNominaDesdeCausa
};
