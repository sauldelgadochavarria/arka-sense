'use strict';

const getPayrollPeriodModel = require('../models/payrollPeriod');
const getPeriodoNominaModel = require('../models/periodoNomina');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { generarBloquesPeriodoAnio } = require('../libs/generarPeriodosAnio');
const { sugerirFechaPago, addDays } = require('../libs/calendarioPeriodo');
const {
  ESTATUS_PERIODO_OCUPA_VENTANA,
  ESTATUS_PERIODO_CALCULABLE
} = require('../config/periodosNomina');

async function listarPeriodos(tenantId, filtros = {}) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const q = { tenantId };

  if (filtros.empresaId) q.empresaId = filtros.empresaId;
  if (filtros.subsidiariaId) q.subsidiariaId = filtros.subsidiariaId;
  if (filtros.tipoPeriodoId) q.tipoPeriodoId = filtros.tipoPeriodoId;
  if (filtros.anio) q.anio = Number(filtros.anio);
  if (filtros.estatus) q.estatus = filtros.estatus;
  if (filtros.tipoNomina) q.tipoNomina = filtros.tipoNomina;

  return PayrollPeriod.find(q)
    .sort({ anio: -1, tipoPeriodoId: 1, numeroPeriodo: 1, fechaInicio: 1 })
    .limit(filtros.limit || 500)
    .lean();
}

