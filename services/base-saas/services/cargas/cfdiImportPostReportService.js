'use strict';

const getEmpleadoModel = require('../../models/empleado');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const getFormulaConceptoModel = require('../../models/formulaConcepto');
const { CODIGOS_MOTOR_CONOCIDOS } = require('../../config/satConceptoMotorMap');

const MAX_ITEMS = 40;

function severityRank(s) {
  if (s === 'bloqueante') return 0;
  if (s === 'revisar') return 1;
  return 2;
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Informe post-aplicación CFDI: pendientes de configurar + sugerencias accionables.
 *
 * @param {object} input
 * @param {string} input.tenantId
 * @param {*} input.empresaId
 * @param {*} [input.subsidiariaId]
 * @param {string[]} [input.empleadoIds]
 * @param {Array<object>} [input.conceptosMeta] - [{ codigo, tipo, nombre, claveSat, codigoMotor, inferred, source }]
 * @param {object} [input.stats]
 */
async function buildImportPostReport(input = {}) {
  const tenantId = input.tenantId;
  const empresaId = input.empresaId;
  const subsidiariaId = input.subsidiariaId || null;
  const empleadoIds = (input.empleadoIds || []).filter(Boolean);
  const conceptosMeta = Array.isArray(input.conceptosMeta) ? input.conceptosMeta : [];
  const stats = input.stats || {};

  const sugerencias = [];
  const trabajadores = {
    total: empleadoIds.length,
    sinTipoPeriodo: [],
    sinClasificacion: [],
    sinDatosBancarios: [],
    sinCurp: []
  };
  const conceptos = {
    total: conceptosMeta.length,
    mapeados: [],
    pendientesMapa: [],
    sinFormula: [],
    sinCuentaContable: []
  };

  if (tenantId && empresaId && empleadoIds.length) {
    const Empleado = await getEmpleadoModel();
    const emps = await Empleado.find({
      tenantId,
      _id: { $in: empleadoIds }
    })
      .select(
        'numEmpleado firstName lastName curp tipoPeriodoId sindicalizado datosBancarios subsidiariaId'
      )
      .lean();

    for (const e of emps) {
      const label =
        `${e.numEmpleado || '—'} · ${[e.firstName, e.lastName].filter(Boolean).join(' ') || 'Sin nombre'}`.trim();
      const link = `/personal-empleados/${e._id}/edit`;
      const row = { id: String(e._id), label, link };

      if (!e.curp) trabajadores.sinCurp.push(row);
      if (!e.tipoPeriodoId) trabajadores.sinTipoPeriodo.push(row);
      if (e.sindicalizado == null) trabajadores.sinClasificacion.push(row);

      const db = e.datosBancarios || {};
      const tieneBanco = Boolean(
        String(db.clabe || '').trim() ||
          String(db.cuenta || '').trim() ||
          String(db.bancoCodigo || '').trim()
      );
      if (!tieneBanco) trabajadores.sinDatosBancarios.push(row);
    }

    if (trabajadores.sinTipoPeriodo.length) {
      sugerencias.push({
        severidad: 'bloqueante',
        categoria: 'trabajadores',
        titulo: 'Asignar tipo de período a empleados',
        detalle: `${trabajadores.sinTipoPeriodo.length} trabajador(es) sin tipo de período; el cálculo filtra por SIND/CONF.`,
        link: '/nomina/tipos-periodo',
        linkLabel: 'Tipos de período',
        items: trabajadores.sinTipoPeriodo.slice(0, MAX_ITEMS)
      });
    }
    if (trabajadores.sinClasificacion.length) {
      sugerencias.push({
        severidad: 'revisar',
        categoria: 'trabajadores',
        titulo: 'Definir sindicalizado / confianza',
        detalle: `${trabajadores.sinClasificacion.length} sin flag sindicalizado; afecta el alcance del período.`,
        link: trabajadores.sinClasificacion[0]?.link || '/personal-empleados',
        linkLabel: 'Editar empleado',
        items: trabajadores.sinClasificacion.slice(0, MAX_ITEMS)
      });
    }
    if (trabajadores.sinDatosBancarios.length) {
      sugerencias.push({
        severidad: 'revisar',
        categoria: 'trabajadores',
        titulo: 'Completar datos bancarios',
        detalle: `${trabajadores.sinDatosBancarios.length} sin CLABE/cuenta; necesarios para dispersión.`,
        link: trabajadores.sinDatosBancarios[0]?.link || '/personal-empleados',
        linkLabel: 'Editar empleado',
        items: trabajadores.sinDatosBancarios.slice(0, MAX_ITEMS)
      });
    }
    if (trabajadores.sinCurp.length) {
      sugerencias.push({
        severidad: 'revisar',
        categoria: 'trabajadores',
        titulo: 'Completar CURP',
        detalle: `${trabajadores.sinCurp.length} sin CURP; dificulta conciliaciones y cargas futuras.`,
        link: trabajadores.sinCurp[0]?.link || '/personal-empleados',
        linkLabel: 'Editar empleado',
        items: trabajadores.sinCurp.slice(0, MAX_ITEMS)
      });
    }
  }

  const motorCodesForFormula = new Set();
  if (tenantId && empresaId && conceptosMeta.length) {
    const Concepto = await getConceptoNominaModel();
    const codigos = [...new Set(conceptosMeta.map((c) => String(c.codigo || '').toUpperCase()).filter(Boolean))];
    const docs = await Concepto.find({
      tenantId,
      empresaId,
      codigo: { $in: codigos }
    })
      .select('codigo nombre tipo claveSAT cuentaContable metadata')
      .lean();
    const byCodigo = new Map(docs.map((d) => [String(d.codigo).toUpperCase(), d]));

    for (const meta of conceptosMeta) {
      const codigo = String(meta.codigo || '')
        .trim()
        .toUpperCase();
      if (!codigo) continue;
      const doc = byCodigo.get(codigo) || {};
      const motor = String(
        meta.codigoMotor || doc.metadata?.codigoMotor || ''
      )
        .trim()
        .toUpperCase();
      const inferred =
        meta.inferred === true ||
        (motor && CODIGOS_MOTOR_CONOCIDOS.has(motor) && motor !== codigo);
      const source = meta.source || (inferred ? 'inferido' : 'cfdi_clave');
      const row = {
        codigo,
        nombre: meta.nombre || doc.nombre || codigo,
        tipo: meta.tipo || doc.tipo || '',
        claveSat: meta.claveSat || doc.claveSAT || '',
        codigoMotor: motor && motor !== codigo ? motor : motor || '',
        source,
        link: `/nomina/conceptos/${encodeURIComponent(codigo)}`
      };

      if (inferred && motor && CODIGOS_MOTOR_CONOCIDOS.has(motor)) {
        conceptos.mapeados.push(row);
        motorCodesForFormula.add(motor);
      } else {
        conceptos.pendientesMapa.push(row);
      }

      if (!String(doc.cuentaContable || '').trim()) {
        conceptos.sinCuentaContable.push(row);
      }
    }

    conceptos.mapeados = uniqBy(conceptos.mapeados, (r) => r.codigo);
    conceptos.pendientesMapa = uniqBy(conceptos.pendientesMapa, (r) => r.codigo);
    conceptos.sinCuentaContable = uniqBy(conceptos.sinCuentaContable, (r) => r.codigo);

    if (conceptos.pendientesMapa.length) {
      sugerencias.push({
        severidad: 'bloqueante',
        categoria: 'conceptos',
        titulo: 'Mapear conceptos CFDI al motor',
        detalle: `${conceptos.pendientesMapa.length} concepto(s) sin vínculo al catálogo motor; no entrarán al recálculo con fórmula.`,
        link: '/nomina/mapeo-sat',
        linkLabel: 'Mapeo SAT → motor',
        items: conceptos.pendientesMapa.slice(0, MAX_ITEMS).map((r) => ({
          id: r.codigo,
          label: `${r.codigo} · ${r.nombre}${r.claveSat ? ` (SAT ${r.claveSat})` : ''}`,
          link: r.link
        }))
      });
    }

    if (conceptos.mapeados.length) {
      sugerencias.push({
        severidad: 'info',
        categoria: 'conceptos',
        titulo: 'Conceptos ligados al motor',
        detalle: `${conceptos.mapeados.length} concepto(s) con código motor inferido/mapeado.`,
        link: '/nomina/conceptos',
        linkLabel: 'Ver conceptos',
        items: conceptos.mapeados.slice(0, MAX_ITEMS).map((r) => ({
          id: r.codigo,
          label: `${r.codigo} → ${r.codigoMotor || '—'} · ${r.nombre}`,
          link: r.link
        }))
      });
    }

    if (conceptos.sinCuentaContable.length) {
      sugerencias.push({
        severidad: 'revisar',
        categoria: 'contabilidad',
        titulo: 'Asignar cuentas contables',
        detalle: `${conceptos.sinCuentaContable.length} concepto(s) sin cuenta contable.`,
        link: '/nomina/conceptos',
        linkLabel: 'Conceptos de nómina',
        items: conceptos.sinCuentaContable.slice(0, MAX_ITEMS).map((r) => ({
          id: r.codigo,
          label: `${r.codigo} · ${r.nombre}`,
          link: r.link
        }))
      });
    }

    // Fórmulas vigentes para códigos motor ligados
    if (motorCodesForFormula.size) {
      const Formula = await getFormulaConceptoModel();
      const formulas = await Formula.find({
        tenantId,
        conceptoCodigo: { $in: [...motorCodesForFormula] },
        activo: true,
        $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: new Date() } }]
      })
        .select('conceptoCodigo')
        .lean();
      const conFormula = new Set(formulas.map((f) => String(f.conceptoCodigo).toUpperCase()));
      for (const row of conceptos.mapeados) {
        const motor = String(row.codigoMotor || '').toUpperCase();
        if (motor && !conFormula.has(motor)) {
          conceptos.sinFormula.push({
            ...row,
            label: `${row.codigo} → ${motor} sin fórmula activa`
          });
        }
      }
      conceptos.sinFormula = uniqBy(conceptos.sinFormula, (r) => r.codigoMotor || r.codigo);
      if (conceptos.sinFormula.length) {
        sugerencias.push({
          severidad: 'bloqueante',
          categoria: 'conceptos',
          titulo: 'Configurar fórmulas de conceptos ligados',
          detalle: `${conceptos.sinFormula.length} mapeo(s) sin fórmula vigente; el recálculo no podrá calcularlos.`,
          link: '/nomina/conceptos',
          linkLabel: 'Editar fórmulas',
          items: conceptos.sinFormula.slice(0, MAX_ITEMS).map((r) => ({
            id: r.codigo,
            label: r.label || `${r.codigo} → ${r.codigoMotor}`,
            link: r.codigoMotor
              ? `/nomina/conceptos/${encodeURIComponent(r.codigoMotor)}`
              : r.link
          }))
        });
      }
    }
  }

  if (stats.erroresApply > 0) {
    sugerencias.push({
      severidad: 'bloqueante',
      categoria: 'aplicacion',
      titulo: 'Revisar errores de aplicación',
      detalle: `${stats.erroresApply} error(es) al aplicar; el job quedó parcial o en error.`,
      link: `#errores-job`,
      linkLabel: 'Ver errores abajo'
    });
  }

  if (stats.periodos && Number(stats.periodos.ventanas || 0) > 0) {
    sugerencias.push({
      severidad: 'info',
      categoria: 'periodos',
      titulo: 'Revisar períodos inferidos',
      detalle: `${stats.periodos.ventanas} ventana(s) · creados ${stats.periodos.periodosCreados || 0} · actualizados ${stats.periodos.periodosActualizados || 0}. Vincula el tipo de catálogo y recalcula.`,
      link: '/nomina/periodos',
      linkLabel: 'Períodos de nómina'
    });
  }

  sugerencias.sort((a, b) => severityRank(a.severidad) - severityRank(b.severidad));

  const pendientes =
    trabajadores.sinTipoPeriodo.length +
    trabajadores.sinClasificacion.length +
    conceptos.pendientesMapa.length +
    conceptos.sinFormula.length +
    Number(stats.erroresApply || 0);

  return {
    generadoEn: new Date().toISOString(),
    subsidiariaId: subsidiariaId ? String(subsidiariaId) : null,
    contadores: {
      recibosAplicados: Number(stats.aplicadas || 0),
      empleadosAfectados: Number(stats.empleadosAfectados || empleadoIds.length || 0),
      conceptosTocados: conceptos.total,
      conceptosMapeados: conceptos.mapeados.length,
      conceptosPendientes: conceptos.pendientesMapa.length,
      sinFormula: conceptos.sinFormula.length,
      sinCuentaContable: conceptos.sinCuentaContable.length,
      trabajadoresSinTipoPeriodo: trabajadores.sinTipoPeriodo.length,
      trabajadoresSinClasificacion: trabajadores.sinClasificacion.length,
      trabajadoresSinBanco: trabajadores.sinDatosBancarios.length,
      pendientes
    },
    trabajadores: {
      total: trabajadores.total,
      sinTipoPeriodo: trabajadores.sinTipoPeriodo.slice(0, MAX_ITEMS),
      sinClasificacion: trabajadores.sinClasificacion.slice(0, MAX_ITEMS),
      sinDatosBancarios: trabajadores.sinDatosBancarios.slice(0, MAX_ITEMS),
      sinCurp: trabajadores.sinCurp.slice(0, MAX_ITEMS)
    },
    conceptos: {
      total: conceptos.total,
      mapeados: conceptos.mapeados.slice(0, MAX_ITEMS),
      pendientesMapa: conceptos.pendientesMapa.slice(0, MAX_ITEMS),
      sinFormula: conceptos.sinFormula.slice(0, MAX_ITEMS),
      sinCuentaContable: conceptos.sinCuentaContable.slice(0, MAX_ITEMS)
    },
    sugerencias
  };
}

