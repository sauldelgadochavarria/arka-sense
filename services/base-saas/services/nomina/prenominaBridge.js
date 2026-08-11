'use strict';

const getPayrollDetailModel = require('../../models/payrollDetail');
const getPayrollPeriodModel = require('../../models/payrollPeriod');
const { repartirHorasExtraTotal } = require('../../libs/horasExtraClasificacion');

function sumarLineas(lineas, tipo) {
  return (lineas || [])
    .filter((l) => l.tipo === tipo)
    .reduce((s, l) => s + (Number(l.monto) || 0), 0);
}

/** Preferir minutos ya clasificados (LFT); si no, repartir total con tope de 9 h. */
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

  const { horasExtraDobles, horasExtraTriples } = horasExtraDesdeDetail(detail);
  const diasConRetardo = detail.diasConRetardo || 0;

  return {
    fuente: 'prenomina',
    payrollPeriodEstatus: period?.estatus || '',
    diasTrabajados: detail.diasTrabajados != null ? Number(detail.diasTrabajados) : 0,
    faltas: detail.diasFalta || 0,
    diasConRetardo,
    llegadasTarde: diasConRetardo,
    horasExtraDobles,
    horasExtraTriples,
    minutosRetardo: detail.minutosRetardo || 0,
    minutosSalidaAnticipada: detail.minutosSalidaAnticipada || 0,
    sueldoDiario: detail.salarioDiario || null,
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
  repartirHorasExtra: repartirHorasExtraTotal
};
