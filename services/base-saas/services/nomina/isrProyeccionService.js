'use strict';

/**
 * Motor Inteligente de ISR (proyección anual).
 * El Motor SAT (isrPeriodo / concepto ISR) sigue siendo el oficial para CFDI.
 * Este módulo calcula proyección, diferencia y alertas — no sustituye la retención legal.
 */

const getNominaAcumuladoModel = require('../../models/nominaAcumulado');
const { aplicarTablaSync } = require('./tablasFiscalesService');
const { redondear } = require('./formulaEvaluator');
const { diasCalendarioInclusive } = require('../../libs/timeHelpers');

const DIAS_POR_TIPO = {
  semanal: 7,
  catorcenal: 14,
  quincenal: 15,
  mensal: 30,
  mensual: 30,
  decena: 10
};

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

function endOfYear(d) {
  return new Date(d.getFullYear(), 11, 31);
}

function clampDate(d, min, max) {
  const t = d.getTime();
  if (t < min.getTime()) return min;
  if (t > max.getTime()) return max;
  return d;
}

/** ISR anual esperado: preferir tabla ISR_ANUAL; fallback mensual × 12. */
function isrAnualDesdeTabla(gravadoAnual, rangosAnual, rangosMensual) {
  const g = Number(gravadoAnual) || 0;
  if (g <= 0) return 0;
  if (rangosAnual?.length) return redondear(aplicarTablaSync(g, rangosAnual), 2);
  if (!rangosMensual?.length) return 0;
  const mensual = g / 12;
  return redondear(aplicarTablaSync(mensual, rangosMensual) * 12, 2);
}

function isrAnualDesdeTablaMensual(gravadoAnual, rangosIsr) {
  return isrAnualDesdeTabla(gravadoAnual, null, rangosIsr);
}

function diasTipoPeriodo(tipoPeriodo, diasPeriodo) {
  if (Number(diasPeriodo) > 0) return Number(diasPeriodo);
  return DIAS_POR_TIPO[String(tipoPeriodo || '').toLowerCase()] || 15;
}

/**
 * @returns {{
 *   isrSat, isrProyectado, isrAjustado, diferenciaPeriodo, diferenciaAcumulada,
 *   proyeccion, alertas, modo
 * }}
 */
async function calcularMotorIsrInteligente({
  tenantId,
  empleado,
  periodo,
  gravadoPeriodo,
  isrSat,
  diasLaboradosPeriodo,
  rangosIsr,
  rangosIsrAnual = [],
  modo = 'alerta'
}) {
  const sat = redondear(Number(isrSat) || 0, 2);
  const gravado = redondear(Number(gravadoPeriodo) || 0, 2);
  const diasPer = Math.max(1, Number(diasLaboradosPeriodo) || diasTipoPeriodo(periodo.tipoPeriodo, periodo.diasPeriodo));
  const anio = new Date(periodo.fechaFin || periodo.fechaInicio || Date.now()).getFullYear();
  const finPeriodo = new Date(periodo.fechaFin || periodo.fechaInicio);
  const ingreso = empleado.fechaIngreso ? new Date(empleado.fechaIngreso) : startOfYear(finPeriodo);

  const Acumulado = await getNominaAcumuladoModel();
  const [acumGrav, acumIsr, acumDif] = await Promise.all([
    Acumulado.findOne({
      tenantId,
      empleadoId: empleado._id,
      anio,
      conceptoCodigo: 'PERCEPCIONES_GRAVADAS'
    }).lean(),
    Acumulado.findOne({
      tenantId,
      empleadoId: empleado._id,
      anio,
      conceptoCodigo: 'ISR'
    }).lean(),
    Acumulado.findOne({
      tenantId,
      empleadoId: empleado._id,
      anio,
      conceptoCodigo: 'ISR_DIFERENCIA'
    }).lean()
  ]);

  const gravadoAcumPrev = Number(acumGrav?.importeAnual) || 0;
  const isrRetenidoPrev = Number(acumIsr?.importeAnual) || 0;
  const difAcumPrev = Number(acumDif?.importeAnual) || 0;

  const ingresoAcumulado = redondear(gravadoAcumPrev + gravado, 2);

  // Días del ejercicio laboral del empleado hasta fin de período
  const inicioEjercicio = clampDate(ingreso, startOfYear(finPeriodo), finPeriodo);
  const diasAcumuladosCal = Math.max(1, diasCalendarioInclusive(inicioEjercicio, finPeriodo));
  // Preferir días laborados reales si hay acumulado de días — si no, calendario
  const diasAcumulados = Math.max(diasPer, diasAcumuladosCal);

  const promedioDiario = ingresoAcumulado / diasAcumulados;
  const finEjercicio = endOfYear(finPeriodo);
  const diasTotalesEjercicio = Math.max(
    diasAcumulados,
    diasCalendarioInclusive(inicioEjercicio, finEjercicio)
  );
  const diasRestantes = Math.max(0, diasTotalesEjercicio - diasAcumulados);
  const ingresoAnualEsperado = redondear(promedioDiario * diasTotalesEjercicio, 2);
  const isrAnualEsperado = isrAnualDesdeTabla(ingresoAnualEsperado, rangosIsrAnual, rangosIsr);

  const diasPorPeriodo = diasTipoPeriodo(periodo.tipoPeriodo, periodo.diasPeriodo);
  const periodosPendientes = Math.max(1, Math.ceil((diasRestantes + diasPer) / diasPorPeriodo));
  const isrPendienteAnual = Math.max(0, isrAnualEsperado - isrRetenidoPrev);
  const isrProyectado = redondear(isrPendienteAnual / periodosPendientes, 2);

  // Ajustado: por ahora informativo (no altera CFDI). = proyectado suavizado.
  const isrAjustado = isrProyectado;
  const diferenciaPeriodo = redondear(isrProyectado - sat, 2);
  const diferenciaAcumulada = redondear(difAcumPrev + diferenciaPeriodo, 2);

  const alertas = [];
  if (sat > 0 && Math.abs(diferenciaPeriodo) >= Math.max(50, sat * 0.25)) {
    if (diferenciaPeriodo < 0) {
      alertas.push({
        codigo: 'ISR_PICO_TEMPORAL',
        severidad: 'warning',
        mensaje: `ISR SAT del período ($${sat.toLocaleString('es-MX')}) supera la retención uniforme sugerida ($${isrProyectado.toLocaleString('es-MX')}). El efecto suele compensarse en períodos siguientes.`
      });
    } else {
      alertas.push({
        codigo: 'ISR_BAJO_VS_PROYECCION',
        severidad: 'info',
        mensaje: `La retención SAT ($${sat.toLocaleString('es-MX')}) está por debajo de la proyección uniforme ($${isrProyectado.toLocaleString('es-MX')}).`
      });
    }
  }
  if (Math.abs(diferenciaAcumulada) >= 500) {
    const cargo = diferenciaAcumulada > 0 ? 'a favor (se ha retenido de más vs proyección)' : 'a cargo (faltante vs proyección)';
    alertas.push({
      codigo: 'AJUSTE_ANUAL_ESTIMADO',
      severidad: Math.abs(diferenciaAcumulada) >= 1250 ? 'warning' : 'info',
      mensaje: `Con el ingreso actual, la diferencia acumulada vs proyección es $${Math.abs(diferenciaAcumulada).toLocaleString('es-MX')} ${cargo}.`
    });
  }

  return {
    modo: modo === 'retencion' ? 'inteligente_retencion' : 'inteligente_alerta',
    motorSat: true,
    isrSat: sat,
    isrProyectado,
    isrAjustado,
    diferenciaPeriodo,
    diferenciaAcumulada,
    proyeccion: {
      anio,
      ingresoAcumulado,
      gravadoPeriodo: gravado,
      diasAcumulados,
      diasLaboradosPeriodo: diasPer,
      promedioDiario: redondear(promedioDiario, 4),
      diasTotalesEjercicio,
      diasRestantes,
      ingresoAnualEsperado,
      isrAnualEsperado,
      isrRetenidoPrev,
      periodosPendientes,
      fechaIngreso: ingreso
    },
    alertas,
    /** Retención que va al CFDI / neto: siempre SAT en v1 */
    isrRetenidoCfdi: sat
  };
}

