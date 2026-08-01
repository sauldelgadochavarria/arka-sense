const getIntegrationProfileModel = require('../models/integrationProfile');
const getSyncLogModel = require('../models/syncLog');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString } = require('../libs/formHelpers');
const {
  ADAPTADORES_NOMINA,
  TIPOS_SYNC,
  ESTATUS_SYNC,
  CAMPOS_MAPEABLES,
  DEFAULT_FIELD_MAPPING
} = require('../config/integraciones');
const { ensureDefaultProfiles } = require('../services/integration/profileService');
const { exportPayrollPeriod } = require('../services/payrollExportService');
const { exportEmpleados, importEmpleados, resolveConflicto } = require('../services/empleadoSyncService');

async function listPerfiles(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const perfiles = empresa
    ? await ensureDefaultProfiles(req.session.tenantId, empresa._id)
    : [];

  res.render('Integraciones/perfiles', {
    perfiles,
    adaptadores: ADAPTADORES_NOMINA,
    camposMapeables: CAMPOS_MAPEABLES,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function editPerfil(req, res) {
  const IntegrationProfile = await getIntegrationProfileModel();
  const perfil = await IntegrationProfile.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId
  }).lean();
  if (!perfil) return res.status(404).send('Perfil no encontrado');

  const mapping = { ...DEFAULT_FIELD_MAPPING, ...(perfil.fieldMapping || {}) };

  res.render('Integraciones/perfil-edit', {
    perfil,
    mapping,
    camposMapeables: CAMPOS_MAPEABLES,
    session: req.session
  });
}

async function updatePerfil(req, res) {
  try {
    const IntegrationProfile = await getIntegrationProfileModel();
    const profile = await IntegrationProfile.findOne({
      _id: req.params.id,
      tenantId: req.session.tenantId
    });
    if (!profile) {
      req.flash('error', 'Perfil no encontrado');
      return res.redirect('/integraciones/perfiles');
    }

    const mapping = { ...(profile.fieldMapping || {}) };
    for (const c of CAMPOS_MAPEABLES) {
      const val = trimString(req.body[`map_${c.key}`]);
      if (val) mapping[c.key] = val;
    }

    profile.nombre = trimString(req.body.nombre) || profile.nombre;
    profile.activo = req.body.activo === 'on' || req.body.activo === 'true';
    profile.notas = trimString(req.body.notas);
    profile.fieldMapping = mapping;
    await profile.save();

    req.flash('success', 'Perfil actualizado');
    res.redirect('/integraciones/perfiles');
  } catch (err) {
    console.error('[integraciones]', err);
    req.flash('error', 'Error al actualizar perfil');
    res.redirect('/integraciones/perfiles');
  }
}

async function showExportacion(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const perfiles = empresa
    ? await ensureDefaultProfiles(req.session.tenantId, empresa._id)
    : [];
  const periodos = empresa
    ? await PayrollPeriod.find({
        tenantId: req.session.tenantId,
        estatus: { $in: ['borrador', 'cerrado'] }
      })
        .sort({ fechaInicio: -1 })
        .limit(12)
        .lean()
    : [];

  res.render('Integraciones/exportacion', {
    perfiles: perfiles.filter((p) => p.activo),
    periodos,
    adaptadores: ADAPTADORES_NOMINA,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function ejecutarExportacion(req, res) {
  try {
    const result = await exportPayrollPeriod(
      req.body.periodId,
      req.session.tenantId,
      req.body.profileId,
      req.session.userid || ''
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send('\uFEFF' + result.content);
  } catch (err) {
    console.error('[integraciones]', err);
    const msg =
      err.message === 'PERIOD_NOT_FOUND'
        ? 'Período no encontrado'
        : err.message === 'NO_PAYROLL_DATA'
          ? 'El período no tiene cálculo. Calcula la pre-nómina primero.'
          : err.message === 'PERIOD_NOT_READY'
            ? 'El período debe estar en borrador o cerrado'
            : 'Error al exportar';
    req.flash('error', msg);
    res.redirect('/integraciones/exportacion');
  }
}

async function showAbcSync(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Integraciones/abc-sync', { empresa, error: error || null, session: req.session });
}

async function ejecutarExportAbc(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/integraciones/abc');
    }
    const result = await exportEmpleados(req.session.tenantId, empresa._id, req.session.userid || '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send('\uFEFF' + result.content);
  } catch (err) {
    console.error('[integraciones]', err);
    req.flash('error', 'Error al exportar empleados');
    res.redirect('/integraciones/abc');
  }
}

async function ejecutarImportAbc(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/integraciones/abc');
    }
    const log = await importEmpleados(
      req.session.tenantId,
      empresa._id,
      req.body.csvContent,
      req.session.userid || ''
    );
    req.flash(
      log.conflictos?.length ? 'error' : 'success',
      log.detalle
    );
    res.redirect(`/integraciones/logs/${log._id}`);
  } catch (err) {
    console.error('[integraciones]', err);
    req.flash('error', err.message === 'CSV_EMPTY' ? 'CSV vacío o inválido' : 'Error al importar');
    res.redirect('/integraciones/abc');
  }
}

async function listLogs(req, res) {
  const SyncLog = await getSyncLogModel();
  const logs = await SyncLog.find({ tenantId: req.session.tenantId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.render('Integraciones/logs', {
    logs,
    tiposSync: TIPOS_SYNC,
    estatusSync: ESTATUS_SYNC,
    session: req.session
  });
}

async function showLog(req, res) {
  const SyncLog = await getSyncLogModel();
  const log = await SyncLog.findOne({ _id: req.params.id, tenantId: req.session.tenantId }).lean();
  if (!log) return res.status(404).send('Log no encontrado');

  res.render('Integraciones/log-show', {
    log,
    tiposSync: TIPOS_SYNC,
    estatusSync: ESTATUS_SYNC,
    session: req.session
  });
}

async function descargarArchivoLog(req, res) {
  const SyncLog = await getSyncLogModel();
  const log = await SyncLog.findOne({ _id: req.params.id, tenantId: req.session.tenantId }).lean();
  if (!log || !log.archivoContenido) return res.status(404).send('Archivo no disponible');

  const isJson = log.archivoNombre.endsWith('.json');
  res.setHeader('Content-Type', isJson ? 'application/json' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${log.archivoNombre}"`);
  res.send(isJson ? log.archivoContenido : '\uFEFF' + log.archivoContenido);
}

async function resolverConflicto(req, res) {
  try {
    await resolveConflicto(
      req.params.logId,
      req.session.tenantId,
      req.params.conflictoId,
      trimString(req.body.resolucion)
    );
    req.flash('success', 'Conflicto resuelto');
    res.redirect(`/integraciones/logs/${req.params.logId}`);
  } catch (err) {
    console.error('[integraciones]', err);
    req.flash('error', 'No se pudo resolver el conflicto');
    res.redirect(`/integraciones/logs/${req.params.logId}`);
  }
}

module.exports = {
  listPerfiles,
  editPerfil,
  updatePerfil,
  showExportacion,
  ejecutarExportacion,
  showAbcSync,
  ejecutarExportAbc,
  ejecutarImportAbc,
  listLogs,
  showLog,
  descargarArchivoLog,
  resolverConflicto
};
