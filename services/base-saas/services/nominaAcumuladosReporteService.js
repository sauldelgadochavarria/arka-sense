'use strict';

/**
 * Reporte de acumulados anuales (colección nomina_acumulados).
 * Vistas: detalle (empleado×concepto), matriz (conceptos en columnas), resumen (depto / concepto).
 */

const getNominaAcumuladoModel = require('../models/nominaAcumulado');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getReciboNominaModel = require('../models/reciboNomina');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getCentroCostoModel = require('../models/centroCosto');
const getConceptCatalogModel = require('../models/conceptCatalog');
const getConceptoNominaModel = require('../models/conceptoNomina');
const { META_CONCEPTOS } = require('./nominaReportesService');

const VISTAS = ['sabanota', 'detalle', 'matriz', 'resumen'];
const TIPOS_CONCEPTO = ['', 'ambas', 'percepcion', 'deduccion', 'otro_pago'];
const AGRUPAR = ['departamento', 'concepto', 'departamento_concepto'];

/** Límites para no tumbar el proceso ni el navegador en subsidiarias grandes. */
const SABANOTA_MAX_EMPLEADOS_SIN_FILTRO = 80;
const SABANOTA_MAX_FILAS = 2500;
const SABANOTA_MAX_PERIODOS = 60;

/** Retenciones típicas de nómina (obrero). */
const CODIGOS_IMPUESTOS_RETENIDOS = [
  'ISR',
  'IMSS_OBRERO',
  'IMSS_RCV',
  'INFONAVIT',
  'FONACOT'
];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function empNombre(emp) {
  if (!emp) return '';
  const sat = String(emp.nombreSat || '').trim();
  if (sat) return sat;
  if (emp.nombre) return String(emp.nombre).trim();
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
}

function isVisibleConcepto(codigo) {
  const c = String(codigo || '').toUpperCase();
  if (!c || META_CONCEPTOS.has(c)) return false;
  if (c === 'IMSS_PATRONAL') return false;
  if (c.startsWith('ISR_')) return false;
  return true;
}

function isImpuestoRetenidoCodigo(codigo) {
  const c = String(codigo || '').toUpperCase();
  if (CODIGOS_IMPUESTOS_RETENIDOS.includes(c)) return true;
  if (c.includes('INFONAVIT') || c.includes('FONACOT')) return true;
  if (c === 'IMSS_OBRERO' || c === 'IMSS_RCV') return true;
  return false;
}

