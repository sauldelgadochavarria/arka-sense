'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { parseOptionalObjectId } = require('../libs/formHelpers');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getDepartamentoModel = require('../models/departamento');
const getCentroCostoModel = require('../models/centroCosto');
const getEmpleadoModel = require('../models/empleado');
const { generarReporteNomina, toCsv, VISTAS } = require('../services/nominaReportesService');
const {
  generarReporteAcumulados,
  listConceptosParaFiltro,
  toCsv: toCsvAcum,
  VISTAS: VISTAS_ACUM,
  AGRUPAR: AGRUPAR_ACUM,
  CODIGOS_IMPUESTOS_RETENIDOS
} = require('../services/nominaAcumuladosReporteService');

function parseFilters(query) {
  const vista = VISTAS.includes(String(query.vista || '')) ? String(query.vista) : 'totales';
  const agrupar = ['departamento', 'centroCosto', 'ambos'].includes(String(query.agrupar || ''))
    ? String(query.agrupar)
    : 'departamento';
  return {
    periodoId: parseOptionalObjectId(query.periodoId),
    departamentoId: parseOptionalObjectId(query.departamentoId),
    centroCostoId: parseOptionalObjectId(query.centroCostoId),
    vista,
    agrupar
  };
}

function parseAcumuladosFilters(query) {
  const anio = Number(query.anio) || new Date().getFullYear();
  const vista = VISTAS_ACUM.includes(String(query.vista || '')) ? String(query.vista) : 'sabanota';
  const agrupar = AGRUPAR_ACUM.includes(String(query.agrupar || ''))
    ? String(query.agrupar)
    : 'departamento';
  const rawTipo = query.tipoConcepto;
  const tipoConcepto =
    rawTipo === undefined || rawTipo === null
      ? 'ambas'
      : ['ambas', 'percepcion', 'deduccion', 'otro_pago', ''].includes(String(rawTipo))
        ? String(rawTipo)
        : 'ambas';
  let conceptos = query.conceptos;
  if (typeof conceptos === 'string') conceptos = conceptos;
  return {
    anio,
    vista,
    agrupar,
    tipoConcepto,
    conceptos,
    departamentoId: parseOptionalObjectId(query.departamentoId),
    centroCostoId: parseOptionalObjectId(query.centroCostoId),
    empleadoId: parseOptionalObjectId(query.empleadoId),
    impuestosRetenidos: query.impuestosRetenidos === '1' || query.impuestosRetenidos === 'true',
    mostrarMeses: query.mostrarMeses === '1' || query.mostrarMeses === 'true'
  };
}

function exportQueryFrom(filters) {
  const p = new URLSearchParams();
  if (filters.periodoId) p.set('periodoId', String(filters.periodoId));
  if (filters.departamentoId) p.set('departamentoId', String(filters.departamentoId));
  if (filters.centroCostoId) p.set('centroCostoId', String(filters.centroCostoId));
  p.set('vista', filters.vista);
  if (filters.vista === 'resumen') p.set('agrupar', filters.agrupar);
  return p.toString();
}