function ymdUtc(date) {
  const d = new Date(date);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function scopePeriodo(tenantId, empresaId, subsidiariaId) {
  const scope = { tenantId, empresaId };
  if (subsidiariaId) scope.subsidiariaId = subsidiariaId;
  return scope;
}

async function buscarPeriodoEn(Model, scope, tipoFiltro, tipoNomina, bloque) {
  const porNumero = await Model.findOne({
    ...scope,
    ...tipoFiltro,
    tipoNomina,
    anio: bloque.anio,
    numeroPeriodo: bloque.numeroPeriodo
  }).lean();
  if (porNumero) return { doc: porNumero, motivo: 'Ya existe el número' };

  const overlap = await Model.findOne({
    ...scope,
    ...tipoFiltro,
    tipoNomina,
    fechaInicio: { $lte: endOfDay(bloque.fechaFin) },
    fechaFin: { $gte: startOfDay(bloque.fechaInicio) }
  }).lean();
  if (overlap) return { doc: overlap, motivo: 'Solapa fechas' };
  return null;
}

function resolverDestino(payload) {
  const raw = String(payload.destino || '').toLowerCase();
  if (raw === 'prenomina' || raw === 'nomina' || raw === 'ambos') return raw;
  return payload.tipoPeriodoRef?.compartirConNomina !== false ? 'ambos' : 'prenomina';
}

function anclaDeGeneracion(destino, ultimaPrenomina, ultimaNomina) {
  if (destino === 'nomina') return ultimaNomina || ultimaPrenomina || null;
  if (destino === 'prenomina') return ultimaPrenomina || ultimaNomina || null;
  if (ultimaPrenomina && ultimaNomina) {
    return new Date(ultimaNomina.fechaFin).getTime() < new Date(ultimaPrenomina.fechaFin).getTime()
      ? ultimaNomina
      : ultimaPrenomina;
  }
  return ultimaPrenomina || ultimaNomina || null;
}

async function sugerirInicioGeneracion(tenantId, empresaId, payload) {
  const { tipoPeriodoRef, anio, tipoNomina = 'ordinaria', subsidiariaId = null } = payload;
  if (!tipoPeriodoRef) throw new Error('Tipo de período requerido');
  const anioNum = Number(anio);
  const destino = resolverDestino(payload);
  const scope = scopePeriodo(tenantId, empresaId, subsidiariaId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const PeriodoNomina = await getPeriodoNominaModel();
  const filtroTipo = { tipoPeriodoId: tipoPeriodoRef._id, tipoNomina, anio: anioNum };

  const [ultimaPrenomina, ultimaNomina] = await Promise.all([
    PayrollPeriod.findOne({ ...scope, ...filtroTipo }).sort({ fechaFin: -1, numeroPeriodo: -1 }).lean(),
    PeriodoNomina.findOne({ ...scope, ...filtroTipo }).sort({ fechaFin: -1, numeroPeriodo: -1 }).lean()
  ]);

  const ancla = anclaDeGeneracion(destino, ultimaPrenomina, ultimaNomina);
  const numeroInicial = (Number(ancla?.numeroPeriodo) || 0) + 1;
  return {
    destino,
    fechaInicial: ancla ? ymdUtc(addDays(startOfDay(ancla.fechaFin), 1)) : '',
    numeroInicial,
    prenomina: ultimaPrenomina
      ? {
          numeroPeriodo: ultimaPrenomina.numeroPeriodo,
          fechaInicio: ymdUtc(ultimaPrenomina.fechaInicio),
          fechaFin: ymdUtc(ultimaPrenomina.fechaFin)
        }
      : null,
    nomina: ultimaNomina
      ? {
          numeroPeriodo: ultimaNomina.numeroPeriodo,
          fechaInicio: ymdUtc(ultimaNomina.fechaInicio),
          fechaFin: ymdUtc(ultimaNomina.fechaFin)
        }
      : null
  };
}

async function buscarNominaExistente(PeriodoNomina, scope, tipoPeriodoRef, tipoNomina, bloque) {
  const porNumero = await PeriodoNomina.findOne({
    ...scope,
    tipoPeriodo: tipoPeriodoRef.tipoMotor,
    tipoNomina,
    anio: bloque.anio,
    numeroPeriodo: bloque.numeroPeriodo
  }).lean();
  if (porNumero) return { doc: porNumero, motivo: 'Ya existe el número' };

  const overlap = await PeriodoNomina.findOne({
    ...scope,
    tipoPeriodoId: tipoPeriodoRef._id,
    tipoNomina,
    fechaInicio: { $lte: endOfDay(bloque.fechaFin) },
    fechaFin: { $gte: startOfDay(bloque.fechaInicio) }
  }).lean();
  if (overlap) return { doc: overlap, motivo: 'Solapa fechas' };
  return null;
}

async function clasificarBloquesPeriodo(tenantId, empresaId, payload, bloques) {
  const { tipoPeriodoRef, tipoNomina = 'ordinaria', subsidiariaId = null } = payload;
  const PayrollPeriod = await getPayrollPeriodModel();
  const PeriodoNomina = await getPeriodoNominaModel();
  const scope = scopePeriodo(tenantId, empresaId, subsidiariaId);
  const tipoPay = { tipoPeriodoId: tipoPeriodoRef._id };
  const destino = resolverDestino(payload);
  const quierePre = destino === 'prenomina' || destino === 'ambos';
  const quiereNom = destino === 'nomina' || destino === 'ambos';
  const filas = [];

  for (const bloque of bloques) {
    const pre = await buscarPeriodoEn(PayrollPeriod, scope, tipoPay, tipoNomina, bloque);
    const nom = await buscarNominaExistente(PeriodoNomina, scope, tipoPeriodoRef, tipoNomina, bloque);
    filas.push({
      ...bloque,
      destino,
      aplicaPrenomina: quierePre,
      aplicaNomina: quiereNom,
      crearPrenomina: quierePre && !pre,
      crearNomina: quiereNom && !nom,
      prenomina: pre ? { motivo: pre.motivo, numeroPeriodo: pre.doc.numeroPeriodo } : null,
      nomina: nom ? { motivo: nom.motivo, numeroPeriodo: nom.doc.numeroPeriodo } : null
    });
  }
  return filas;
}

async function generarPeriodosAnuales(tenantId, empresaId, payload) {
  const {
    tipoPeriodoRef,
    anio,
    fechaInicial,
    numeroInicial = 1,
    tipoNomina = 'ordinaria',
    notas = '',
    subsidiariaId = null
  } = payload;

  if (!tipoPeriodoRef) throw new Error('Tipo de período requerido');

  const bloques = generarBloquesPeriodoAnio({
    tipoMotor: tipoPeriodoRef.tipoMotor,
    diasPeriodo: tipoPeriodoRef.diasPeriodo,
    fechaInicial,
    anio,
    tipoPeriodoRef,
    numeroInicial
  });

  const PayrollPeriod = await getPayrollPeriodModel();
  const PeriodoNomina = await getPeriodoNominaModel();
  const filas = await clasificarBloquesPeriodo(tenantId, empresaId, payload, bloques);
  const destino = resolverDestino(payload);
  const compartir = tipoPeriodoRef.compartirConNomina !== false || destino !== 'prenomina';
  let insertadosPrenomina = 0;
  let insertadosNomina = 0;
  const omitidos = [];
  const scope = scopePeriodo(tenantId, empresaId, subsidiariaId);

  for (const bloque of filas) {
    let payrollId = null;
    if (bloque.aplicaPrenomina && bloque.crearPrenomina) {
      const doc = await PayrollPeriod.create({
        tenantId,
        empresaId,
        subsidiariaId: subsidiariaId || null,
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
        compartirConNomina: compartir,
        notas: notas || ''
      });
      payrollId = doc._id;
      insertadosPrenomina += 1;
    } else if (bloque.aplicaPrenomina || bloque.aplicaNomina) {
      const existente = await PayrollPeriod.findOne({
        ...scope,
        tipoPeriodoId: tipoPeriodoRef._id,
        tipoNomina,
        anio: bloque.anio,
        numeroPeriodo: bloque.numeroPeriodo
      }).select('_id').lean();
      payrollId = existente?._id || null;
      if (bloque.aplicaPrenomina) {
        omitidos.push({
          numeroPeriodo: bloque.numeroPeriodo,
          lado: 'prenomina',
          motivo: bloque.prenomina?.motivo || 'Ya existe'
        });
      }
    }

    if (!bloque.aplicaNomina) continue;
    if (!bloque.crearNomina) {
      if (payrollId && bloque.nomina && bloque.nomina.numeroPeriodo === bloque.numeroPeriodo) {
        await PeriodoNomina.updateOne(
          {
            ...scope,
            tipoPeriodoId: tipoPeriodoRef._id,
            tipoNomina,
            anio: bloque.anio,
            numeroPeriodo: bloque.nomina.numeroPeriodo,
            $or: [{ payrollPeriodId: null }, { payrollPeriodId: { $exists: false } }]
          },
          { $set: { payrollPeriodId: payrollId } }
        );
      }
      omitidos.push({
        numeroPeriodo: bloque.numeroPeriodo,
        lado: 'nomina',
        motivo: bloque.nomina?.motivo || 'Ya existe'
      });
      continue;
    }

    const diasPeriodo = Math.round((startOfDay(bloque.fechaFin) - startOfDay(bloque.fechaInicio)) / 86400000) + 1;
    await PeriodoNomina.create({
      tenantId,
      empresaId,
      subsidiariaId: subsidiariaId || null,
      tipoPeriodo: tipoPeriodoRef.tipoMotor,
      tipoPeriodoId: tipoPeriodoRef._id,
      tipoNomina,
      periodicidadPagoSat: tipoPeriodoRef.periodicidadPagoSat ?? null,
      fechaInicio: startOfDay(bloque.fechaInicio),
      fechaFin: endOfDay(bloque.fechaFin),
      fechaPago: sugerirFechaPago(bloque.fechaFin, tipoPeriodoRef),
      anio: bloque.anio,
      numeroPeriodo: bloque.numeroPeriodo,
      diasPeriodo,
      estatus: 'abierto',
      payrollPeriodId: payrollId,
      notas: notas || ''
    });
    insertadosNomina += 1;
  }

  return {
    destino,
    insertados: insertadosPrenomina,
    insertadosPrenomina,
    insertadosNomina,
    omitidos,
    bloques: bloques.length
  };
}

async function findPeriodoDoc(tenantId, id, empresaId = null, subsidiariaId = null) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const q = { tenantId, _id: id };
  if (empresaId) q.empresaId = empresaId;
  if (subsidiariaId) q.subsidiariaId = subsidiariaId;
  return PayrollPeriod.findOne(q);
}

async function getContextoPeriodo(tenantId, periodo) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const base = {
    tenantId,
    empresaId: periodo.empresaId,
    tipoPeriodoId: periodo.tipoPeriodoId,
    tipoNomina: periodo.tipoNomina || 'ordinaria',
    anio: periodo.anio
  };
  if (periodo.subsidiariaId) base.subsidiariaId = periodo.subsidiariaId;

  const [anterior, siguiente, abiertoOtro] = await Promise.all([
    periodo.numeroPeriodo > 1
      ? PayrollPeriod.findOne({ ...base, numeroPeriodo: periodo.numeroPeriodo - 1 }).lean()
      : null,
    PayrollPeriod.findOne({ ...base, numeroPeriodo: (periodo.numeroPeriodo || 0) + 1 }).lean(),
    periodo.tipoPeriodoId
      ? PayrollPeriod.findOne({
          tenantId,
          empresaId: periodo.empresaId,
          ...(periodo.subsidiariaId ? { subsidiariaId: periodo.subsidiariaId } : {}),
          tipoPeriodoId: periodo.tipoPeriodoId,
          tipoNomina: periodo.tipoNomina || 'ordinaria',
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
  sugerirInicioGeneracion,
  clasificarBloquesPeriodo,
  generarPeriodosAnuales,
  getContextoPeriodo,
  abrirPeriodo,
  cerrarPeriodoAdmin
};