function parseConceptosQuery(raw) {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((x) => String(x || '').split(/[,;\s]+/))
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  if (raw == null || raw === '') return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function mesKeys() {
  return Array.from({ length: 12 }, (_, i) => String(i + 1));
}

function importeMes(porMes, mes) {
  const cell = porMes && (porMes[mes] || porMes[Number(mes)]);
  if (cell == null) return 0;
  if (typeof cell === 'number') return money(cell);
  return money(cell.importe);
}

function formatFechaCorta(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

function labelPeriodoCol(periodoSnap = {}, fallbackId = '') {
  const tipoNomina = String(periodoSnap.tipoNomina || '').trim();
  const tipoPeriodo = String(periodoSnap.tipoPeriodo || '').trim();
  const num = periodoSnap.numeroPeriodo != null ? `#${periodoSnap.numeroPeriodo}` : '';
  const ini = formatFechaCorta(periodoSnap.fechaInicio);
  const fin = formatFechaCorta(periodoSnap.fechaFin);
  const head =
    tipoNomina && tipoNomina !== 'ordinaria'
      ? `${tipoNomina}${tipoPeriodo ? `·${tipoPeriodo}` : ''}`
      : tipoPeriodo || tipoNomina || 'per';
  if (num && ini) return `${head} ${num} (${ini})`;
  if (num) return `${head} ${num}`;
  if (ini && fin) return `${head} ${ini}–${fin}`;
  if (ini) return `${head} ${ini}`;
  return head || String(fallbackId).slice(-6);
}

function tipoConceptoCoincide(tipoRaw, filtro) {
  const t = String(tipoRaw || '').toLowerCase();
  const f = String(filtro || '').toLowerCase();
  if (!f) return true; // Todos
  if (f === 'ambas') {
    if (!t) return true; // sin tipificar en catálogo/línea: no excluir
    return (
      t === 'percepcion' ||
      t.includes('perc') ||
      t === 'deduccion' ||
      t === 'deducción' ||
      t.includes('deduc')
    );
  }
  if (f === 'percepcion') return t === 'percepcion' || t.includes('perc');
  if (f === 'deduccion') return t === 'deduccion' || t === 'deducción' || t.includes('deduc');
  if (f === 'otro_pago') return t === 'otro_pago' || t.includes('otro');
  return t === f || t.includes(f.slice(0, 5));
}

function conceptoPasaFiltro(code, { codigosFiltro, tipoConcepto, soloImpuestos, metaByCodigo }, tipoLinea = '') {
  if (!code) return false;
  if (codigosFiltro && !codigosFiltro.has(code)) return false;
  if (!isVisibleConcepto(code) && !(soloImpuestos && isImpuestoRetenidoCodigo(code))) return false;
  if (soloImpuestos && !isImpuestoRetenidoCodigo(code) && !(codigosFiltro && codigosFiltro.has(code))) {
    return false;
  }
  if (tipoConcepto) {
    const tMeta = metaByCodigo.get(code)?.tipo || '';
    const t = tipoLinea || tMeta;
    if (!tipoConceptoCoincide(t, tipoConcepto)) return false;
  }
  return true;
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.empresa
 * @param {string|null} [opts.subsidiariaId]
 * @param {object} opts.filters
 */
async function generarReporteAcumulados({ tenantId, empresa, subsidiariaId = null, filters = {} }) {
  const anio = Number(filters.anio) || new Date().getFullYear();
  const vista = VISTAS.includes(filters.vista) ? filters.vista : 'sabanota';
  const agrupar = AGRUPAR.includes(filters.agrupar) ? filters.agrupar : 'departamento';
  const mostrarMeses = !!filters.mostrarMeses;
  const soloImpuestos = !!filters.impuestosRetenidos;
  const tipoConcepto = TIPOS_CONCEPTO.includes(filters.tipoConcepto)
    ? filters.tipoConcepto
    : 'ambas';
  const conceptosSel = parseConceptosQuery(filters.conceptos);

  if (!empresa?._id) {
    return emptyResult(anio, vista, 'Sin empresa');
  }

  const empIds = await resolveEmpleadoIds(tenantId, empresa._id, subsidiariaId, filters);
  if (empIds && !empIds.length) {
    return emptyResult(anio, vista, 'Sin empleados para los filtros');
  }

  const ConceptoNomina = await getConceptoNominaModel();
  const Catalog = await getConceptCatalogModel();
  const [conceptosEmpresa, catalogos] = await Promise.all([
    ConceptoNomina.find({ tenantId, empresaId: empresa._id, activo: { $ne: false } })
      .select('codigo nombre tipo claveSAT')
      .lean(),
    Catalog.find({}).select('codigo nombre tipo ordenDefault claveSAT sat').lean()
  ]);

  const metaByCodigo = new Map();
  for (const c of catalogos) {
    metaByCodigo.set(String(c.codigo).toUpperCase(), {
      nombre: c.nombre || c.codigo,
      tipo: String(c.tipo || '').toLowerCase(),
      orden: Number(c.ordenDefault) || 9999,
      claveSAT: c.claveSAT || c.sat?.clave || ''
    });
  }
  for (const c of conceptosEmpresa) {
    const code = String(c.codigo).toUpperCase();
    const prev = metaByCodigo.get(code) || {};
    metaByCodigo.set(code, {
      nombre: c.nombre || prev.nombre || code,
      tipo: String(c.tipo || prev.tipo || '').toLowerCase(),
      orden: prev.orden != null ? prev.orden : 9999,
      claveSAT: c.claveSAT || prev.claveSAT || ''
    });
  }

  let codigosFiltro = null;
  if (soloImpuestos) {
    codigosFiltro = new Set(CODIGOS_IMPUESTOS_RETENIDOS);
  }
  if (conceptosSel.length) {
    const set = new Set(conceptosSel);
    codigosFiltro = codigosFiltro
      ? new Set([...codigosFiltro].filter((c) => set.has(c)))
      : set;
  }
  if (tipoConcepto && tipoConcepto !== 'ambas') {
    const delTipo = [...metaByCodigo.entries()]
      .filter(([, m]) => tipoConceptoCoincide(m.tipo, tipoConcepto))
      .map(([code]) => code);
    const set = new Set(delTipo);
    if (soloImpuestos) {
      codigosFiltro = new Set(
        [...CODIGOS_IMPUESTOS_RETENIDOS].filter(
          (c) => set.has(c) || tipoConceptoCoincide(metaByCodigo.get(c)?.tipo, tipoConcepto)
        )
      );
    } else if (conceptosSel.length) {
      codigosFiltro = new Set([...codigosFiltro].filter((c) => set.has(c)));
    } else {
      codigosFiltro = set;
    }
  } else if (tipoConcepto === 'ambas') {
    const delTipo = [...metaByCodigo.entries()]
      .filter(([, m]) => tipoConceptoCoincide(m.tipo, 'ambas'))
      .map(([code]) => code);
    const set = new Set(delTipo);
    if (soloImpuestos) {
      // impuestos retenidos ya son deducciones
    } else if (conceptosSel.length) {
      codigosFiltro = new Set([...codigosFiltro].filter((c) => set.has(c)));
    } else if (!codigosFiltro) {
      codigosFiltro = set.size ? set : null;
      // si el catálogo no trae tipos, no restringir por código; filtrar en conceptoPasaFiltro
      if (codigosFiltro && codigosFiltro.size < 3) codigosFiltro = null;
    } else {
      codigosFiltro = new Set([...codigosFiltro].filter((c) => set.has(c) || set.size === 0));
    }
  }

  const filtroCtx = { codigosFiltro, tipoConcepto, soloImpuestos, metaByCodigo };

  if (vista === 'sabanota') {
    return buildSabanota({
      tenantId,
      empresaId: empresa._id,
      subsidiariaId,
      anio,
      filters,
      empIds,
      filtroCtx
    });
  }

  const Acum = await getNominaAcumuladoModel();
  const q = { tenantId, anio, empresaId: empresa._id };
  if (empIds) q.empleadoId = { $in: empIds };
  if (codigosFiltro && codigosFiltro.size) {
    q.conceptoCodigo = { $in: [...codigosFiltro] };
  }

  const docs = await Acum.find(q).lean();
  if (!docs.length) {
    return emptyResult(anio, vista, 'Sin acumulados para el año / filtros');
  }

  const empleadoIds = [...new Set(docs.map((d) => String(d.empleadoId)))];
  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ _id: { $in: empleadoIds } })
    .select(
      'numEmpleado firstName lastName nombreSat nombre departamentoId centroCostoId rfc estatus'
    )
    .lean();
  const empById = new Map(empleados.map((e) => [String(e._id), e]));

  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean))];
  const ccIds = [...new Set(empleados.map((e) => e.centroCostoId).filter(Boolean))];
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const [deptos, ccs] = await Promise.all([
    deptoIds.length ? Departamento.find({ _id: { $in: deptoIds } }).select('nombre').lean() : [],
    ccIds.length ? CentroCosto.find({ _id: { $in: ccIds } }).select('codigo nombre').lean() : []
  ]);
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const ccById = new Map(ccs.map((c) => [String(c._id), c]));

  const rowsBase = [];
  for (const d of docs) {
    const code = String(d.conceptoCodigo || '').toUpperCase();
    if (!conceptoPasaFiltro(code, filtroCtx)) continue;

    const emp = empById.get(String(d.empleadoId));
    if (!emp) continue;
    if (filters.empleadoId && String(emp._id) !== String(filters.empleadoId)) continue;
    if (filters.departamentoId && String(emp.departamentoId || '') !== String(filters.departamentoId)) {
      continue;
    }
    if (filters.centroCostoId && String(emp.centroCostoId || '') !== String(filters.centroCostoId)) {
      continue;
    }

    const meta = metaByCodigo.get(code) || { nombre: code, tipo: '', orden: 9999, claveSAT: '' };
    const depto = emp.departamentoId ? deptoById.get(String(emp.departamentoId)) : null;
    const cc = emp.centroCostoId ? ccById.get(String(emp.centroCostoId)) : null;
    const row = {
      empleadoId: emp._id,
      numEmpleado: emp.numEmpleado || '',
      nombre: empNombre(emp),
      departamentoId: emp.departamentoId || null,
      departamento: depto?.nombre || 'Sin departamento',
      centroCostoId: emp.centroCostoId || null,
      centroCosto: cc ? `${cc.codigo} ${cc.nombre}`.trim() : '',
      conceptoCodigo: code,
      conceptoNombre: meta.nombre,
      tipo: meta.tipo || '',
      claveSAT: meta.claveSAT || '',
      importeAnual: money(d.importeAnual),
      gravadoAnual: money(d.gravadoAnual),
      exentoAnual: money(d.exentoAnual),
      orden: meta.orden
    };
    if (mostrarMeses) {
      for (const m of mesKeys()) {
        row[`m${m}`] = importeMes(d.porMes, m);
      }
    }
    rowsBase.push(row);
  }

  if (!rowsBase.length) {
    return emptyResult(anio, vista, 'Sin filas visibles (¿solo meta/acumuladores?)');
  }

  if (vista === 'matriz') return buildMatriz(anio, rowsBase, metaByCodigo);
  if (vista === 'resumen') return buildResumen(anio, rowsBase, agrupar);
  return buildDetalle(anio, rowsBase, mostrarMeses);
}

