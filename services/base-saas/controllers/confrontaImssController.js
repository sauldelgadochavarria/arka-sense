'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { listPeriodosNominaScoped } = require('../libs/periodosNominaScope');
const { parseOptionalObjectId, trimString } = require('../libs/formHelpers');
const {
  CHECKLIST_CONFRONTA,
  CALENDARIO_OBLIGACIONES,
  TOLERANCIA_DEFAULT
} = require('../config/confrontaImssDefaults');
const {
  ejecutarConfronta,
  toConfrontaCsv
} = require('../services/confrontaImssService');

async function loadPeriodos(tenantId, empresaId, subsidiariaId) {
  if (!empresaId) return [];
  return listPeriodosNominaScoped({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    limit: 80
  });
}

function money(n) {
  if (n == null || n === '') return '—';
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const tab = ['confronta', 'checklist', 'calendario'].includes(String(req.query.tab))
    ? String(req.query.tab)
    : 'confronta';
  const subsidiariaId = sessionSubsidiariaId(req);
  const periodos = empresa
    ? await loadPeriodos(req.session.tenantId, empresa._id, subsidiariaId)
    : [];

  const filters = {
    periodoId: parseOptionalObjectId(req.body.periodoId || req.query.periodoId),
    tolerancia:
      req.body.tolerancia != null && req.body.tolerancia !== ''
        ? Number(req.body.tolerancia)
        : TOLERANCIA_DEFAULT,
    fuenteNomina: req.body.fuenteNomina === 'base' ? 'base' : 'diario',
    csvIdse: trimString(req.body.csvIdse),
    csvSua: trimString(req.body.csvSua)
  };

  let result = null;
  let runError = null;

  if (empresa && req.method === 'POST' && req.body.accion === 'correr') {
    if (!filters.periodoId) {
      runError = 'Selecciona un período de nómina';
    } else {
      try {
        result = await ejecutarConfronta({
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          subsidiariaId,
          periodoId: filters.periodoId,
          tolerancia: filters.tolerancia,
          fuenteNomina: filters.fuenteNomina,
          csvIdse: filters.csvIdse,
          csvSua: filters.csvSua
        });
        // Guardar en sesión para export
        req.session.confrontaLast = {
          at: Date.now(),
          periodoId: String(filters.periodoId),
          result
        };
      } catch (err) {
        console.error('[confronta]', err);
        runError = err.message || 'Error al ejecutar confronta';
      }
    }
  } else if (req.query.restore === '1' && req.session.confrontaLast?.result) {
    result = req.session.confrontaLast.result;
    filters.periodoId = parseOptionalObjectId(req.session.confrontaLast.periodoId);
  }

  res.render('Nomina/confronta-imss', {
    session: req.session,
    empresa,
    error: error || runError,
    tab,
    periodos,
    filters,
    result,
    checklist: CHECKLIST_CONFRONTA,
    calendario: CALENDARIO_OBLIGACIONES,
    toleranciaDefault: TOLERANCIA_DEFAULT,
    money
  });
}

async function exportCsv(req, res) {
  const cached = req.session.confrontaLast?.result;
  if (!cached) {
    req.flash('error', 'Ejecuta primero la confronta para exportar');
    return res.redirect('/nomina/confronta');
  }
  const csv = toConfrontaCsv(cached);
  const name = `confronta-nomina-sua-idse-${cached.periodoLabel || 'periodo'}`.replace(
    /[^\w\-]+/g,
    '_'
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(csv);
}

module.exports = { index, exportCsv };
