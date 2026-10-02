'use strict';

/**
 * Organiza períodos de nómina tras importación masiva CFDI:
 * - separa períodos mezclados entre subsidiarias
 * - fusiona ventanas solapadas dentro de cada sub
 * - renumeración cronológica 1..N por sub + año + tipo
 */

const getPeriodoNominaModel = require('../../models/periodoNomina');
const getPayrollPeriodModel = require('../../models/payrollPeriod');
const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
const {
  fusionarPeriodosSolapadosYRenumerar
} = require('../cargas/cfdiPeriodoInferService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function ensureUniqueIndexConSubsidiaria(PeriodoNomina) {
  const coll = PeriodoNomina.collection;
  try {
    await coll.dropIndex('tenantId_1_empresaId_1_anio_1_tipoPeriodo_1_tipoNomina_1_numeroPeriodo_1');
  } catch (e) {
    if (e?.codeName !== 'IndexNotFound' && e?.code !== 27) {
      /* ignore */
    }
  }
  try {
    await coll.createIndex(
      {
        tenantId: 1,
        empresaId: 1,
        subsidiariaId: 1,
        anio: 1,
        tipoPeriodo: 1,
        tipoNomina: 1,
        numeroPeriodo: 1
      },
      {
        unique: true,
        name: 'uniq_periodo_nomina_sub_num',
        partialFilterExpression: { numeroPeriodo: { $type: 'number' } }
      }
    );
  } catch (_) {
    /* already exists */
  }
}

async function recalcTotales(Historico, periodoId) {
  const rows = await Historico.aggregate([
    { $match: { periodoId } },
    {
      $group: {
        _id: null,
        empleados: { $sum: 1 },
        percepciones: { $sum: '$totalPercepciones' },
        deducciones: { $sum: '$totalDeducciones' },
        neto: { $sum: '$netoPagar' }
      }
    }
  ]);
  const t = rows[0] || {};
  return {
    empleados: t.empleados || 0,
    empleadosConError: 0,
    percepciones: round2(t.percepciones),
    deducciones: round2(t.deducciones),
    neto: round2(t.neto)
  };
}

async function renumerarPorSubsidiaria({
  PeriodoNomina,
  Historico,
  Payroll,
  tenantId,
  empresaId,
  tipoMotor,
  tipoNomina,
  subsidiariaId
}) {
  const q = {
    tenantId,
    empresaId,
    tipoPeriodo: tipoMotor,
    tipoNomina
  };
  if (subsidiariaId) q.subsidiariaId = subsidiariaId;
  else q.$or = [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }];

  const periodos = await PeriodoNomina.find(q).sort({ fechaInicio: 1 }).lean();
  if (!periodos.length) return { actualizados: 0 };

  for (let i = 0; i < periodos.length; i += 1) {
    await PeriodoNomina.updateOne(
      { _id: periodos[i]._id },
      { $set: { numeroPeriodo: 4000000 + i } }
    );
  }

  const byAnio = new Map();
  for (const p of periodos) {
    const anio = p.anio || new Date(p.fechaFin || p.fechaInicio).getUTCFullYear();
    if (!byAnio.has(anio)) byAnio.set(anio, []);
    byAnio.get(anio).push({ ...p, anio });
  }

  let actualizados = 0;
  for (const [anio, list] of byAnio) {
    list.sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));
    for (let i = 0; i < list.length; i += 1) {
      const n = i + 1;
      const p = list[i];
      await PeriodoNomina.updateOne({ _id: p._id }, { $set: { anio, numeroPeriodo: n } });
      await Historico.updateMany(
        { periodoId: p._id },
        { $set: { anio, 'periodo.numeroPeriodo': n } }
      );
      if (p.payrollPeriodId) {
        try {
          await Payroll.updateOne(
            { _id: p.payrollPeriodId },
            { $set: { anio, numeroPeriodo: n } }
          );
        } catch (_) {
          /* ignore */
        }
      }
      actualizados += 1;
    }
  }
  return { actualizados };
}

/**
 * Separa períodos con históricos de varias subsidiarias y estampa subsidiariaId.
 */