/**
 * Sábanota: empleado×concepto + columnas por período del año + link al cálculo.
 * Fuente: histórico (cerrados/import) + recibos temporales de períodos abiertos del año.
 */
async function buildSabanota({
  tenantId,
  empresaId,
  subsidiariaId,
  anio,
  filters,
  empIds,
  filtroCtx
}) {
  const { metaByCodigo, codigosFiltro, tipoConcepto, soloImpuestos } = filtroCtx;
  const tieneFiltroEstrecho = !!(
    filters.empleadoId ||
    filters.departamentoId ||
    filters.centroCostoId
  );

  if (empIds && empIds.length > SABANOTA_MAX_EMPLEADOS_SIN_FILTRO && !tieneFiltroEstrecho) {
    return emptyResult(
      anio,
      'sabanota',
      `Hay ${empIds.length} empleados en el alcance. Para la sábanota elige un empleado, departamento o centro de costo (toda la subsidiaria son ~decenas de miles de recibos). Para totales globales usa vista Resumen o Detalle.`
    );
  }

  let empIdsQuery = empIds;
  let empleadosTruncados = 0;
  // Con depto/CC puede haber cientos de empleados; tope de seguridad
  if (empIds && empIds.length > 500 && !filters.empleadoId) {
    empIdsQuery = empIds.slice(0, 500);
    empleadosTruncados = empIds.length - empIdsQuery.length;
  }

  const Historico = await getNominaHistoricoReciboModel();
  const histQ = { tenantId, empresaId, anio };
  if (empIdsQuery) histQ.empleadoId = { $in: empIdsQuery };

  const historicos = await Historico.find(histQ)
    .select(
      '_id empleadoId periodoId reciboOrigenId origen periodo empleado conceptos.conceptoCodigo conceptos.importe conceptos.gravado conceptos.exento conceptos.tipo conceptos.claveSAT'
    )
    .lean();

  /** @type {Map<string,{ key:string, periodoId:string|null, label:string, fechaInicio:Date|null, tipoPeriodo:string, numeroPeriodo:number|null }>} */
  const periodosMap = new Map();
  /** rowKey emp|concepto -> row */
  const rowsMap = new Map();
  /** empId|periodoKey -> { url, histId } */
  const linkByEmpPeriodo = new Map();

  function ensurePeriodo(periodoId, snap = {}) {
    const pid = periodoId ? String(periodoId) : null;
    const key = pid
      ? `p:${pid}`
      : `x:${snap.tipoPeriodo || ''}|${snap.tipoNomina || ''}|${snap.numeroPeriodo ?? ''}|${
          snap.fechaInicio ? new Date(snap.fechaInicio).toISOString().slice(0, 10) : ''
        }`;
    if (!periodosMap.has(key)) {
      periodosMap.set(key, {
        key,
        periodoId: pid,
        label: labelPeriodoCol(snap, key),
        fechaInicio: snap.fechaInicio ? new Date(snap.fechaInicio) : null,
        tipoPeriodo: snap.tipoPeriodo || '',
        numeroPeriodo: snap.numeroPeriodo != null ? Number(snap.numeroPeriodo) : null
      });
    }
    return key;
  }

  function ensureRow(empId, code, empSnap = {}, empLive = null) {
    const rowKey = `${empId}|${code}`;
    if (rowsMap.has(rowKey)) return rowsMap.get(rowKey);
    const meta = metaByCodigo.get(code) || { nombre: code, tipo: '', orden: 9999, claveSAT: '' };
    const emp = empLive || {};
    const deptoNombre =
      empSnap.departamentoNombre ||
      emp.departamentoNombre ||
      '';
    const ccNombre = empSnap.centroCostoNombre
      ? `${empSnap.centroCostoCodigo || ''} ${empSnap.centroCostoNombre}`.trim()
      : emp.centroCosto || '';
    const row = {
      empleadoId: empId,
      numEmpleado: emp.numEmpleado || empSnap.numEmpleado || '',
      nombre: empNombre(emp) || empSnap.nombre || '',
      departamentoId: emp.departamentoId || empSnap.departamentoId || null,
      departamento: deptoNombre || 'Sin departamento',
      centroCostoId: emp.centroCostoId || empSnap.centroCostoId || null,
      centroCosto: ccNombre,
      conceptoCodigo: code,
      conceptoNombre: meta.nombre,
      tipo: meta.tipo || '',
      claveSAT: meta.claveSAT || '',
      importeAnual: 0,
      gravadoAnual: 0,
      exentoAnual: 0,
      orden: meta.orden,
      _periodKeys: new Set()
    };
    rowsMap.set(rowKey, row);
    return row;
  }

  // Empleados vivos para enriquecer nombre/depto
  const empIdSet = new Set(historicos.map((h) => String(h.empleadoId)));
  // Períodos abiertos del año (temporal) — omitir si el alcance es enorme
  const Periodo = await getPeriodoNominaModel();
  const periodosAbiertos =
    (empIdsQuery ? empIdsQuery.length : 0) <= 500
      ? await Periodo.find({
          tenantId,
          empresaId,
          anio,
          estatus: { $ne: 'cerrado' }
        })
          .select('_id tipoPeriodo tipoNomina numeroPeriodo anio fechaInicio fechaFin estatus')
          .lean()
      : [];

  let temporales = [];
  if (periodosAbiertos.length) {
    const Recibo = await getReciboNominaModel();
    const Aplicado = await getConceptoAplicadoModel();
    const periodoIdsAbiertos = periodosAbiertos.map((p) => p._id);
    const reciboQ = { tenantId, periodoId: { $in: periodoIdsAbiertos } };
    if (empIdsQuery) reciboQ.empleadoId = { $in: empIdsQuery };
    const recibos = await Recibo.find(reciboQ).select('_id empleadoId periodoId').lean();
    if (recibos.length) {
      const aplicados = await Aplicado.find({
        tenantId,
        reciboId: { $in: recibos.map((r) => r._id) }
      })
        .select('reciboId conceptoCodigo importe gravado exento tipo claveSAT')
        .lean();
      const byRecibo = new Map();
      for (const a of aplicados) {
        const k = String(a.reciboId);
        if (!byRecibo.has(k)) byRecibo.set(k, []);
        byRecibo.get(k).push(a);
      }
      const perById = new Map(periodosAbiertos.map((p) => [String(p._id), p]));
      temporales = recibos.map((r) => ({
        _id: r._id,
        empleadoId: r.empleadoId,
        periodoId: r.periodoId,
        origen: 'temporal',
        periodo: perById.get(String(r.periodoId)) || {},
        conceptos: byRecibo.get(String(r._id)) || []
      }));
      for (const r of recibos) empIdSet.add(String(r.empleadoId));
    }
  }

  const Empleado = await getEmpleadoModel();
  const empleados = empIdSet.size
    ? await Empleado.find({ _id: { $in: [...empIdSet] } })
        .select(
          'numEmpleado firstName lastName nombreSat nombre departamentoId centroCostoId'
        )
        .lean()
    : [];
  const empById = new Map(empleados.map((e) => [String(e._id), e]));

  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean))];
  const ccIds = [...new Set(empleados.map((e) => e.centroCostoId).filter(Boolean))];
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const [deptos, ccs] = await Promise.all([
    deptoIds.length ? Departamento.find({ _id: { $in: deptoIds } }).select('nombre').lean() : [],
    ccIds.length ? CentroCosto.find({ _id: { $in: ccIds } }).select('codigo nombre').lean() : []
  ]);
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const ccById = new Map(ccs.map((c) => [String(c._id), c]));

  for (const e of empleados) {
    const depto = e.departamentoId ? deptoById.get(String(e.departamentoId)) : null;
    const cc = e.centroCostoId ? ccById.get(String(e.centroCostoId)) : null;
    e.departamentoNombre = depto?.nombre || '';
    e.centroCosto = cc ? `${cc.codigo} ${cc.nombre}`.trim() : '';
  }

  function ingestPaquete(pkg) {
    const empId = String(pkg.empleadoId);
    const emp = empById.get(empId);
    if (filters.empleadoId && empId !== String(filters.empleadoId)) return;
    if (filters.departamentoId) {
      const dep = emp?.departamentoId || pkg.empleado?.departamentoId;
      if (String(dep || '') !== String(filters.departamentoId)) return;
    }
    if (filters.centroCostoId) {
      const cc = emp?.centroCostoId || pkg.empleado?.centroCostoId;
      if (String(cc || '') !== String(filters.centroCostoId)) return;
    }

    const pKey = ensurePeriodo(pkg.periodoId, pkg.periodo || {});
    const colKey = `per_${pKey}`;
    const reciboId = pkg._id;
    const periodoId = pkg.periodoId ? String(pkg.periodoId) : null;
    if (periodoId && reciboId) {
      linkByEmpPeriodo.set(`${empId}|${pKey}`, {
        url: `/nomina/periodos/${periodoId}/recibos/${reciboId}`,
        periodoId,
        reciboId: String(reciboId)
      });
    }

    for (const c of pkg.conceptos || []) {
      const code = String(c.conceptoCodigo || '').toUpperCase();
      if (!conceptoPasaFiltro(code, filtroCtx, c.tipo)) continue;
      const importe = money(c.importe);
      if (importe === 0 && money(c.gravado) === 0 && money(c.exento) === 0) continue;

      const row = ensureRow(empId, code, pkg.empleado || {}, emp);
      if (!row.departamento || row.departamento === 'Sin departamento') {
        row.departamento = emp?.departamentoNombre || pkg.empleado?.departamentoNombre || row.departamento;
      }
      if (!row.centroCosto) {
        row.centroCosto =
          emp?.centroCosto ||
          (pkg.empleado?.centroCostoNombre
            ? `${pkg.empleado.centroCostoCodigo || ''} ${pkg.empleado.centroCostoNombre}`.trim()
            : '');
      }
      if (!row.nombre) row.nombre = empNombre(emp) || pkg.empleado?.nombre || '';
      if (!row.numEmpleado) row.numEmpleado = emp?.numEmpleado || pkg.empleado?.numEmpleado || '';

      row[colKey] = money((row[colKey] || 0) + importe);
      row.importeAnual = money(row.importeAnual + importe);
      row.gravadoAnual = money(row.gravadoAnual + money(c.gravado));
      row.exentoAnual = money(row.exentoAnual + money(c.exento));
      row._periodKeys.add(pKey);
      // URL por celda (mismo recibo del período)
      const link = linkByEmpPeriodo.get(`${empId}|${pKey}`);
      if (link) row[`${colKey}_url`] = link.url;
    }
  }

  for (const h of historicos) ingestPaquete(h);
  for (const t of temporales) ingestPaquete(t);

  if (!rowsMap.size) {
    return emptyResult(anio, 'sabanota', 'Sin recibos/histórico para el año / filtros');
  }

  let periodosOrden = [...periodosMap.values()].sort((a, b) => {
    const ta = a.fechaInicio ? a.fechaInicio.getTime() : 0;
    const tb = b.fechaInicio ? b.fechaInicio.getTime() : 0;
    if (ta !== tb) return ta - tb;
    const na = a.numeroPeriodo != null ? a.numeroPeriodo : 0;
    const nb = b.numeroPeriodo != null ? b.numeroPeriodo : 0;
    if (na !== nb) return na - nb;
    return a.label.localeCompare(b.label, 'es');
  });
  let periodosTruncados = 0;
  if (periodosOrden.length > SABANOTA_MAX_PERIODOS) {
    periodosTruncados = periodosOrden.length - SABANOTA_MAX_PERIODOS;
    periodosOrden = periodosOrden.slice(-SABANOTA_MAX_PERIODOS);
  }

  const columns = [
    { key: 'numEmpleado', label: 'Empleado', type: 'text', sticky: true },
    { key: 'nombre', label: 'Nombre', type: 'text', sticky: true },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'centroCosto', label: 'Centro de costo', type: 'text' },
    { key: 'tipo', label: 'Tipo', type: 'text' },
    { key: 'conceptoCodigo', label: 'Código', type: 'text' },
    { key: 'conceptoNombre', label: 'Concepto', type: 'text' },
    { key: 'claveSAT', label: 'SAT', type: 'text' },
    { key: 'importeAnual', label: 'Importe anual', type: 'money' },
    { key: 'gravadoAnual', label: 'Gravado', type: 'money' },
    { key: 'exentoAnual', label: 'Exento', type: 'money' },
    ...periodosOrden.map((p) => ({
      key: `per_${p.key}`,
      label: p.label,
      type: 'money_link',
      urlKey: `per_${p.key}_url`,
      periodoId: p.periodoId,
      periodoLabel: p.label
    }))
  ];

  let sorted = [...rowsMap.values()]
    .map((r) => {
      const { _periodKeys, ...rest } = r;
      return rest;
    })
    .sort(sortDetalle);

  let filasTruncadas = 0;
  if (sorted.length > SABANOTA_MAX_FILAS) {
    filasTruncadas = sorted.length - SABANOTA_MAX_FILAS;
    sorted = sorted.slice(0, SABANOTA_MAX_FILAS);
  }

  const moneyKeys = [
    'importeAnual',
    'gravadoAnual',
    'exentoAnual',
    ...periodosOrden.map((p) => `per_${p.key}`)
  ];
  const totals = sumKeys(sorted, moneyKeys);
  const impuestos = sumImpuestos(sorted);

  const avisos = [];
  if (empleadosTruncados) {
    avisos.push(
      `Solo se incluyeron los primeros 500 empleados de ${empleadosTruncados + 500} (afina el filtro).`
    );
  }
  if (periodosTruncados) {
    avisos.push(
      `Se muestran los últimos ${SABANOTA_MAX_PERIODOS} períodos (${periodosTruncados} omitidos).`
    );
  }
  if (filasTruncadas) {
    avisos.push(`Tabla limitada a ${SABANOTA_MAX_FILAS} filas (${filasTruncadas} omitidas).`);
  }

  return {
    anio,
    fuente: 'historico+temporal',
    vista: 'sabanota',
    columns,
    rows: sorted,
    periodos: periodosOrden.map((p) => ({
      key: p.key,
      label: p.label,
      periodoId: p.periodoId
    })),
    summary: {
      anio,
      empleados: new Set(sorted.map((r) => String(r.empleadoId))).size,
      conceptos: new Set(sorted.map((r) => r.conceptoCodigo)).size,
      periodos: periodosOrden.length,
      filas: sorted.length,
      aviso: avisos.join(' '),
      ...totals,
      ...impuestos
    }
  };
}

