'use strict';

const getReciboNominaModel = require('../../models/reciboNomina');
const getConceptoAplicadoModel = require('../../models/conceptoAplicado');
const getEmpleadoModel = require('../../models/empleado');
const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
const getNominaAcumuladoModel = require('../../models/nominaAcumulado');
const { enlazarArchivosAHistorico } = require('../cfdiArchivoService');

const CHUNK = 200;

function anioMesDePeriodo(periodo) {
  const ref = periodo.fechaFin || periodo.fechaInicio || new Date();
  const d = new Date(ref);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

/** Cargas iniciales antiguas guardaban porMes.N como número; el cierre necesita objeto. */
function toPorMesBucket(val) {
  if (val != null && typeof val === 'object' && !Array.isArray(val)) {
    return {
      importe: Number(val.importe) || 0,
      gravado: Number(val.gravado) || 0,
      exento: Number(val.exento) || 0
    };
  }
  const n = Number(val) || 0;
  return { importe: n, gravado: n, exento: 0 };
}

function normalizarMapaPorMes(porMes) {
  const out = {};
  for (const [k, v] of Object.entries(porMes || {})) {
    out[String(k)] = toPorMesBucket(v);
  }
  return out;
}

/**
 * Reescribe porMes numérico → {importe,gravado,exento} antes del $inc del cierre.
 */
async function normalizarPorMesAntesDeInc(Acumulado, { tenantId, empresaId, empleadoIds, anio }) {
  if (!empleadoIds.length) return 0;
  const filter = {
    tenantId,
    anio,
    empleadoId: { $in: empleadoIds }
  };
  if (empresaId) filter.empresaId = empresaId;

  const docs = await Acumulado.find(filter).select('_id porMes').lean();

  const ops = [];
  for (const doc of docs) {
    const pm = doc.porMes || {};
    const necesita = Object.values(pm).some((v) => v != null && typeof v !== 'object');
    if (!necesita) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { porMes: normalizarMapaPorMes(pm) } }
      }
    });
  }
  if (!ops.length) return 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    await Acumulado.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
  }
  return ops.length;
}

/**
 * Al cerrar: mueve recibos operativos → histórico (copiar + borrar),
 * actualiza acumulados anuales. El temporal queda compacto.
 *
 * Llaves de alcance: tenantId + empresaId + subsidiariaId (+ periodo/empleado).
 */
