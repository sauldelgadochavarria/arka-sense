'use strict';

const mongoose = require('mongoose');
const getEmpleadoModel = require('../../../models/empleado');
const getNominaHistoricoReciboModel = require('../../../models/nominaHistoricoRecibo');
const { toNum, toDate } = require('../csvParse');

function diasEntre(ini, fin) {
  const a = new Date(ini);
  const b = new Date(fin);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function claveImport(row) {
  const ini = row.fechaInicio instanceof Date ? row.fechaInicio.toISOString().slice(0, 10) : String(row.fechaInicio);
  return `${row.numEmpleado}|${row.tipoPeriodo}|${row.numeroPeriodo}|${ini}`;
}

async function validateHistorico(tenantId, empresaId, rows) {
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId })
    .select('_id numEmpleado firstName lastName tipoEmpleado tipoContrato subsidiariaId')
    .lean();
  const byNum = new Map(empleados.map((e) => [String(e.numEmpleado), e]));
  const errores = [];
  const ok = [];
  const keys = new Set();

  for (const { fila, data } of rows) {
    const num = String(data.numEmpleado || '').trim();
    const emp = byNum.get(num);
    if (!num || !emp) {
      errores.push({
        fila,
        campo: 'numEmpleado',
        mensaje: num ? 'Empleado no existe' : 'Obligatorio',
        valor: num
      });
      continue;
    }
    const fechaInicio = toDate(data.fechaInicio);
    const fechaFin = toDate(data.fechaFin);
    if (!fechaInicio || !fechaFin) {
      errores.push({
        fila,
        campo: 'fechas',
        mensaje: 'fechaInicio/fechaFin inválidas',
        valor: `${data.fechaInicio}|${data.fechaFin}`
      });
      continue;
    }

    const rowOk = {
      fila,
      numEmpleado: num,
      empleadoId: emp._id,
      nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      tipoEmpleado: emp.tipoEmpleado || '',
      tipoContrato: emp.tipoContrato || '',
      subsidiariaId: emp.subsidiariaId || null,
      anio: toNum(data.anio, fechaInicio.getFullYear()),
      numeroPeriodo: toNum(data.numeroPeriodo, 0) || 0,
      tipoPeriodo: String(data.tipoPeriodo || 'semanal').trim().toLowerCase(),
      fechaInicio,
      fechaFin,
      netoPagar: toNum(data.netoPagar, 0) || 0,
      percepciones: toNum(data.percepciones, 0) || 0,
      deducciones: toNum(data.deducciones, 0) || 0,
      diasLaborados: toNum(data.diasLaborados, 0) || 0,
      diasPagados: toNum(data.diasPagados, null)
    };
    const k = claveImport(rowOk);
    if (keys.has(k)) {
      errores.push({ fila, campo: 'numeroPeriodo', mensaje: 'Duplicado en archivo', valor: k });
      continue;
    }
    keys.add(k);
    rowOk.claveImportacion = k;
    ok.push(rowOk);
  }

  return {
    errores,
    validos: ok,
    resumen: {
      recibos: ok.length,
      nota: 'Se guardarán como histórico origen=importacion (sin período local).'
    }
  };
}

async function applyHistorico(tenantId, empresaId, validos) {
  const Historico = await getNominaHistoricoReciboModel();

  // Quitar índice único viejo (periodoId requerido) si aún existe y choca con nulls
  try {
    await Historico.collection.dropIndex('tenantId_1_periodoId_1_empleadoId_1');
  } catch (_) {
    /* ok si no existe o ya es parcial */
  }
  await Historico.syncIndexes().catch(() => {});

  let aplicadas = 0;
  const errores = [];

  for (const row of validos) {
    try {
      const empleadoId =
        row.empleadoId instanceof mongoose.Types.ObjectId
          ? row.empleadoId
          : new mongoose.Types.ObjectId(String(row.empleadoId));
      const mes = (row.fechaInicio instanceof Date ? row.fechaInicio : new Date(row.fechaInicio)).getMonth() + 1;
      const clave = row.claveImportacion || claveImport(row);

      await Historico.updateOne(
        { tenantId, claveImportacion: clave },
        {
          $set: {
            empresaId,
            subsidiariaId: row.subsidiariaId || null,
            periodoId: null,
            reciboOrigenId: null,
            origen: 'importacion',
            claveImportacion: clave,
            empleadoId,
            anio: row.anio,
            mes,
            periodo: {
              tipoPeriodo: row.tipoPeriodo,
              tipoNomina: 'ordinaria',
              numeroPeriodo: row.numeroPeriodo,
              fechaInicio: row.fechaInicio,
              fechaFin: row.fechaFin,
              diasPeriodo: diasEntre(row.fechaInicio, row.fechaFin)
            },
            empleado: {
              numEmpleado: row.numEmpleado,
              nombre: row.nombre || '',
              tipoEmpleado: row.tipoEmpleado || '',
              tipoContrato: row.tipoContrato || ''
            },
            diasLaborados: row.diasLaborados,
            diasPagados: row.diasPagados,
            faltas: 0,
            totalPercepciones: row.percepciones,
            totalDeducciones: row.deducciones,
            netoPagar: row.netoPagar,
            conceptos: [],
            insumosFuente: 'importacion_carga_inicial',
            fechaCalculo: row.fechaFin,
            fechaCierre: row.fechaFin,
            cerradoPorUserId: 'carga_inicial'
          },
          $setOnInsert: {
            tenantId
          }
        },
        { upsert: true }
      );
      aplicadas += 1;
    } catch (err) {
      errores.push({
        fila: row.fila,
        campo: 'numEmpleado',
        mensaje: err.message || 'Error al guardar histórico',
        valor: row.numEmpleado
      });
    }
  }

  return { aplicadas, errores };
}

module.exports = { validateHistorico, applyHistorico };