async function resolveEmpleadoIds(tenantId, empresaId, subsidiariaId, filters) {
  const Empleado = await getEmpleadoModel();
  const q = { tenantId, empresaId };
  if (subsidiariaId) q.subsidiariaId = subsidiariaId;
  if (filters.empleadoId) q._id = filters.empleadoId;
  if (filters.departamentoId) q.departamentoId = filters.departamentoId;
  if (filters.centroCostoId) q.centroCostoId = filters.centroCostoId;

  const needsList =
    !!subsidiariaId ||
    !!filters.empleadoId ||
    !!filters.departamentoId ||
    !!filters.centroCostoId;

  if (!needsList) return null;
  const ids = await Empleado.find(q).select('_id').lean();
  return ids.map((e) => e._id);
}

function emptyResult(anio, vista, mensaje) {
  return {
    anio,
    fuente: 'acumulados',
    vista,
    columns: [],
    rows: [],
    summary: { mensaje, anio, empleados: 0, conceptos: 0, importeAnual: 0 }
  };
}

function sortDetalle(a, b) {
  const d = String(a.departamento || '').localeCompare(String(b.departamento || ''), 'es');
  if (d) return d;
  const n = String(a.numEmpleado || '').localeCompare(String(b.numEmpleado || ''), 'es', {
    numeric: true
  });
  if (n) return n;
  if (a.orden !== b.orden) return a.orden - b.orden;
  return String(a.conceptoCodigo).localeCompare(String(b.conceptoCodigo));
}