async function separarPeriodosMezclados({
  tenantId,
  empresaId,
  tipoMotor = 'semanal',
  tipoNomina = 'ordinaria'
}) {
  const PeriodoNomina = await getPeriodoNominaModel();
  const Payroll = await getPayrollPeriodModel();
  const Historico = await getNominaHistoricoReciboModel();

  const periodos = await PeriodoNomina.find({
    tenantId,
    empresaId,
    tipoPeriodo: tipoMotor,
    tipoNomina
  }).lean();

  let split = 0;
  let stamped = 0;
  let tempNumSeq = 2000000;

  for (const p of periodos) {
    const groups = await Historico.aggregate([
      { $match: { periodoId: p._id } },
      { $group: { _id: '$subsidiariaId', c: { $sum: 1 } } },
      { $sort: { c: -1 } }
    ]);

    let payrollSub = null;
    if (p.payrollPeriodId) {
      const pay = await Payroll.findById(p.payrollPeriodId).select('subsidiariaId').lean();
      payrollSub = pay?.subsidiariaId || null;
    }

    if (!groups.length) {
      if (payrollSub && String(p.subsidiariaId || '') !== String(payrollSub)) {
        await PeriodoNomina.updateOne({ _id: p._id }, { $set: { subsidiariaId: payrollSub } });
        stamped += 1;
      }
      continue;
    }

    const normalized = groups.map((g) => ({ subId: g._id || null, count: g.c }));

    if (normalized.length === 1) {
      const subId = normalized[0].subId || payrollSub || null;
      const totales = await recalcTotales(Historico, p._id);
      await PeriodoNomina.updateOne({ _id: p._id }, { $set: { subsidiariaId: subId, totales } });
      stamped += 1;
      continue;
    }

    const primary = normalized[0];
    const primarySub = primary.subId || payrollSub || null;

    const matchPrimary = primary.subId
      ? { periodoId: p._id, subsidiariaId: primary.subId }
      : {
          periodoId: p._id,
          $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
        };
    const totalesPrimary = await Historico.aggregate([
      { $match: matchPrimary },
      {
        $group: {
          _id: null,
          empleados: { $sum: 1 },
          percepciones: { $sum: '$totalPercepciones' },
          deducciones: { $sum: '$totalDeducciones' },
          neto: { $sum: '$netoPagar' }
        }
      }
    ]);
    const tp = totalesPrimary[0] || {};
    let primaryPayrollId = p.payrollPeriodId || null;
    if (primarySub) {
      const pay = await Payroll.findOne({
        tenantId,
        empresaId,
        subsidiariaId: primarySub,
        tipoNomina,
        fechaInicio: p.fechaInicio,
        fechaFin: p.fechaFin
      })
        .select('_id')
        .lean();
      if (pay) primaryPayrollId = pay._id;
    }

    await PeriodoNomina.updateOne(
      { _id: p._id },
      {
        $set: {
          subsidiariaId: primarySub,
          payrollPeriodId: primaryPayrollId,
          totales: {
            empleados: tp.empleados || 0,
            empleadosConError: 0,
            percepciones: round2(tp.percepciones),
            deducciones: round2(tp.deducciones),
            neto: round2(tp.neto)
          }
        }
      }
    );

    for (const g of normalized.slice(1)) {
      const subId = g.subId || null;
      let payId = null;
      if (subId) {
        const pay = await Payroll.findOne({
          tenantId,
          empresaId,
          subsidiariaId: subId,
          tipoNomina,
          $or: [
            { fechaInicio: p.fechaInicio, fechaFin: p.fechaFin },
            { fechaInicio: { $lte: p.fechaFin }, fechaFin: { $gte: p.fechaInicio } }
          ]
        })
          .sort({ fechaInicio: 1 })
          .select('_id')
          .lean();
        if (pay) payId = pay._id;
      }

      const {
        _id,
        createdAt,
        updatedAt,
        __v,
        numeroPeriodo,
        payrollPeriodId,
        totales: _t,
        subsidiariaId: _s,
        ...rest
      } = p;

      const clone = await PeriodoNomina.create({
        ...rest,
        subsidiariaId: subId,
        payrollPeriodId: payId,
        numeroPeriodo: ++tempNumSeq,
        totales: { empleados: 0, empleadosConError: 0, percepciones: 0, deducciones: 0, neto: 0 }
      });

      const histQ = {
        periodoId: p._id,
        ...(subId
          ? { subsidiariaId: subId }
          : { $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }] })
      };
      await Historico.updateMany(histQ, {
        $set: {
          periodoId: clone._id,
          'periodo.fechaInicio': clone.fechaInicio,
          'periodo.fechaFin': clone.fechaFin
        }
      });
      const totalesClone = await recalcTotales(Historico, clone._id);
      await PeriodoNomina.updateOne({ _id: clone._id }, { $set: { totales: totalesClone } });
      split += 1;
    }
  }

  return { stamped, split, revisados: periodos.length };
}

/**
 * Pipeline completo de organización (empresa + tipos).
 * Si subsidiariaId se pasa, al final solo reporta esa sub; la separación es empresa-wide
 * (necesario para desenredar mezclas).
 */
async function organizarPeriodosTrasImportacion({
  tenantId,
  empresaId,
  tipoMotor = 'semanal',
  tipoNomina = 'ordinaria',
  subsidiariaId = null
}) {
  if (!tenantId || !empresaId) {
    throw new Error('tenantId y empresaId requeridos');
  }

  const PeriodoNomina = await getPeriodoNominaModel();
  const Payroll = await getPayrollPeriodModel();
  const Historico = await getNominaHistoricoReciboModel();

  await ensureUniqueIndexConSubsidiaria(PeriodoNomina);

  const separacion = await separarPeriodosMezclados({
    tenantId,
    empresaId,
    tipoMotor,
    tipoNomina
  });

  const subIds = await PeriodoNomina.distinct('subsidiariaId', {
    tenantId,
    empresaId,
    tipoPeriodo: tipoMotor,
    tipoNomina
  });

  const porSub = [];
  for (const sid of subIds) {
    // Si el usuario pidió solo su sub, igual procesamos todas las mezcladas
    // pero reportamos énfasis en la activa.
    const mergeR = await fusionarPeriodosSolapadosYRenumerar({
      tenantId,
      empresaId,
      tipoMotor,
      tipoNomina,
      subsidiariaId: sid || null
    });
    const renum = await renumerarPorSubsidiaria({
      PeriodoNomina,
      Historico,
      Payroll,
      tenantId,
      empresaId,
      tipoMotor,
      tipoNomina,
      subsidiariaId: sid || null
    });
    porSub.push({
      subsidiariaId: sid || null,
      merges: mergeR.merges,
      renumerados: renum.actualizados
    });
  }

  const activos = subsidiariaId
    ? porSub.filter((x) => String(x.subsidiariaId || '') === String(subsidiariaId))
    : porSub;

  return {
    tipoMotor,
    tipoNomina,
    separacion,
    porSub,
    resumenActivo: activos[0] || null
  };
}

module.exports = {
  organizarPeriodosTrasImportacion,
  separarPeriodosMezclados,
  renumerarPorSubsidiaria,
  ensureUniqueIndexConSubsidiaria
};