/**
 * Reconstruye el informe para un job ya aplicado (staging + empleados/conceptos actuales).
 */
async function rebuildImportPostReportFromJob(tenantId, job) {
  if (!job) throw new Error('Job requerido');
  const getCargaCfdiStagingModel = require('../../models/cargaCfdiStaging');
  const getEmpleadoModel = require('../../models/empleado');
  const Staging = await getCargaCfdiStagingModel();
  const Empleado = await getEmpleadoModel();

  const subsidiariaId = job.resumen?.subsidiariaId || job.subsidiariaId || null;
  const conceptoMetaMap = new Map();
  const curps = new Set();
  const nums = new Set();

  const cursor = Staging.find({ jobId: job._id, estatus: 'ok' })
    .select('payload.conceptos payload.empleado')
    .lean()
    .cursor();

  for await (const doc of cursor) {
    const emp = doc.payload?.empleado || {};
    if (emp.curp) curps.add(String(emp.curp).trim().toUpperCase());
    if (emp.numEmpleado) nums.add(String(emp.numEmpleado).trim());
    for (const c of doc.payload?.conceptos || []) {
      const codigo = String(c.conceptoCodigo || c.claveInterna || '')
        .trim()
        .toUpperCase();
      if (!codigo || conceptoMetaMap.has(codigo)) continue;
      try {
        const { applyInferenciaSatAConcepto } = require('../nomina/satConceptoInferService');
        await applyInferenciaSatAConcepto(c, {
          tenantId,
          empresaId: job.empresaId,
          subsidiariaId,
          preferClaveInterna: true
        });
      } catch (_) {
        /* seguir */
      }
      const sat = c._satInfer || {};
      conceptoMetaMap.set(codigo, {
        codigo,
        tipo: c.tipo || '',
        nombre: c.nombre || '',
        claveSat: c.claveSat || sat.claveSat || '',
        codigoMotor: String(sat.codigoMotor || c.codigoMotorSugerido || '').toUpperCase(),
        inferred: Boolean(sat.inferred),
        source: sat.source || ''
      });
    }
  }

  const orEmp = [];
  if (curps.size) orEmp.push({ curp: { $in: [...curps] } });
  if (nums.size) orEmp.push({ numEmpleado: { $in: [...nums] } });
  let empleadoIds = [];
  if (orEmp.length) {
    const q = { tenantId, empresaId: job.empresaId, $or: orEmp };
    if (subsidiariaId) q.subsidiariaId = subsidiariaId;
    empleadoIds = await Empleado.find(q).distinct('_id');
  }

  return buildImportPostReport({
    tenantId,
    empresaId: job.empresaId,
    subsidiariaId,
    empleadoIds,
    conceptosMeta: [...conceptoMetaMap.values()],
    stats: {
      aplicadas: job.filasAplicadas || job.resumen?.aplicadas || 0,
      empleadosAfectados: empleadoIds.length,
      erroresApply: job.resumen?.erroresApply || (job.errores || []).length,
      periodos: job.resumen?.periodos || null
    }
  });
}

module.exports = {
  buildImportPostReport,
  rebuildImportPostReportFromJob
};