function buildDetalle(anio, rows, mostrarMeses) {
  const sorted = [...rows].sort(sortDetalle);
  const columns = [
    { key: 'numEmpleado', label: 'Empleado', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'centroCosto', label: 'Centro de costo', type: 'text' },
    { key: 'tipo', label: 'Tipo', type: 'text' },
    { key: 'conceptoCodigo', label: 'Código', type: 'text' },
    { key: 'conceptoNombre', label: 'Concepto', type: 'text' },
    { key: 'claveSAT', label: 'SAT', type: 'text' },
    { key: 'importeAnual', label: 'Importe anual', type: 'money' },
    { key: 'gravadoAnual', label: 'Gravado', type: 'money' },
    { key: 'exentoAnual', label: 'Exento', type: 'money' }
  ];
  if (mostrarMeses) {
    const labels = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic'
    ];
    labels.forEach((lab, i) => {
      columns.push({ key: `m${i + 1}`, label: lab, type: 'money' });
    });
  }

  const moneyKeys = [
    'importeAnual',
    'gravadoAnual',
    'exentoAnual',
    ...(mostrarMeses ? mesKeys().map((m) => `m${m}`) : [])
  ];
  const totals = sumKeys(sorted, moneyKeys);
  const impuestos = sumImpuestos(sorted);

  return {
    anio,
    fuente: 'acumulados',
    vista: 'detalle',
    columns,
    rows: sorted,
    summary: {
      anio,
      empleados: new Set(sorted.map((r) => String(r.empleadoId))).size,
      conceptos: new Set(sorted.map((r) => r.conceptoCodigo)).size,
      filas: sorted.length,
      ...totals,
      ...impuestos
    }
  };
}

