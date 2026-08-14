'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay } = require('../libs/timeHelpers');
const {
  generarDirectorioSua,
  generarAltasPeriodoSua,
  generarMovimientosSua,
  generarCreditosSua,
  TIPOS_MOV_SUA_LABEL,
  TIPOS_CRED_SUA_LABEL
} = require('../services/suaExportService');

const MODOS = ['directorio', 'altas', 'movimientos', 'creditos'];

function defaultRange() {
  const fin = new Date();
  const ini = new Date(fin.getFullYear(), fin.getMonth(), 1);
  return {
    desde: ini.toISOString().slice(0, 10),
    hasta: fin.toISOString().slice(0, 10)
  };
}

function parseOpts(query) {
  const rango = defaultRange();
  return {
    modo: MODOS.includes(String(query.modo)) ? String(query.modo) : 'directorio',
    estatus: ['activo', 'baja', 'todos'].includes(String(query.estatus))
      ? String(query.estatus)
      : 'activo',
    registroPatronal: trimString(query.registroPatronal),
    desde: trimString(query.desde) || rango.desde,
    hasta: trimString(query.hasta) || rango.hasta,
    tipoMovCred: ['15', '16', '17', '18', '19', '20'].includes(String(query.tipoMovCred))
      ? String(query.tipoMovCred)
      : '15',
    archivo: trimString(query.archivo) || ''
  };
}

async function runExport(tenantId, empresa, filters) {
  const rp = filters.registroPatronal || empresa.registroPatronal || '';
  const fi = startOfDay(parseDateTimeLocal(`${filters.desde}T12:00`) || new Date());
  const ff = endOfDay(parseDateTimeLocal(`${filters.hasta}T12:00`) || new Date());

  if (filters.modo === 'movimientos') {
    return generarMovimientosSua(tenantId, {
      fechaInicio: fi,
      fechaFin: ff,
      registroPatronal: rp
    });
  }
  if (filters.modo === 'altas') {
    return generarAltasPeriodoSua(tenantId, {
      fechaInicio: fi,
      fechaFin: ff,
      registroPatronal: rp
    });
  }
  if (filters.modo === 'creditos') {
    return generarCreditosSua(tenantId, {
      registroPatronal: rp,
      tipoMovCred: filters.tipoMovCred,
      estatus: filters.estatus
    });
  }
  return generarDirectorioSua(tenantId, {
    estatus: filters.estatus,
    registroPatronal: rp
  });
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const filters = parseOpts(req.query);
  let result = null;
  let genError = null;

  if (empresa && req.query.generar === '1') {
    try {
      result = await runExport(req.session.tenantId, empresa, filters);
    } catch (err) {
      console.error('[sua-export]', err);
      genError = err.message || 'Error al generar exportación SUA';
    }
  }

  res.render('Nomina/sua-export', {
    session: req.session,
    empresa,
    error: error || genError,
    filters,
    result,
    tiposMovLabel: TIPOS_MOV_SUA_LABEL,
    tiposCredLabel: TIPOS_CRED_SUA_LABEL
  });
}

async function download(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  if (error || !empresa) {
    req.flash('error', error || 'Sin empresa');
    return res.redirect('/nomina/sua');
  }

  const filters = parseOpts(req.query);
  let result;
  try {
    result = await runExport(req.session.tenantId, empresa, filters);
  } catch (err) {
    req.flash('error', err.message || 'Error al generar TXT');
    return res.redirect('/nomina/sua');
  }

  const names = Object.keys(result.archivos || {});
  const fileName = names.includes(filters.archivo) ? filters.archivo : names[0] || 'SUA.TXT';
  const body = result.archivos[fileName] || '';

  res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(Buffer.from(body, 'latin1'));
}

module.exports = { index, download };
