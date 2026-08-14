'use strict';

/**
 * Reportes de nómina: totales por empleado, detalle (conceptos en columnas) y resumen.
 * Fuente dual: temporal (abierto/calculando/calculado) vs histórico (cerrado).
 */

const getPeriodoNominaModel = require('../models/periodoNomina');
const getReciboNominaModel = require('../models/reciboNomina');
const getConceptoAplicadoModel = require('../models/conceptoAplicado');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getCentroCostoModel = require('../models/centroCosto');
const getConceptCatalogModel = require('../models/conceptCatalog');

const META_CONCEPTOS = new Set([
  'PERCEPCIONES_GRAVADAS',
  'PERCEPCIONES_EXENTAS',
  'BASE_ISR',
  'BASE_IMSS',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR'
]);

const VISTAS = ['totales', 'detalle', 'resumen'];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isImssCodigo(codigo) {
  const c = String(codigo || '').toUpperCase();
  return c === 'IMSS_OBRERO' || (c.includes('IMSS') && !c.includes('PATRONAL'));
}

function isIsrCodigo(codigo) {
  const c = String(codigo || '').toUpperCase();
  return c === 'ISR' || c.startsWith('ISR_');
}

function isVisibleConcepto(codigo) {
  const c = String(codigo || '').toUpperCase();
  if (!c || META_CONCEPTOS.has(c)) return false;
  if (c === 'IMSS_PATRONAL') return false;
  return true;
}

function empNombre(emp) {
  if (!emp) return '';
  if (emp.nombre) return emp.nombre;
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
}

/**
 * @returns {Promise<{ periodo, fuente: 'temporal'|'historico'|'vacio', rows: object[], columns?: object[], summary: object }>}
 */
async function generarReporteNomina(tenantId, empresaId, filters = {}) {
  const vista = VISTAS.includes(filters.vista) ? filters.vista : 'totales';
  const Periodo = await getPeriodoNominaModel();
  const periodoId = filters.periodoId;
  if (!periodoId) {
    return {
      periodo: null,
      fuente: 'vacio',
      vista,
      rows: [],
      columns: [],
      summary: { mensaje: 'Selecciona un período' }
    };
  }

  const periodoQ = { _id: periodoId, tenantId };
  if (empresaId) periodoQ.empresaId = empresaId;
  const periodo = await Periodo.findOne(periodoQ).lean();
  if (!periodo) {
    return {
      periodo: null,
      fuente: 'vacio',
      vista,
      rows: [],
      columns: [],
      summary: { mensaje: 'Período no encontrado' }
    };
  }

  const cerrado = periodo.estatus === 'cerrado';
  const paquetes = cerrado
    ? await loadHistorico(tenantId, periodo, filters)
    : await loadTemporal(tenantId, periodo, filters);

  const Catalog = await getConceptCatalogModel();
  const catalogos = await Catalog.find({
    codigo: { $in: [...new Set(paquetes.flatMap((p) => p.conceptos.map((c) => c.conceptoCodigo)))] }
  })
    .select('codigo nombre tipo ordenDefault')
    .lean();
  const catByCodigo = new Map(catalogos.map((c) => [String(c.codigo).toUpperCase(), c]));

  const enriched = paquetes.map((p) => enrichTotales(p, catByCodigo));

  if (vista === 'resumen') {
    return buildResumen(periodo, cerrado ? 'historico' : 'temporal', enriched, filters.agrupar || 'departamento');
  }
  if (vista === 'detalle') {
    return buildDetalle(periodo, cerrado ? 'historico' : 'temporal', enriched, catByCodigo);
  }
  return buildTotales(periodo, cerrado ? 'historico' : 'temporal', enriched);
}

