'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseOptionalObjectId } = require('../libs/formHelpers');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getDepartamentoModel = require('../models/departamento');
const getCentroCostoModel = require('../models/centroCosto');
const { generarReporteNomina, toCsv, VISTAS } = require('../services/nominaReportesService');

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

function exportQueryFrom(filters) {
  const p = new URLSearchParams();
  if (filters.periodoId) p.set('periodoId', String(filters.periodoId));
  if (filters.departamentoId) p.set('departamentoId', String(filters.departamentoId));
  if (filters.centroCostoId) p.set('centroCostoId', String(filters.centroCostoId));
  p.set('vista', filters.vista);
  if (filters.vista === 'resumen') p.set('agrupar', filters.agrupar);
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

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
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
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
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

module.exports = { index, exportCsv };