function lineasInformativasIsr(meta) {
  if (!meta) return [];
  return [
    {
      conceptoCodigo: 'ISR_SAT',
      formulaUsada: 'motorSat(PERCEPCIONES_GRAVADAS)',
      condicionUsada: '',
      variablesUsadas: {},
      importe: meta.isrSat,
      gravado: 0,
      exento: 0,
      desgloseModo: '',
      claveSAT: '',
      tipo: 'deduccion',
      naturaleza: 'informativo',
      requiereRevision: false,
      errorCalculo: '',
      versionFormula: 1
    },
    {
      conceptoCodigo: 'ISR_PROYECTADO',
      formulaUsada: 'motorInteligente(proyeccionAnual)',
      condicionUsada: '',
      variablesUsadas: meta.proyeccion || {},
      importe: meta.isrProyectado,
      gravado: 0,
      exento: 0,
      desgloseModo: '',
      claveSAT: '',
      tipo: 'deduccion',
      naturaleza: 'informativo',
      requiereRevision: false,
      errorCalculo: '',
      versionFormula: 1
    },
    {
      conceptoCodigo: 'ISR_AJUSTADO',
      formulaUsada: 'isrProyectado (informativo; CFDI usa ISR SAT)',
      condicionUsada: '',
      variablesUsadas: {},
      importe: meta.isrAjustado,
      gravado: 0,
      exento: 0,
      desgloseModo: '',
      claveSAT: '',
      tipo: 'deduccion',
      naturaleza: 'informativo',
      requiereRevision: false,
      errorCalculo: '',
      versionFormula: 1
    },
    {
      conceptoCodigo: 'ISR_DIFERENCIA',
      formulaUsada: 'ISR_PROYECTADO - ISR_SAT',
      condicionUsada: '',
      variablesUsadas: { diferenciaAcumulada: meta.diferenciaAcumulada },
      importe: meta.diferenciaPeriodo,
      gravado: 0,
      exento: 0,
      desgloseModo: '',
      claveSAT: '',
      tipo: 'deduccion',
      naturaleza: 'informativo',
      requiereRevision: false,
      errorCalculo: '',
      versionFormula: 1
    }
  ];
}

module.exports = {
  calcularMotorIsrInteligente,
  isrAnualDesdeTablaMensual,
  isrAnualDesdeTabla,
  lineasInformativasIsr
};