async function resolveEmpleadoIdsFiltro(tenantId, filters) {
  const Empleado = await getEmpleadoModel();
  const q = { tenantId };
  if (filters.departamentoId) q.departamentoId = filters.departamentoId;
  if (filters.centroCostoId) q.centroCostoId = filters.centroCostoId;
  if (!filters.departamentoId && !filters.centroCostoId) return null;
  const ids = await Empleado.find(q).select('_id').lean();
  return ids.map((e) => e._id);
}

async function loadTemporal(tenantId, periodo, filters) {
  const Recibo = await getReciboNominaModel();
  const ConceptoAplicado = await getConceptoAplicadoModel();
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();

  const reciboQ = { tenantId, periodoId: periodo._id };
  const empFilterIds = await resolveEmpleadoIdsFiltro(tenantId, filters);
  if (empFilterIds) {
    if (!empFilterIds.length) return [];
    reciboQ.empleadoId = { $in: empFilterIds };
  }

  const recibos = await Recibo.find(reciboQ).lean();
  if (!recibos.length) return [];

  const reciboIds = recibos.map((r) => r._id);
  const empleadoIds = [...new Set(recibos.map((r) => String(r.empleadoId)))];
  const [aplicados, empleados] = await Promise.all([
    ConceptoAplicado.find({ tenantId, reciboId: { $in: reciboIds } }).lean(),
    Empleado.find({ _id: { $in: empleadoIds } })
      .select('numEmpleado firstName lastName departamentoId centroCostoId')
      .lean()
  ]);

  const empById = new Map(empleados.map((e) => [String(e._id), e]));
  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean))];
  const ccIds = [...new Set(empleados.map((e) => e.centroCostoId).filter(Boolean))];
  const [deptos, ccs] = await Promise.all([
    deptoIds.length ? Departamento.find({ _id: { $in: deptoIds } }).select('nombre').lean() : [],
    ccIds.length ? CentroCosto.find({ _id: { $in: ccIds } }).select('codigo nombre').lean() : []
  ]);
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const ccById = new Map(ccs.map((c) => [String(c._id), c]));

  const conceptosByRecibo = new Map();
  for (const a of aplicados) {
    const key = String(a.reciboId);
    if (!conceptosByRecibo.has(key)) conceptosByRecibo.set(key, []);
    conceptosByRecibo.get(key).push(a);
  }

  return recibos.map((r) => {
    const emp = empById.get(String(r.empleadoId)) || {};
    const depto = emp.departamentoId ? deptoById.get(String(emp.departamentoId)) : null;
    const cc = emp.centroCostoId ? ccById.get(String(emp.centroCostoId)) : null;
    return {
      reciboId: r._id,
      empleadoId: r.empleadoId,
      numEmpleado: emp.numEmpleado || '',
      nombre: empNombre(emp),
      departamentoId: emp.departamentoId || null,
      departamento: depto?.nombre || '',
      centroCostoId: emp.centroCostoId || null,
      centroCosto: cc ? `${cc.codigo} ${cc.nombre}`.trim() : '',
      totalPercepciones: money(r.totalPercepciones),
      totalDeducciones: money(r.totalDeducciones),
      netoPagar: money(r.netoPagar),
      basesFiscales: r.basesFiscales || {},
      conceptos: conceptosByRecibo.get(String(r._id)) || []
    };
  });
}

