'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');
const { parseDateTimeLocal, startOfDay, endOfDay, ymdInTimeZone } = require('../libs/timeHelpers');
const { zonaDeSubsidiariaId } = require('../services/zonaHorariaService');
const {
  generarDirectorioSua,
  generarAltasPeriodoSua,
  generarMovimientosSua,
  generarCreditosSua,
  TIPOS_MOV_SUA_LABEL,
  TIPOS_CRED_SUA_LABEL
} = require('../services/suaExportService');

const MODOS = ['directorio', 'altas', 'movimientos', 'creditos'];

function defaultRange(timeZone) {
  const hasta = ymdInTimeZone(new Date(), timeZone);
  return {
    desde: `${hasta.slice(0, 7)}-01`,
    hasta
  };
}

function parseOpts(query, timeZone) {
  const rango = defaultRange(timeZone);
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
  const zona = filters.timeZone;
  const fi = startOfDay(parseDateTimeLocal(`${filters.desde}T12:00`, zona) || new Date());
  const ff = endOfDay(parseDateTimeLocal(`${filters.hasta}T12:00`, zona) || new Date());

  const scope = {
    registroPatronal: rp,
    empresaId: empresa?._id || null,
    subsidiariaId: filters.subsidiariaId || null
  };
  if (filters.modo === 'movimientos') {
    return generarMovimientosSua(tenantId, {
      fechaInicio: fi,
      fechaFin: ff,
      ...scope
    });
  }
  if (filters.modo === 'altas') {
    return generarAltasPeriodoSua(tenantId, {
      fechaInicio: fi,
      fechaFin: ff,
      ...scope
    });
  }
  if (filters.modo === 'creditos') {
    return generarCreditosSua(tenantId, {
      tipoMovCred: filters.tipoMovCred,
      estatus: filters.estatus,
      ...scope
    });
  }
  return generarDirectorioSua(tenantId, {
    estatus: filters.estatus,
    ...scope
  });
}

async function index(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const zona = await zonaDeSubsidiariaId(sessionSubsidiariaId(req));
  const filters = parseOpts(req.query, zona);
  filters.timeZone = zona;
  filters.subsidiariaId = sessionSubsidiariaId(req);
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
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) {
    req.flash('error', error || 'Sin empresa');
    return res.redirect('/nomina/sua');
  }

  const zona = await zonaDeSubsidiariaId(sessionSubsidiariaId(req));
  const filters = parseOpts(req.query, zona);
  filters.timeZone = zona;
  filters.subsidiariaId = sessionSubsidiariaId(req);
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