function buildMatriz(anio, rows, metaByCodigo) {
  const sumByCode = new Map();
  for (const r of rows) {
    sumByCode.set(r.conceptoCodigo, money((sumByCode.get(r.conceptoCodigo) || 0) + r.importeAnual));
  }
  const codigos = [...sumByCode.keys()]
    .filter((c) => money(sumByCode.get(c)) !== 0)
    .sort((a, b) => {
      const oa = metaByCodigo.get(a)?.orden ?? 9999;
      const ob = metaByCodigo.get(b)?.orden ?? 9999;
      const ta = String(metaByCodigo.get(a)?.tipo || '').includes('deduc') ? 1 : 0;
      const tb = String(metaByCodigo.get(b)?.tipo || '').includes('deduc') ? 1 : 0;
      if (ta !== tb) return ta - tb;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });

  const byEmp = new Map();
  for (const r of rows) {
    const k = String(r.empleadoId);
    if (!byEmp.has(k)) {
      byEmp.set(k, {
        empleadoId: r.empleadoId,
        numEmpleado: r.numEmpleado,
        nombre: r.nombre,
        departamento: r.departamento,
        centroCosto: r.centroCosto,
        importeAnual: 0
      });
    }
    const row = byEmp.get(k);
    row[`c_${r.conceptoCodigo}`] = money((row[`c_${r.conceptoCodigo}`] || 0) + r.importeAnual);
    // Para matriz, sumar percepciones positivo y deducciones como valor (sin restar neto)
    row.importeAnual = money(row.importeAnual + r.importeAnual);
  }

  const outRows = [...byEmp.values()].sort((a, b) => {
    const d = String(a.departamento || '').localeCompare(String(b.departamento || ''), 'es');
    if (d) return d;
    return String(a.numEmpleado || '').localeCompare(String(b.numEmpleado || ''), 'es', {
      numeric: true
    });
  });

  const columns = [
    { key: 'numEmpleado', label: 'Empleado', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'centroCosto', label: 'Centro de costo', type: 'text' },
    ...codigos.map((code) => ({
      key: `c_${code}`,
      label: metaByCodigo.get(code)?.nombre || code,
      type: 'money',
      conceptoCodigo: code
    }))
  ];

  const moneyKeys = codigos.map((c) => `c_${c}`);
  const totals = sumKeys(outRows, moneyKeys);
  const flatForImp = rows;
  const impuestos = sumImpuestos(flatForImp);

  return {
    anio,
    fuente: 'acumulados',
    vista: 'matriz',
    columns,
    rows: outRows,
    summary: {
      anio,
      empleados: outRows.length,
      conceptos: codigos.length,
      ...totals,
      ...impuestos
    }
  };
}