async function loadHistorico(tenantId, periodo, filters) {
  const Historico = await getNominaHistoricoReciboModel();
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();

  const q = { tenantId, periodoId: periodo._id, origen: 'cierre' };
  const hist = await Historico.find(q).lean();
  if (!hist.length) return [];

  const empleadoIds = [...new Set(hist.map((h) => String(h.empleadoId)))];
  const empleados = await Empleado.find({ _id: { $in: empleadoIds } })
    .select('numEmpleado firstName lastName departamentoId centroCostoId')
    .lean();
  const empById = new Map(empleados.map((e) => [String(e._id), e]));

  const deptoIds = new Set();
  const ccIds = new Set();
  for (const h of hist) {
    const snap = h.empleado || {};
    const emp = empById.get(String(h.empleadoId)) || {};
    const dId = snap.departamentoId || emp.departamentoId;
    const cId = snap.centroCostoId || emp.centroCostoId;
    if (dId) deptoIds.add(String(dId));
    if (cId) ccIds.add(String(cId));
  }
  const [deptos, ccs] = await Promise.all([
    deptoIds.size ? Departamento.find({ _id: { $in: [...deptoIds] } }).select('nombre').lean() : [],
    ccIds.size ? CentroCosto.find({ _id: { $in: [...ccIds] } }).select('codigo nombre').lean() : []
  ]);
  const deptoById = new Map(deptos.map((d) => [String(d._id), d]));
  const ccById = new Map(ccs.map((c) => [String(c._id), c]));

  const depFilter = filters.departamentoId ? String(filters.departamentoId) : '';
  const ccFilter = filters.centroCostoId ? String(filters.centroCostoId) : '';

  const out = [];
  for (const h of hist) {
    const snap = h.empleado || {};
    const emp = empById.get(String(h.empleadoId)) || {};
    const departamentoId = snap.departamentoId || emp.departamentoId || null;
    const centroCostoId = snap.centroCostoId || emp.centroCostoId || null;
    if (depFilter && String(departamentoId || '') !== depFilter) continue;
    if (ccFilter && String(centroCostoId || '') !== ccFilter) continue;

    const deptoNombre =
      snap.departamentoNombre ||
      (departamentoId ? deptoById.get(String(departamentoId))?.nombre || '' : '');
    const ccDoc = centroCostoId ? ccById.get(String(centroCostoId)) : null;
    const centroCosto =
      [snap.centroCostoCodigo || ccDoc?.codigo, snap.centroCostoNombre || ccDoc?.nombre]
        .filter(Boolean)
        .join(' ') || '';

    out.push({
      reciboId: h._id,
      empleadoId: h.empleadoId,
      numEmpleado: snap.numEmpleado || emp.numEmpleado || '',
      nombre: snap.nombre || empNombre(emp),
      departamentoId,
      departamento: deptoNombre,
      centroCostoId,
      centroCosto,
      totalPercepciones: money(h.totalPercepciones),
      totalDeducciones: money(h.totalDeducciones),
      netoPagar: money(h.netoPagar),
      basesFiscales: h.basesFiscales || {},
      conceptos: h.conceptos || []
    });
  }
  return out;
}

function enrichTotales(p, catByCodigo) {
  let gravado = 0;
  let exento = 0;
  let imss = 0;
  let isr = 0;
  let otrosDescuentos = 0;

  for (const c of p.conceptos || []) {
    const codigo = String(c.conceptoCodigo || '').toUpperCase();
    const importe = money(c.importe);
    gravado += money(c.gravado);
    exento += money(c.exento);

    const tipo = String(c.tipo || catByCodigo.get(codigo)?.tipo || '').toLowerCase();
    if (tipo === 'deduccion' || tipo === 'deducción') {
      if (isImssCodigo(codigo)) imss += importe;
      else if (isIsrCodigo(codigo)) isr += importe;
      else if (isVisibleConcepto(codigo)) otrosDescuentos += importe;
    }
  }

  if (!gravado && p.basesFiscales?.PERCEPCIONES_GRAVADAS != null) {
    gravado = money(p.basesFiscales.PERCEPCIONES_GRAVADAS);
  }
  if (!exento && p.basesFiscales?.PERCEPCIONES_EXENTAS != null) {
    exento = money(p.basesFiscales.PERCEPCIONES_EXENTAS);
  }

  // Si no clasificamos bien, deriva otros = deducciones − imss − isr
  if (otrosDescuentos === 0 && p.totalDeducciones) {
    const resto = money(p.totalDeducciones - imss - isr);
    if (resto > 0) otrosDescuentos = resto;
  }

  return {
    ...p,
    gravado: money(gravado),
    exento: money(exento),
    imss: money(imss),
    isr: money(isr),
    otrosDescuentos: money(otrosDescuentos)
  };
}

