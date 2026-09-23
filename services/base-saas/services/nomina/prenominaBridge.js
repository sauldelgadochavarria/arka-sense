'use strict';

const getPayrollDetailModel = require('../../models/payrollDetail');
const getPayrollPeriodModel = require('../../models/payrollPeriod');
const { repartirHorasExtraTotal } = require('../../libs/horasExtraClasificacion');

function sumarLineas(lineas, tipo) {
  return (lineas || [])
    .filter((l) => l.tipo === tipo)
    .reduce((s, l) => s + (Number(l.monto) || 0), 0);
}

/**
 * Preferir minutos ya clasificados en el período (pipeline única).
 * Si no hay cubetas, repartir total con tope semanal de dobles.
 */
function horasExtraDesdeDetail(detail) {
  const tieneClasificado =
    detail &&
    (detail.minutosHEDoble != null ||
      detail.minutosHETriple != null ||
      detail.minutosHEOrdinaria != null);

  if (tieneClasificado) {
    const minDobles =
      (Number(detail.minutosHEDoble) || 0) + (Number(detail.minutosHEOrdinaria) || 0);
    const minTriples = Number(detail.minutosHETriple) || 0;
    return {
      horasExtraDobles: minDobles / 60,
      horasExtraTriples: minTriples / 60
    };
  }

  const minutosHE = Number(detail?.minutosHorasExtra) || 0;
  return repartirHorasExtraTotal(minutosHE / 60);
}

/**
 * Contrato canónico asistencia → nómina (Sprint 1).
 * Unidades de tiempo ya clasificadas + banderas.
 */
function buildTiempoClasificado(detail, he) {
  return {
    horas_ordinarias: null,
    horas_extra_dobles: he.horasExtraDobles,
    horas_extra_triples: he.horasExtraTriples,
    minutos_retardo: Number(detail?.minutosRetardo) || 0,
    minutos_salida_anticipada: Number(detail?.minutosSalidaAnticipada) || 0,
    dias_trabajados: detail?.diasTrabajados != null ? Number(detail.diasTrabajados) : 0,
    valor_hora: Number(detail?.valorHora) || null,
    horas_jornada: Number(detail?.horasJornada) || null,
    max_horas_ordinarias_semana: Number(detail?.maxHorasOrdinariasSemana) || null,
    tipo_jornada_cfdi: detail?.tipoJornadaCfdi || null
  };
}

function buildBanderasExcepcion(detail) {
  return {
    excede_limite_diario: Boolean(detail?.excedeLimiteDiario),
    motivo_id: detail?.excedeLimiteDiario ? 'EXCEDE_12H_DIA' : null
  };
}

async function obtenerInsumosPrenomina(tenantId, empleadoId, payrollPeriodId) {
  const vacio = {
    fuente: 'default',
    diasTrabajados: null,
    faltas: 0,
    diasConRetardo: 0,
    llegadasTarde: 0,
    horasExtraDobles: 0,
    horasExtraTriples: 0,
    minutosRetardo: 0,
    minutosSalidaAnticipada: 0,
    sueldoDiario: null,
    horasJornada: null,
    valorHora: null,
    maxHorasOrdinariasSemana: null,
    tipoJornadaCfdi: null,
    tiempoClasificado: null,
    banderasExcepcion: null,
    percepcionPrenomina: 0,
    deduccionPrenomina: 0
  };

  if (!payrollPeriodId) return vacio;

  const PayrollDetail = await getPayrollDetailModel();
  const PayrollPeriod = await getPayrollPeriodModel();

  const [detail, period] = await Promise.all([
    PayrollDetail.findOne({ tenantId, periodId: payrollPeriodId, empleadoId }).lean(),
    PayrollPeriod.findOne({ tenantId, _id: payrollPeriodId }).lean()
  ]);

  if (!detail) {
    return {
      ...vacio,
      fuente: 'prenomina_sin_detalle',
      diasTrabajados: 0,
      faltas: 0
    };
  }

  const he = horasExtraDesdeDetail(detail);
  const diasConRetardo = detail.diasConRetardo || 0;

  return {
    fuente: 'prenomina',
    payrollPeriodEstatus: period?.estatus || '',
    diasTrabajados: detail.diasTrabajados != null ? Number(detail.diasTrabajados) : 0,
    faltas: detail.diasFalta || 0,
    diasConRetardo,
    llegadasTarde: diasConRetardo,
    horasExtraDobles: he.horasExtraDobles,
    horasExtraTriples: he.horasExtraTriples,
    minutosRetardo: detail.minutosRetardo || 0,
    minutosSalidaAnticipada: detail.minutosSalidaAnticipada || 0,
    sueldoDiario: detail.salarioDiario || null,
    horasJornada: detail.horasJornada != null ? Number(detail.horasJornada) : null,
    valorHora: detail.valorHora != null ? Number(detail.valorHora) : null,
    maxHorasOrdinariasSemana:
      detail.maxHorasOrdinariasSemana != null ? Number(detail.maxHorasOrdinariasSemana) : null,
    tipoJornadaCfdi: detail.tipoJornadaCfdi || null,
    tiempoClasificado: buildTiempoClasificado(detail, he),
    banderasExcepcion: buildBanderasExcepcion(detail),
    percepcionPrenomina: sumarLineas(detail.percepciones, 'percepcion'),
    deduccionPrenomina: sumarLineas(detail.deducciones, 'deduccion')
  };
}

/** ¿El detalle de pre-nómina justifica incluir al empleado en nómina formal? */
function tieneActividadPrenomina(detail) {
  if (!detail) return false;
  const dias = Number(detail.diasTrabajados) || 0;
  const he = Number(detail.minutosHorasExtra) || 0;
  const perc = sumarLineas(detail.percepciones, 'percepcion');
  const ded = sumarLineas(detail.deducciones, 'deduccion');
  return dias > 0 || he > 0 || perc > 0 || ded > 0;
}

module.exports = {
  obtenerInsumosPrenomina,
  tieneActividadPrenomina,
  horasExtraDesdeDetail,
  buildTiempoClasificado,
  buildBanderasExcepcion,
  repartirHorasExtra: repartirHorasExtraTotal
};