async function archivarYAcumularCierre({ tenantId, periodo, userId = '' }) {
  const fechaCierre = new Date();
  const { anio, mes } = anioMesDePeriodo(periodo);
  const mesKey = String(mes);
  const empresaId = periodo.empresaId || null;

  const ReciboNomina = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();
  const Empleado = await getEmpleadoModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Acumulado = await getNominaAcumuladoModel();

  const recibos = await ReciboNomina.find({ tenantId, periodoId: periodo._id }).lean();
  if (!recibos.length) {
    // Período ya movido o sin cálculo: no falla el cierre de estatus
    return {
      archivados: 0,
      conceptosAcumulados: 0,
      operativosEliminados: 0,
      fechaCierre
    };
  }

  const reciboIds = recibos.map((r) => r._id);
  const empleadoIds = [...new Set(recibos.map((r) => String(r.empleadoId)))];
  const [aplicados, empleados] = await Promise.all([
    ConceptoAplicado.find({ tenantId, reciboId: { $in: reciboIds } }).lean(),
    Empleado.find({ _id: { $in: empleadoIds } })
      .select(
        'numEmpleado firstName lastName tipoEmpleado tipoContrato empresaId subsidiariaId departamentoId centroCostoId'
      )
      .lean()
  ]);

  const empById = new Map(empleados.map((e) => [String(e._id), e]));
  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean).map(String))];
  const ccIds = [...new Set(empleados.map((e) => e.centroCostoId).filter(Boolean).map(String))];
  const getDepartamentoModel = require('../../models/departamento');
  const getCentroCostoModel = require('../../models/centroCosto');
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const [deptos, ccs] = await Promise.all([
    deptoIds.length
      ? Departamento.find({ _id: { $in: deptoIds } }).select('nombre').lean()
      : [],
    ccIds.length
      ? CentroCosto.find({ _id: { $in: ccIds } }).select('codigo nombre').lean()
      : []
  ]);
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const ccById = new Map(ccs.map((c) => [String(c._id), c]));
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
    const empEmpresaId = empresaId || emp.empresaId || null;
    const subsidiariaId = emp.subsidiariaId || null;

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
      empresaId: empEmpresaId,
      subsidiariaId,
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
        numeroPeriodo: periodo.numeroPeriodo != null ? periodo.numeroPeriodo : null,
        fechaInicio: periodo.fechaInicio,
        fechaFin: periodo.fechaFin,
        diasPeriodo: periodo.diasPeriodo || 0
      },
      empleado: {
        numEmpleado: emp.numEmpleado || '',
        nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        tipoEmpleado: emp.tipoEmpleado || '',
        tipoContrato: emp.tipoContrato || '',
        departamentoId: emp.departamentoId || null,
        departamentoNombre: emp.departamentoId
          ? deptoById.get(String(emp.departamentoId))?.nombre || ''
          : '',
        centroCostoId: emp.centroCostoId || null,
        centroCostoCodigo: emp.centroCostoId
          ? ccById.get(String(emp.centroCostoId))?.codigo || ''
          : '',
        centroCostoNombre: emp.centroCostoId
          ? ccById.get(String(emp.centroCostoId))?.nombre || ''
          : ''
      },
      diasLaborados: recibo.diasLaborados || 0,
      diasPagados: recibo.diasPago?.diasPagados != null ? recibo.diasPago.diasPagados : null,
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
      cfdiSeparacionIndemnizacion: recibo.cfdiSeparacionIndemnizacion || null,
      calculoId: recibo.calculoId || '',
      calculoLoteId: recibo.calculoLoteId || periodo.calculoLoteId || '',
      layoutBancario: recibo.layoutBancario || {},
      timbrado: recibo.timbrado || {},
      correo: recibo.correo || {}
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
              empresaId: empEmpresaId,
              subsidiariaId,
              ultimoPeriodoId: periodo._id,
              ultimaFechaCierre: fechaCierre
            }
          },
          upsert: true
        }
      });
    }
  }

  // 1) Histórico (idempotente por tenant + empresa + período + empleado)
  for (let i = 0; i < historicoDocs.length; i += CHUNK) {
    const slice = historicoDocs.slice(i, i + CHUNK);
    const ops = slice.map((doc) => ({
      updateOne: {
        filter: {
          tenantId: doc.tenantId,
          empresaId: doc.empresaId,
          periodoId: doc.periodoId,
          empleadoId: doc.empleadoId
        },
        update: { $set: doc },
        upsert: true
      }
    }));
    await Historico.bulkWrite(ops, { ordered: false });
  }

  // 1b) Enlazar XML/PDF CFDI del recibo operativo al histórico
  const histRows = await Historico.find({
    tenantId,
    periodoId: periodo._id,
    origen: 'cierre',
    reciboOrigenId: { $in: reciboIds }
  })
    .select('_id reciboOrigenId')
    .lean();
  await enlazarArchivosAHistorico(
    tenantId,
    histRows.map((h) => ({ reciboId: h.reciboOrigenId, historicoId: h._id }))
  );

  // 2) Acumulados
  await normalizarPorMesAntesDeInc(Acumulado, {
    tenantId,
    empresaId,
    empleadoIds: recibos.map((r) => r.empleadoId),
    anio
  });

  for (let i = 0; i < acumOps.length; i += CHUNK) {
    await Acumulado.bulkWrite(acumOps.slice(i, i + CHUNK), { ordered: false });
  }

  // 3) Borrar operativo (mover = copiar + eliminar)
  await ConceptoAplicado.deleteMany({ tenantId, reciboId: { $in: reciboIds } });
  const delRecibos = await ReciboNomina.deleteMany({ tenantId, periodoId: periodo._id });

  return {
    archivados: historicoDocs.length,
    conceptosAcumulados: acumOps.length,
    operativosEliminados: delRecibos.deletedCount || 0,
    fechaCierre
  };
}

module.exports = { archivarYAcumularCierre, anioMesDePeriodo };
