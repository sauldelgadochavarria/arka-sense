'use strict';

/**
 * Repara períodos importados CFDI que quedaron como «mensual» por SAT 99
 * (Otra periodicidad → extraordinarias).
 *
 * Uso: node scripts/_repair-sat99-otra-periodicidad.js [empresaId]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

(async () => {
  const empresaIdArg = process.argv[2] || null;
  const getTipo = require('../models/tipoPeriodoNomina');
  const getPayroll = require('../models/payrollPeriod');
  const getPeriodo = require('../models/periodoNomina');
  const { crearTipoPeriodo, nextCodigoLegado, ensureTiposPeriodoForTenant } = require('../services/tipoPeriodoNominaService');

  const Tipo = await getTipo();
  const Payroll = await getPayroll();
  const Periodo = await getPeriodo();

  const empFilter = empresaIdArg ? { empresaId: empresaIdArg } : {};
  const empresas = await Tipo.distinct('empresaId', empFilter);
  let totalPay = 0;
  let totalNom = 0;

  for (const empresaId of empresas) {
    const sample = await Tipo.findOne({ empresaId }).select('tenantId').lean();
    if (!sample?.tenantId) continue;
    const tenantId = sample.tenantId;
    await ensureTiposPeriodoForTenant(tenantId, empresaId);

    let tipo99 = await Tipo.findOne({
      tenantId,
      empresaId,
      periodicidadPagoSat: 99,
      activo: true
    }).lean();

    if (!tipo99) {
      const codigoLegado = await nextCodigoLegado(tenantId, empresaId);
      const created = await crearTipoPeriodo(tenantId, empresaId, {
        codigoLegado,
        codigoExterno: 'CFDI-SAT-99',
        nombre: 'Otra periodicidad (SAT 99 · extraordinarias)',
        tipoMotor: 'otra',
        diasPeriodo: 0,
        esSeptimo: false,
        diasLaborables: 0,
        leyenda: 'sat_99_otra',
        periodicidadPagoSat: 99,
        diaInicioSemana: 1,
        modoCalendario: 'calendario_fijo',
        aplicaAsistenciaPrenomina: false,
        compartirConNomina: true
      });
      tipo99 = created.toObject ? created.toObject() : created;
      console.log('created tipo99', String(empresaId), String(tipo99._id));
    } else if (tipo99.tipoMotor !== 'otra') {
      await Tipo.updateOne({ _id: tipo99._id }, { $set: { tipoMotor: 'otra', nombre: 'Otra periodicidad (SAT 99 · extraordinarias)' } });
      tipo99.tipoMotor = 'otra';
      console.log('fixed tipo99 motor', String(tipo99._id));
    }

    const mensuales = await Tipo.find({
      tenantId,
      empresaId,
      tipoMotor: 'mensual',
      periodicidadPagoSat: { $ne: 99 }
    })
      .select('_id')
      .lean();
    const mensualIds = mensuales.map((t) => t._id);
    if (!mensualIds.length) continue;

    const payFilter = {
      tenantId,
      empresaId,
      tipoPeriodoId: { $in: mensualIds },
      tipoNomina: { $ne: 'ordinaria' },
      notas: /Import CFDI/i
    };
    const rPay = await Payroll.updateMany(payFilter, {
      $set: {
        tipo: 'otra',
        tipoPeriodoId: tipo99._id,
        codigoLegadoTipoPeriodo: tipo99.codigoLegado
      }
    });
    totalPay += rPay.modifiedCount || 0;

    const nomFilter = {
      tenantId,
      empresaId,
      tipoPeriodo: 'mensual',
      tipoNomina: { $ne: 'ordinaria' },
      $or: [{ notas: /Import CFDI/i }, { cerradoPorLabel: 'import_cfdi' }]
    };
    const rNom = await Periodo.updateMany(nomFilter, {
      $set: { tipoPeriodo: 'otra' }
    });
    totalNom += rNom.modifiedCount || 0;

    // También alinea PeriodoNomina ligados a payroll ya corregidos
    const payIds = await Payroll.find({
      tenantId,
      empresaId,
      tipoPeriodoId: tipo99._id,
      tipoNomina: { $ne: 'ordinaria' }
    }).distinct('_id');
    if (payIds.length) {
      const r2 = await Periodo.updateMany(
        { tenantId, empresaId, payrollPeriodId: { $in: payIds } },
        { $set: { tipoPeriodo: 'otra' } }
      );
      totalNom += r2.modifiedCount || 0;
    }

    console.log('empresa', String(empresaId), {
      pay: rPay.modifiedCount,
      nom: rNom.modifiedCount
    });
  }

  console.log('done', { totalPay, totalNom });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