function sortEmpleados(rows) {
  return [...rows].sort((a, b) =>
    String(a.numEmpleado).localeCompare(String(b.numEmpleado), 'es', { numeric: true })
  );
}

function sumRows(rows, fields) {
  const out = {};
  for (const f of fields) out[f] = 0;
  for (const r of rows) {
    for (const f of fields) out[f] = money(out[f] + (Number(r[f]) || 0));
  }
  return out;
}

function buildTotales(periodo, fuente, rows) {
  const sorted = sortEmpleados(rows);
  const columns = [
    { key: 'numEmpleado', label: 'Empleado', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'centroCosto', label: 'Centro de costo', type: 'text' },
    { key: 'totalPercepciones', label: 'Percepciones', type: 'money' },
    { key: 'totalDeducciones', label: 'Deducciones', type: 'money' },
    { key: 'gravado', label: 'Gravado', type: 'money' },
    { key: 'exento', label: 'Exento', type: 'money' },
    { key: 'imss', label: 'IMSS', type: 'money' },
    { key: 'otrosDescuentos', label: 'Otros descuentos', type: 'money' },
    { key: 'netoPagar', label: 'Neto', type: 'money' }
  ];
  const totals = sumRows(sorted, [
    'totalPercepciones',
    'totalDeducciones',
    'gravado',
    'exento',
    'imss',
    'otrosDescuentos',
    'netoPagar'
  ]);
  return {
    periodo,
    fuente,
    vista: 'totales',
    columns,
    rows: sorted.map((r) => ({
      numEmpleado: r.numEmpleado,
      nombre: r.nombre,
      departamento: r.departamento,
      centroCosto: r.centroCosto,
      totalPercepciones: r.totalPercepciones,
      totalDeducciones: r.totalDeducciones,
      gravado: r.gravado,
      exento: r.exento,
      imss: r.imss,
      otrosDescuentos: r.otrosDescuentos,
      netoPagar: r.netoPagar
    })),
    summary: {
      empleados: sorted.length,
      ...totals,
      estatusPeriodo: periodo.estatus
    }
  };
}

function buildDetalle(periodo, fuente, rows, catByCodigo) {
  const sorted = sortEmpleados(rows);
  const codigoSet = new Set();
  for (const r of sorted) {
    for (const c of r.conceptos || []) {
      const code = String(c.conceptoCodigo || '').toUpperCase();
      if (isVisibleConcepto(code) && money(c.importe) !== 0) codigoSet.add(code);
    }
  }

  const codigos = [...codigoSet].sort((a, b) => {
    const ca = catByCodigo.get(a);
    const cb = catByCodigo.get(b);
    const ta = String(ca?.tipo || '').toLowerCase() === 'deduccion' || String(ca?.tipo || '').toLowerCase() === 'deducción' ? 1 : 0;
    const tb = String(cb?.tipo || '').toLowerCase() === 'deduccion' || String(cb?.tipo || '').toLowerCase() === 'deducción' ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const oa = Number(ca?.ordenDefault) || 9999;
    const ob = Number(cb?.ordenDefault) || 9999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });

  const columns = [
    { key: 'numEmpleado', label: 'Empleado', type: 'text' },
    { key: 'nombre', label: 'Nombre', type: 'text' },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'centroCosto', label: 'Centro de costo', type: 'text' },
    ...codigos.map((code) => ({
      key: `c_${code}`,
      label: catByCodigo.get(code)?.nombre || code,
      type: 'money',
      conceptoCodigo: code
    })),
    { key: 'netoPagar', label: 'Neto', type: 'money' }
  ];

  const outRows = sorted.map((r) => {
    const byCode = new Map();
    for (const c of r.conceptos || []) {
      const code = String(c.conceptoCodigo || '').toUpperCase();
      byCode.set(code, money((byCode.get(code) || 0) + money(c.importe)));
    }
    const row = {
      numEmpleado: r.numEmpleado,
      nombre: r.nombre,
      departamento: r.departamento,
      centroCosto: r.centroCosto,
      netoPagar: r.netoPagar
    };
    for (const code of codigos) {
      row[`c_${code}`] = byCode.get(code) || 0;
    }
    return row;
  });

  const moneyKeys = [...codigos.map((c) => `c_${c}`), 'netoPagar'];
  const totals = sumRows(outRows, moneyKeys);

  return {
    periodo,
    fuente,
    vista: 'detalle',
    columns,
    rows: outRows,
    summary: {
      empleados: outRows.length,
      conceptos: codigos.length,
      ...totals,
      estatusPeriodo: periodo.estatus
    }
  };
}

