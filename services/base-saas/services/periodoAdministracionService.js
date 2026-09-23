'use strict';

const getPayrollPeriodModel = require('../models/payrollPeriod');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { generarBloquesPeriodoAnio } = require('../libs/generarPeriodosAnio');
const { sugerirFechaPago } = require('../libs/calendarioPeriodo');
const {
  ESTATUS_PERIODO_OCUPA_VENTANA,
  ESTATUS_PERIODO_CALCULABLE
} = require('../config/periodosNomina');

async function listarPeriodos(tenantId, filtros = {}) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const q = { tenantId };

  if (filtros.tipoPeriodoId) q.tipoPeriodoId = filtros.tipoPeriodoId;
  if (filtros.anio) q.anio = Number(filtros.anio);
  if (filtros.estatus) q.estatus = filtros.estatus;
  if (filtros.tipoNomina) q.tipoNomina = filtros.tipoNomina;

  return PayrollPeriod.find(q)
    .sort({ anio: -1, tipoPeriodoId: 1, numeroPeriodo: 1, fechaInicio: 1 })
    .limit(filtros.limit || 500)
    .lean();
}

async function generarPeriodosAnuales(tenantId, empresaId, payload) {
  const {
    tipoPeriodoRef,
    anio,
    fechaInicial,
    tipoNomina = 'ordinaria',
    notas = ''
  } = payload;

  if (!tipoPeriodoRef) throw new Error('Tipo de período requerido');

  const bloques = generarBloquesPeriodoAnio({
    tipoMotor: tipoPeriodoRef.tipoMotor,
    diasPeriodo: tipoPeriodoRef.diasPeriodo,
    fechaInicial,
    anio,
    tipoPeriodoRef
  });

  const PayrollPeriod = await getPayrollPeriodModel();
  const insertados = [];
  const omitidos = [];

  for (const bloque of bloques) {
    const dup = await PayrollPeriod.findOne({
      tenantId,
      tipoPeriodoId: tipoPeriodoRef._id,
      anio: bloque.anio,
      numeroPeriodo: bloque.numeroPeriodo
    }).lean();

    if (dup) {
      omitidos.push({ numeroPeriodo: bloque.numeroPeriodo, motivo: 'Ya existe' });
      continue;
    }

    const overlap = await PayrollPeriod.findOne({
      tenantId,
      tipoPeriodoId: tipoPeriodoRef._id,
      fechaInicio: { $lte: endOfDay(bloque.fechaFin) },
      fechaFin: { $gte: startOfDay(bloque.fechaInicio) }
    }).lean();

    if (overlap) {
      omitidos.push({ numeroPeriodo: bloque.numeroPeriodo, motivo: 'Solapamiento de fechas' });
      continue;
    }

    const doc = await PayrollPeriod.create({
      tenantId,
      empresaId,
      tipo: tipoPeriodoRef.tipoMotor,
      tipoPeriodoId: tipoPeriodoRef._id,
      codigoLegadoTipoPeriodo: tipoPeriodoRef.codigoLegado,
      anio: bloque.anio,
      numeroPeriodo: bloque.numeroPeriodo,
      fechaInicio: startOfDay(bloque.fechaInicio),
      fechaFin: endOfDay(bloque.fechaFin),
      fechaPago: sugerirFechaPago(bloque.fechaFin, tipoPeriodoRef),
      tipoNomina,
      estatus: 'pendiente',
      aplicaAsistenciaPrenomina: tipoPeriodoRef.aplicaAsistenciaPrenomina !== false,
      compartirConNomina: tipoPeriodoRef.compartirConNomina !== false,
      notas: notas || ''
    });
    insertados.push(doc);
  }

  return { insertados: insertados.length, omitidos, bloques: bloques.length };
}

async function findPeriodoDoc(tenantId, id) {
  const PayrollPeriod = await getPayrollPeriodModel();
  return PayrollPeriod.findOne({ tenantId, _id: id });
}

async function getContextoPeriodo(tenantId, periodo) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const base = { tenantId, tipoPeriodoId: periodo.tipoPeriodoId, anio: periodo.anio };

  const [anterior, siguiente, abiertoOtro] = await Promise.all([
    periodo.numeroPeriodo > 1
      ? PayrollPeriod.findOne({ ...base, numeroPeriodo: periodo.numeroPeriodo - 1 }).lean()
      : null,
    PayrollPeriod.findOne({ ...base, numeroPeriodo: (periodo.numeroPeriodo || 0) + 1 }).lean(),
    periodo.tipoPeriodoId
      ? PayrollPeriod.findOne({
          tenantId,
          tipoPeriodoId: periodo.tipoPeriodoId,
          _id: { $ne: periodo._id },
          estatus: { $in: ESTATUS_PERIODO_OCUPA_VENTANA }
        }).lean()
      : null
  ]);

  return {
    anterior,
    siguiente,
    siguienteAbierto: siguiente && ESTATUS_PERIODO_OCUPA_VENTANA.includes(siguiente.estatus),
    otroAbierto: abiertoOtro,
    puedeAbrir:
      periodo.estatus === 'pendiente' &&
      !abiertoOtro &&
      (!anterior || anterior.estatus === 'cerrado'),
    puedeCerrar: ['abierto', 'borrador'].includes(periodo.estatus),
    puedeCalcular: ESTATUS_PERIODO_CALCULABLE.includes(periodo.estatus)
  };
}

async function abrirPeriodo(tenantId, periodoId, userId = '') {
  const doc = await findPeriodoDoc(tenantId, periodoId);
  if (!doc) throw new Error('PERIOD_NOT_FOUND');

  if (doc.estatus !== 'pendiente') {
    throw new Error('PERIOD_NOT_PENDING');
  }

  const ctx = await getContextoPeriodo(tenantId, doc.toObject());

  if (ctx.otroAbierto) {
    const err = new Error('PERIOD_OTHER_OPEN');
    err.otro = ctx.otroAbierto;
    throw err;
  }

  if (ctx.anterior && ctx.anterior.estatus !== 'cerrado') {
    const err = new Error('PERIOD_PREVIOUS_NOT_CLOSED');
    err.anterior = ctx.anterior;
    throw err;
  }

  doc.estatus = 'abierto';
  doc.abiertoAt = new Date();
  doc.abiertoPorUserId = userId;
  await doc.save();
  return { periodo: doc.toObject(), contexto: await getContextoPeriodo(tenantId, doc.toObject()) };
}

async function cerrarPeriodoAdmin(tenantId, periodoId, userId = '') {
  const doc = await findPeriodoDoc(tenantId, periodoId);
  if (!doc) throw new Error('PERIOD_NOT_FOUND');

  if (doc.estatus === 'cerrado') throw new Error('PERIOD_CLOSED');
  if (doc.estatus === 'pendiente') throw new Error('PERIOD_NOT_OPEN');

  doc.estatus = 'cerrado';
  doc.cerradoAt = new Date();
  doc.cerradoPorUserId = userId;
  await doc.save();
  return doc.toObject();
}

module.exports = {
  listarPeriodos,
  generarPeriodosAnuales,
  getContextoPeriodo,
  abrirPeriodo,
  cerrarPeriodoAdmin
};
