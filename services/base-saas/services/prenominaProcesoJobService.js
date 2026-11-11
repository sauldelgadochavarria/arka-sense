'use strict';

const getPrenominaProcesoJobModel = require('../models/prenominaProcesoJob');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { calculatePayrollPeriod, listEmpleadosParaPrenomina } = require('./payrollCalculationService');
const { recalculateRangeForTenant } = require('./attendanceProcessingService');

let workerIniciado = false;

function progresoDe(p) {
  return {
    total: Number(p?.total) || 0,
    procesados: Number(p?.procesados) || 0,
    exitos: Number(p?.exitos) || 0,
    errores: Number(p?.errores) || 0,
    mensaje: p?.mensaje || ''
  };
}

async function obtenerJobActivo(tenantId, periodId) {
  const Job = await getPrenominaProcesoJobModel();
  return Job.findOne({
    tenantId,
    periodId,
    estatus: { $in: ['pending', 'running'] }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function obtenerEstadoJob(tenantId, periodId) {
  const Job = await getPrenominaProcesoJobModel();
  return Job.findOne({ tenantId, periodId }).sort({ createdAt: -1 }).lean();
}

async function encolarProceso(tenantId, periodId, tipo, userId = '') {
  const PayrollPeriod = await getPayrollPeriodModel();
  const Job = await getPrenominaProcesoJobModel();
  const periodo = await PayrollPeriod.findOne({ _id: periodId, tenantId }).lean();
  if (!periodo) throw new Error('PERIOD_NOT_FOUND');
  if (periodo.estatus === 'cerrado') throw new Error('PERIOD_CLOSED');
  if (tipo === 'calculo' && !['abierto', 'borrador'].includes(periodo.estatus)) {
    throw new Error('PERIOD_NOT_OPEN');
  }

  const activo = await obtenerJobActivo(tenantId, periodId);
  if (activo) return { job: activo, yaEncolado: true };

  let job;
  try {
    job = await Job.create({
      tenantId,
      periodId,
      tipo,
      estatus: 'pending',
      activo: true,
      userId: userId || '',
      progreso: { total: 0, procesados: 0, exitos: 0, errores: 0, mensaje: 'En cola' }
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const existente = await obtenerJobActivo(tenantId, periodId);
      if (existente) return { job: existente, yaEncolado: true };
    }
    throw err;
  }

  setImmediate(() => {
    procesarJob(job._id).catch((error) => {
      console.error('[prenomina job]', job._id, error);
    });
  });
  return { job: job.toObject(), yaEncolado: false };
}

async function procesarJob(jobId) {
  const Job = await getPrenominaProcesoJobModel();
  const claimed = await Job.findOneAndUpdate(
    { _id: jobId, estatus: { $in: ['pending', 'running'] } },
    { $set: { estatus: 'running', startedAt: new Date(), 'progreso.mensaje': 'Iniciando' } },
    { new: true }
  ).lean();
  if (!claimed) return;

  let ultimoAviso = 0;
  const onProgress = async (p) => {
    const ahora = Date.now();
    const termino = p.total > 0 && p.procesados >= p.total;
    if (!termino && ahora - ultimoAviso < 700) return;
    ultimoAviso = ahora;
    await Job.updateOne({ _id: jobId }, { $set: { progreso: progresoDe(p) } });
  };

  try {
    const PayrollPeriod = await getPayrollPeriodModel();
    const periodo = await PayrollPeriod.findOne({ _id: claimed.periodId, tenantId: claimed.tenantId }).lean();
    if (!periodo) throw new Error('PERIOD_NOT_FOUND');

    let resultado = null;
    if (claimed.tipo === 'asistencia') {
      const empleados = await listEmpleadosParaPrenomina(periodo);
      resultado = await recalculateRangeForTenant(
        claimed.tenantId,
        periodo.fechaInicio,
        periodo.fechaFin,
        {
          empresaId: periodo.empresaId,
          subsidiariaId: periodo.subsidiariaId,
          empleados,
          onProgress
        }
      );
    } else {
      const period = await calculatePayrollPeriod(claimed.periodId, claimed.tenantId, claimed.userId, {
        onProgress
      });
      resultado = period?.totales || null;
    }

    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'completed',
          resultado,
          completedAt: new Date(),
          activo: false,
          error: '',
          progreso: {
            total: 1,
            procesados: 1,
            exitos: 1,
            errores: 0,
            mensaje: claimed.tipo === 'asistencia' ? 'Asistencia reprocesada' : 'Pre-nómina calculada'
          }
        }
      }
    );
  } catch (err) {
    await Job.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'failed',
          activo: false,
          error: err.message || String(err),
          completedAt: new Date(),
          'progreso.mensaje': err.message || 'Error'
        }
      }
    );
  }
}

async function recuperarJobsPendientes() {
  const Job = await getPrenominaProcesoJobModel();
  const pendientes = await Job.find({ estatus: { $in: ['pending', 'running'] } })
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();
  for (const job of pendientes) {
    console.log(`[prenomina] Reanudando ${job.tipo} ${job._id}`);
    setImmediate(() => {
      procesarJob(job._id).catch((err) => console.error('[prenomina job recovery]', err));
    });
  }
}

function iniciarWorkerPrenomina() {
  if (workerIniciado) return;
  workerIniciado = true;
  setTimeout(() => {
    recuperarJobsPendientes().catch((err) => console.error('[prenomina worker]', err));
  }, 4000);
}

module.exports = {
  encolarProceso,
  obtenerEstadoJob,
  obtenerJobActivo,
  iniciarWorkerPrenomina
};