function buildResumen(anio, rows, agrupar) {
  const groups = new Map();
  for (const r of rows) {
    let key;
    let label;
    if (agrupar === 'concepto') {
      key = r.conceptoCodigo;
      label = `${r.conceptoCodigo} — ${r.conceptoNombre}`;
    } else if (agrupar === 'departamento_concepto') {
      key = `${r.departamentoId || 'sin'}|${r.conceptoCodigo}`;
      label = `${r.departamento} · ${r.conceptoCodigo}`;
    } else {
      key = String(r.departamentoId || 'sin');
      label = r.departamento || 'Sin departamento';
    }
    if (!groups.has(key)) {
      groups.set(key, {
        grupo: label,
        tipo: agrupar === 'departamento' ? '' : r.tipo,
        conceptoCodigo: agrupar === 'departamento' ? '' : r.conceptoCodigo,
        empleados: new Set(),
        importeAnual: 0,
        gravadoAnual: 0,
        exentoAnual: 0
      });
    }
    const g = groups.get(key);
    g.empleados.add(String(r.empleadoId));
    g.importeAnual = money(g.importeAnual + r.importeAnual);
    g.gravadoAnual = money(g.gravadoAnual + r.gravadoAnual);
    g.exentoAnual = money(g.exentoAnual + r.exentoAnual);
  }

  const outRows = [...groups.values()]
    .map((g) => ({
      grupo: g.grupo,
      tipo: g.tipo,
      conceptoCodigo: g.conceptoCodigo,
      empleados: g.empleados.size,
      importeAnual: g.importeAnual,
      gravadoAnual: g.gravadoAnual,
      exentoAnual: g.exentoAnual
    }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo, 'es'));

  const columns = [
    {
      key: 'grupo',
      label:
        agrupar === 'concepto'
          ? 'Concepto'
          : agrupar === 'departamento_concepto'
            ? 'Depto · Concepto'
            : 'Departamento',
      type: 'text'
    },
    { key: 'empleados', label: 'Empleados', type: 'number' },
    { key: 'importeAnual', label: 'Importe anual', type: 'money' },
    { key: 'gravadoAnual', label: 'Gravado', type: 'money' },
    { key: 'exentoAnual', label: 'Exento', type: 'money' }
  ];

  const totals = sumKeys(outRows, ['empleados', 'importeAnual', 'gravadoAnual', 'exentoAnual']);
  const impuestos = sumImpuestos(rows);

  return {
    anio,
    fuente: 'acumulados',
    vista: 'resumen',
    columns,
    rows: outRows,
    summary: {
      anio,
      grupos: outRows.length,
      agrupar,
      ...totals,
      ...impuestos
    }
  };
}

