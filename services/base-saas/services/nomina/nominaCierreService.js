'use strict';

const getReciboNominaModel = require('../../models/reciboNomina');
const getConceptoAplicadoModel = require('../../models/conceptoAplicado');
const getEmpleadoModel = require('../../models/empleado');
const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
const getNominaAcumuladoModel = require('../../models/nominaAcumulado');

const CHUNK = 200;

function anioMesDePeriodo(periodo) {
  const ref = periodo.fechaFin || periodo.fechaInicio || new Date();
  const d = new Date(ref);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

/**
 * Al cerrar: copia recibos+conceptos a histórico (1 doc/empleado),
 * actualiza acumulados anuales y marca fechaCierre en recibos operativos.
 */
async function archivarYAcumularCierre({ tenantId, periodo, userId = '' }) {
  const fechaCierre = new Date();
  const { anio, mes } = anioMesDePeriodo(periodo);
  const mesKey = String(mes);

  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();
  const Empleado = await getEmpleadoModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Acumulado = await getNominaAcumuladoModel();

  const recibos = await ReciboNomina.find({ tenantId, periodoId: periodo._id }).lean();
  if (!recibos.length) {
    return { archivados: 0, conceptosAcumulados: 0, fechaCierre };
  }

  const reciboIds = recibos.map((r) => r._id);
  const empleadoIds = [...new Set(recibos.map((r) => String(r.empleadoId)))];
  const [aplicados, empleados] = await Promise.all([
    ConceptoAplicado.find({ tenantId, reciboId: { $in: reciboIds } }).lean(),
    Empleado.find({ _id: { $in: empleadoIds } })
      .select('numEmpleado firstName lastName tipoEmpleado tipoContrato')
      .lean()
  ]);

  const empById = new Map(empleados.map((e) => [String(e._id), e]));
  const conceptosByRecibo = new Map();
  for (const a of aplicados) {
    const key = String(a.reciboId);
    if (!conceptosByRecibo.has(key)) conceptosByRecibo.set(key, []);
    conceptosByRecibo.get(key).push(a);
  }

  const historicoDocs = [];
  const acumOps = [];

  for (const recibo of recibos) {
    const emp = empById.get(String(recibo.empleadoId)) || {};
    const conceptos = (conceptosByRecibo.get(String(recibo._id)) || []).map((c) => ({
      conceptoCodigo: c.conceptoCodigo,
      formulaUsada: c.formulaUsada || '',
      condicionUsada: c.condicionUsada || '',
      variablesUsadas: c.variablesUsadas || {},
      importe: Number(c.importe) || 0,
      gravado: Number(c.gravado) || 0,
      exento: Number(c.exento) || 0,
      desgloseModo: c.desgloseModo || '',
      claveSAT: c.claveSAT || '',
      tipo: c.tipo || '',
      requiereRevision: !!c.requiereRevision,
      errorCalculo: c.errorCalculo || '',
      versionFormula: c.versionFormula || 1
    }));

    historicoDocs.push({
      tenantId,
      empresaId: periodo.empresaId || null,
      periodoId: periodo._id,
      reciboOrigenId: recibo._id,
      origen: 'cierre',
      claveImportacion: '',
      empleadoId: recibo.empleadoId,
      anio,
      mes,
      periodo: {
        tipoPeriodo: periodo.tipoPeriodo,
        tipoNomina: periodo.tipoNomina,
        fechaInicio: periodo.fechaInicio,
        fechaFin: periodo.fechaFin,
        diasPeriodo: periodo.diasPeriodo || 0
      },
      empleado: {
        numEmpleado: emp.numEmpleado || '',
        nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        tipoEmpleado: emp.tipoEmpleado || '',
        tipoContrato: emp.tipoContrato || ''
      },
      diasLaborados: recibo.diasLaborados || 0,
      faltas: recibo.faltas || 0,
      totalPercepciones: recibo.totalPercepciones || 0,
      totalDeducciones: recibo.totalDeducciones || 0,
      netoPagar: recibo.netoPagar || 0,
      basesFiscales: recibo.basesFiscales || {},
      insumosFuente: recibo.insumosFuente || '',
      insumosResumen: recibo.insumosResumen || {},
      conceptos,
      fechaCalculo: recibo.fechaCalculo || periodo.calculadoAt || periodo.fechaCalculo || null,
      fechaCierre,
      cerradoPorUserId: userId || '',
      isrMotor: recibo.isrMotor || null,
      calculoId: recibo.calculoId || '',
      calculoLoteId: recibo.calculoLoteId || periodo.calculoLoteId || ''
    });

    for (const c of conceptos) {
      if (!c.conceptoCodigo) continue;
      const importe = Number(c.importe) || 0;
      const gravado = Number(c.gravado) || 0;
      const exento = Number(c.exento) || 0;
      if (importe === 0 && gravado === 0 && exento === 0) continue;

      acumOps.push({
        updateOne: {
          filter: {
            tenantId,
            empleadoId: recibo.empleadoId,
            anio,
            conceptoCodigo: c.conceptoCodigo
          },
          update: {
            $setOnInsert: {
              tenantId,
              empresaId: periodo.empresaId || null,
              empleadoId: recibo.empleadoId,
              anio,
              conceptoCodigo: c.conceptoCodigo
            },
            $inc: {
              importeAnual: importe,
              gravadoAnual: gravado,
              exentoAnual: exento,
              [`porMes.${mesKey}.importe`]: importe,
              [`porMes.${mesKey}.gravado`]: gravado,
              [`porMes.${mesKey}.exento`]: exento
            },
            $set: {
              ultimoPeriodoId: periodo._id,
              ultimaFechaCierre: fechaCierre
            }
          },
          upsert: true
        }
      });
    }
  }

  for (let i = 0; i < historicoDocs.length; i += CHUNK) {
    const slice = historicoDocs.slice(i, i + CHUNK);
    const ops = slice.map((doc) => ({
      updateOne: {
        filter: {
          tenantId: doc.tenantId,
          periodoId: doc.periodoId,
          empleadoId: doc.empleadoId
        },
        update: { $set: doc },
        upsert: true
      }
    }));
    await Historico.bulkWrite(ops, { ordered: false });
  }

  for (let i = 0; i < acumOps.length; i += CHUNK) {
    await Acumulado.bulkWrite(acumOps.slice(i, i + CHUNK), { ordered: false });
  }

  await ReciboNomina.updateMany(
    { tenantId, periodoId: periodo._id },
    { $set: { fechaCierre, cerrado: true } }
  );

  return {
    archivados: historicoDocs.length,
    conceptosAcumulados: acumOps.length,
    fechaCierre
  };
}

module.exports = { archivarYAcumularCierre, anioMesDePeriodo };
