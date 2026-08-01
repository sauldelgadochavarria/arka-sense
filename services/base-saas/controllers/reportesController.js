const getEmpleadoModel = require('../models/empleado');
const getDepartamentoModel = require('../models/departamento');
const getTurnoModel = require('../models/turno');
const getTipoIncidenciaModel = require('../models/tipoIncidencia');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { parseReportFilters, toDateInputValue } = require('../libs/reportFilters');
const { REPORTES, REPORTES_BY_SLUG } = require('../config/reportesCatalog');
const { runReport } = require('../services/reportesService');
const { getDashboardKpis } = require('../services/dashboardKpiService');
const { escapeCsv } = require('../services/integration/csvUtils');

async function loadFilterCatalogs(tenantId) {
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const Turno = await getTurnoModel();
  const TipoIncidencia = await getTipoIncidenciaModel();
  const PayrollPeriod = await getPayrollPeriodModel();

  const [empleados, departamentos, turnos, tiposIncidencia, periodos] = await Promise.all([
    Empleado.find({ tenantId, estatus: 'activo' }).sort({ lastName: 1 }).lean(),
    Departamento.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Turno.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    TipoIncidencia.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    PayrollPeriod.find({ tenantId }).sort({ fechaInicio: -1 }).limit(24).lean()
  ]);

  return { empleados, departamentos, turnos, tiposIncidencia, periodos };
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Reportes/index', {
    reportes: REPORTES,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function dashboardKpis(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const kpis = empresa ? await getDashboardKpis(req.session.tenantId) : null;
  res.render('Reportes/kpis', {
    kpis,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function show(req, res) {
  const meta = REPORTES_BY_SLUG[req.params.slug];
  if (!meta) {
    req.flash('error', 'Reporte no encontrado');
    return res.redirect('/reportes');
  }

  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const filters = parseReportFilters(req.query);
  const catalogs = empresa ? await loadFilterCatalogs(req.session.tenantId) : null;
  const result = empresa ? await runReport(meta.slug, req.session.tenantId, filters) : null;

  const filterValues = {
    desde: toDateInputValue(filters.fechaInicio),
    hasta: toDateInputValue(filters.fechaFin),
    departamentoId: filters.departamentoId || '',
    turnoId: filters.turnoId || '',
    empleadoId: filters.empleadoId || '',
    tipoIncidenciaId: filters.tipoIncidenciaId || '',
    estatusIncidencia: filters.estatusIncidencia || '',
    anio: String(filters.anio),
    periodoId: filters.periodoId || ''
  };
  const exportQuery = new URLSearchParams(
    Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v))
  ).toString();

  res.render('Reportes/show', {
    meta,
    result,
    filters,
    filterValues,
    exportQuery,
    catalogs,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function exportCsv(req, res) {
  const meta = REPORTES_BY_SLUG[req.params.slug];
  if (!meta) {
    req.flash('error', 'Reporte no encontrado');
    return res.redirect('/reportes');
  }

  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) {
    req.flash('error', error || 'Sin empresa configurada');
    return res.redirect('/reportes');
  }

  const filters = parseReportFilters(req.query);
  const result = await runReport(meta.slug, req.session.tenantId, filters);
  if (!result?.rows?.length) {
    req.flash('error', 'No hay datos para exportar con los filtros seleccionados');
    return res.redirect(`/reportes/${meta.slug}?${new URLSearchParams(req.query).toString()}`);
  }

  const keys = result.columns.map((c) => c.key);
  const lines = [result.columns.map((c) => c.label).join(',')];
  for (const row of result.rows) {
    lines.push(keys.map((k) => escapeCsv(row[k])).join(','));
  }
  const csv = lines.join('\n');

  const filename = `reporte-${meta.slug}-${filters.fechaInicio.toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${csv}`);
}

module.exports = { index, dashboardKpis, show, exportCsv, getDashboardKpis };