function sumKeys(rows, keys) {
  const out = {};
  for (const k of keys) out[k] = 0;
  for (const r of rows) {
    for (const k of keys) out[k] = money(out[k] + (Number(r[k]) || 0));
  }
  return out;
}

function sumImpuestos(rows) {
  const out = {
    isr: 0,
    imss: 0,
    infonavit: 0,
    fonacot: 0,
    impuestosRetenidos: 0
  };
  for (const r of rows) {
    const c = String(r.conceptoCodigo || '').toUpperCase();
    const imp = money(r.importeAnual);
    if (c === 'ISR') out.isr = money(out.isr + imp);
    if (c === 'IMSS_OBRERO' || c === 'IMSS_RCV' || (c.includes('IMSS') && !c.includes('PATRONAL'))) {
      out.imss = money(out.imss + imp);
    }
    if (c.includes('INFONAVIT')) out.infonavit = money(out.infonavit + imp);
    if (c.includes('FONACOT')) out.fonacot = money(out.fonacot + imp);
  }
  out.impuestosRetenidos = money(out.isr + out.imss + out.infonavit + out.fonacot);
  return out;
}

async function listConceptosParaFiltro(tenantId, empresaId) {
  const ConceptoNomina = await getConceptoNominaModel();
  const rows = await ConceptoNomina.find({
    tenantId,
    empresaId,
    activo: { $ne: false },
    codigo: { $nin: [...META_CONCEPTOS, 'IMSS_PATRONAL'] }
  })
    .select('codigo nombre tipo')
    .sort({ tipo: 1, codigo: 1 })
    .lean();
  return rows.filter((r) => isVisibleConcepto(r.codigo));
}

function toCsv(result) {
  const cols = result.columns || [];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.map((c) => escape(c.label)).join(',')];
  for (const row of result.rows || []) {
    lines.push(
      cols
        .map((c) => {
          const v = row[c.key];
          if (c.type === 'money' || c.type === 'money_link') {
            return escape(Number(v || 0).toFixed(2));
          }
          if (c.type === 'link') return escape(v || '');
          return escape(v);
        })
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

module.exports = {
  generarReporteAcumulados,
  listConceptosParaFiltro,
  toCsv,
  VISTAS,
  TIPOS_CONCEPTO,
  AGRUPAR,
  CODIGOS_IMPUESTOS_RETENIDOS
};