function exportAcumuladosQueryFrom(filters) {
  const p = new URLSearchParams();
  p.set('generar', '1');
  p.set('anio', String(filters.anio));
  p.set('vista', filters.vista);
  if (filters.vista === 'resumen') p.set('agrupar', filters.agrupar);
  if (filters.tipoConcepto != null && filters.tipoConcepto !== undefined) {
    p.set('tipoConcepto', String(filters.tipoConcepto));
  }
  if (filters.departamentoId) p.set('departamentoId', String(filters.departamentoId));
  if (filters.centroCostoId) p.set('centroCostoId', String(filters.centroCostoId));
  if (filters.empleadoId) p.set('empleadoId', String(filters.empleadoId));
  if (filters.impuestosRetenidos) p.set('impuestosRetenidos', '1');
  if (filters.mostrarMeses) p.set('mostrarMeses', '1');
  const conceptos = Array.isArray(filters.conceptos)
    ? filters.conceptos
    : String(filters.conceptos || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  for (const c of conceptos) p.append('conceptos', c);
  return p.toString();
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function labelPeriodo(p) {
  if (!p) return '';
  const ini = p.fechaInicio ? new Date(p.fechaInicio).toLocaleDateString('es-MX') : '';
  const fin = p.fechaFin ? new Date(p.fechaFin).toLocaleDateString('es-MX') : '';
  const num = p.numeroPeriodo != null ? `#${p.numeroPeriodo}` : '';
  return `${p.tipoPeriodo || ''} ${num} ${ini}–${fin} (${p.estatus})`.trim();
}

async function loadCatalogs(tenantId, empresa) {
  const Periodo = await getPeriodoNominaModel();
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const periodoQ = { tenantId };
  if (empresa?._id) periodoQ.empresaId = empresa._id;
  const [periodos, departamentos, centrosCosto] = await Promise.all([
    Periodo.find(periodoQ).sort({ anio: -1, numeroPeriodo: -1, fechaInicio: -1 }).limit(80).lean(),
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    empresa
      ? CentroCosto.find({ tenantId, empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean()
      : []
  ]);
  return { periodos, departamentos, centrosCosto };
}

async function loadAcumuladosCatalogs(tenantId, empresa, subsidiariaId) {
  const Departamento = await getDepartamentoModel();
  const CentroCosto = await getCentroCostoModel();
  const Empleado = await getEmpleadoModel();
  const empQ = { tenantId };
  if (empresa?._id) empQ.empresaId = empresa._id;
  if (subsidiariaId) empQ.subsidiariaId = subsidiariaId;

  const yearNow = new Date().getFullYear();
  const anios = [];
  for (let y = yearNow; y >= yearNow - 5; y -= 1) anios.push(y);

  const [departamentos, centrosCosto, empleados, conceptos] = await Promise.all([
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    empresa
      ? CentroCosto.find({ tenantId, empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean()
      : Promise.resolve([]),
    Empleado.find(empQ)
      .select('_id numEmpleado firstName lastName nombreSat')
      .sort({ numEmpleado: 1 })
      .limit(400)
      .lean(),
    empresa ? listConceptosParaFiltro(tenantId, empresa._id, subsidiariaId) : Promise.resolve([])
  ]);

  const empleadosTotal = await Empleado.countDocuments(empQ);
  return {
    departamentos,
    centrosCosto,
    empleados,
    empleadosTotal,
    conceptos,
    anios
  };
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const filters = parseFilters(req.query);
  const catalogs = await loadCatalogs(req.session.tenantId, empresa);

  let result = null;
  if (filters.periodoId && empresa) {
    result = await generarReporteNomina(req.session.tenantId, empresa._id, filters);
  }

  res.render('Nomina/reportes', {
    session: req.session,
    empresa,
    error: error || null,
    filters,
    catalogs,
    result,
    exportQuery: exportQueryFrom(filters),
    formatMoney,
    labelPeriodo,
    vistas: VISTAS
  });
}

async function exportCsv(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) {
    return res.status(400).send(error || 'Sin empresa');
  }
  const filters = parseFilters(req.query);
  if (!filters.periodoId) {
    return res.status(400).send('Selecciona un período');
  }
  const result = await generarReporteNomina(req.session.tenantId, empresa._id, filters);
  const csv = toCsv(result);
  const est = result.periodo?.estatus || 'nomina';
  const vista = filters.vista;
  const filename = `nomina_${vista}_${est}_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

async function acumuladosIndex(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const filters = parseAcumuladosFilters(req.query);
  const subsidiariaId = sessionSubsidiariaId(req);
  const catalogs = await loadAcumuladosCatalogs(req.session.tenantId, empresa, subsidiariaId);
  const mustGenerate = String(req.query.generar || '') === '1';

  let result = null;
  if (empresa && mustGenerate) {
    result = await generarReporteAcumulados({
      tenantId: req.session.tenantId,
      empresa,
      subsidiariaId,
      filters
    });
  }

  res.render('Nomina/reportes-acumulados', {
    session: req.session,
    empresa,
    error: error || null,
    filters,
    catalogs,
    result,
    mustGenerate,
    exportQuery: exportAcumuladosQueryFrom(filters),
    formatMoney,
    vistas: VISTAS_ACUM,
    agruparOpts: AGRUPAR_ACUM,
    codigosImpuestos: CODIGOS_IMPUESTOS_RETENIDOS
  });
}

async function acumuladosExportCsv(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) {
    return res.status(400).send(error || 'Sin empresa');
  }
  const filters = parseAcumuladosFilters(req.query);
  const result = await generarReporteAcumulados({
    tenantId: req.session.tenantId,
    empresa,
    subsidiariaId: sessionSubsidiariaId(req),
    filters
  });
  const csv = toCsvAcum(result);
  const filename = `acumulados_${filters.anio}_${filters.vista}_${Date.now()}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

module.exports = {
  index,
  exportCsv,
  acumuladosIndex,
  acumuladosExportCsv
};
