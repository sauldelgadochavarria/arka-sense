'use strict';

const getNominaCalculoJobModel = require('../../models/nominaCalculoJob');
const getPeriodoNominaModel = require('../../models/periodoNomina');
const { calcularPeriodo } = require('./calculoNominaService');

let workerIniciado = false;

async function obtenerJobActivo(tenantId, periodoId) {
  const NominaCalculoJob = await getNominaCalculoJobModel();
  return NominaCalculoJob.findOne({
    tenantId,
    periodoId,
    estatus: { $in: ['pending', 'running'] }
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function encolarCalculo(tenantId, periodoId, userId = '', userLabel = '') {
  const PeriodoNomina = await getPeriodoNominaModel();
  const NominaCalculoJob = await getNominaCalculoJobModel();

  const periodo = await PeriodoNomina.findOne({ tenantId, _id: periodoId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus === 'cerrado') throw new Error('El período está cerrado');

  const activo = await obtenerJobActivo(tenantId, periodoId);
  if (activo) {
    return { job: activo, yaEncolado: true };
  }

  const job = await NominaCalculoJob.create({
    tenantId,
    periodoId,
    estatus: 'pending',
    userId,
    userLabel: userLabel || '',
    progreso: { total: 0, procesados: 0, exitos: 0, errores: 0 },
    erroresDetalle: []
  });

  await PeriodoNomina.updateOne(
    { _id: periodoId },
    { $set: { estatus: 'calculando', calculoJobId: job._id } }
  );

  setImmediate(() => {
    procesarJob(job._id).catch((err) => {
      console.error('[nomina job]', job._id, err);
    });
  });

  return { job: job.toObject(), yaEncolado: false };
}

async function procesarJob(jobId) {
  const NominaCalculoJob = await getNominaCalculoJobModel();
  const PeriodoNomina = await getPeriodoNominaModel();

  const claimed = await NominaCalculoJob.findOneAndUpdate(
    { _id: jobId, estatus: { $in: ['pending', 'running'] } },
    { $set: { estatus: 'running', startedAt: new Date() } },
    { new: true }
  ).lean();

  if (!claimed) return;

  try {
    const { resultados, totales } = await calcularPeriodo(
      claimed.tenantId,
      claimed.periodoId,
      {
        userId: claimed.userId,
        userLabel: claimed.userLabel || '',
        onProgress: async (progreso) => {
          await NominaCalculoJob.updateOne(
            { _id: jobId },
            {
              $set: {
                progreso: {
                  total: progreso.total,
                  procesados: progreso.procesados,
                  exitos: progreso.exitos,
                  errores: progreso.errores
                }
              }
            }
          );
        }
      }
    );

    const erroresDetalle = resultados
      .filter((r) => !r.ok)
      .map((r) => ({
        empleadoId: r.empleadoId,
        numEmpleado: r.numEmpleado || '',
        nombre: r.nombre || '',
        error: r.error || 'Error desconocido'
      }));

    await NominaCalculoJob.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'completed',
          totales,
          erroresDetalle,
          completedAt: new Date(),
          progreso: {
            total: resultados.length,
            procesados: resultados.length,
            exitos: resultados.filter((r) => r.ok).length,
            errores: erroresDetalle.length
          }
        }
      }
    );

    await PeriodoNomina.updateOne(
      { _id: claimed.periodoId },
      { $set: { estatus: 'calculado', calculoJobId: jobId } }
    );
  } catch (err) {
    await NominaCalculoJob.updateOne(
      { _id: jobId },
      {
        $set: {
          estatus: 'failed',
          error: err.message || String(err),
          completedAt: new Date()
        }
      }
    );

    const periodo = await PeriodoNomina.findById(claimed.periodoId).lean();
    if (periodo && periodo.estatus === 'calculando') {
      await PeriodoNomina.updateOne(
        { _id: claimed.periodoId },
        { $set: { estatus: periodo.calculadoAt ? 'calculado' : 'abierto' } }
      );
    }
    throw err;
  }
}

async function obtenerEstadoJob(tenantId, periodoId) {
  const NominaCalculoJob = await getNominaCalculoJobModel();
  const job = await NominaCalculoJob.findOne({ tenantId, periodoId })
    .sort({ createdAt: -1 })
    .lean();
  return job;
}

async function recuperarJobsPendientes() {
  const NominaCalculoJob = await getNominaCalculoJobModel();
  const pendientes = await NominaCalculoJob.find({
    estatus: { $in: ['pending', 'running'] }
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .lean();

  for (const job of pendientes) {
    console.log(`[nomina] Reanudando job ${job._id} (${job.estatus})`);
    setImmediate(() => {
      procesarJob(job._id).catch((err) => console.error('[nomina job recovery]', err));
    });
  }
}

function iniciarWorkerNomina() {
  if (workerIniciado) return;
  workerIniciado = true;
  setTimeout(() => {
    recuperarJobsPendientes().catch((err) => console.error('[nomina worker]', err));
  }, 3000);
}

module.exports = {
  encolarCalculo,
  procesarJob,
  obtenerEstadoJob,
  obtenerJobActivo,
  recuperarJobsPendientes,
  iniciarWorkerNomina
};