function buildResumen(periodo, fuente, rows, agrupar) {
  const mode = ['departamento', 'centroCosto', 'ambos'].includes(agrupar) ? agrupar : 'departamento';

  const groups = new Map();
  for (const r of rows) {
    let key;
    let label;
    if (mode === 'centroCosto') {
      key = String(r.centroCostoId || 'sin');
      label = r.centroCosto || 'Sin centro de costo';
    } else if (mode === 'ambos') {
      key = `${r.departamentoId || 'sin'}|${r.centroCostoId || 'sin'}`;
      label = `${r.departamento || 'Sin depto'} / ${r.centroCosto || 'Sin CC'}`;
    } else {
      key = String(r.departamentoId || 'sin');
      label = r.departamento || 'Sin departamento';
    }
    if (!groups.has(key)) {
      groups.set(key, {
        grupo: label,
        empleados: 0,
        totalPercepciones: 0,
        totalDeducciones: 0,
        gravado: 0,
        exento: 0,
        imss: 0,
        otrosDescuentos: 0,
        netoPagar: 0
      });
    }
    const g = groups.get(key);
    g.empleados += 1;
    g.totalPercepciones = money(g.totalPercepciones + r.totalPercepciones);
    g.totalDeducciones = money(g.totalDeducciones + r.totalDeducciones);
    g.gravado = money(g.gravado + r.gravado);
    g.exento = money(g.exento + r.exento);
    g.imss = money(g.imss + r.imss);
    g.otrosDescuentos = money(g.otrosDescuentos + r.otrosDescuentos);
    g.netoPagar = money(g.netoPagar + r.netoPagar);
  }

  const outRows = [...groups.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'es'));
  const columns = [
    { key: 'grupo', label: mode === 'ambos' ? 'Depto / Centro costo' : mode === 'centroCosto' ? 'Centro de costo' : 'Departamento', type: 'text' },
    { key: 'empleados', label: 'Empleados', type: 'number' },
    { key: 'totalPercepciones', label: 'Percepciones', type: 'money' },
    { key: 'totalDeducciones', label: 'Deducciones', type: 'money' },
    { key: 'gravado', label: 'Gravado', type: 'money' },
    { key: 'exento', label: 'Exento', type: 'money' },
    { key: 'imss', label: 'IMSS', type: 'money' },
    { key: 'otrosDescuentos', label: 'Otros descuentos', type: 'money' },
    { key: 'netoPagar', label: 'Neto', type: 'money' }
  ];
  const totals = sumRows(outRows, [
    'empleados',
    'totalPercepciones',
    'totalDeducciones',
    'gravado',
    'exento',
    'imss',
    'otrosDescuentos',
    'netoPagar'
  ]);

  return {
    periodo,
    fuente,
    vista: 'resumen',
    columns,
    rows: outRows,
    summary: {
      grupos: outRows.length,
      ...totals,
      estatusPeriodo: periodo.estatus,
      agrupar: mode
    }
  };
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
          if (c.type === 'money') return escape(Number(v || 0).toFixed(2));
          return escape(v);
        })
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

module.exports = {
  generarReporteNomina,
  toCsv,
  VISTAS,
  META_CONCEPTOS
};
