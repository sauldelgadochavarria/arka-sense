'use strict';

const { requireEmpresaForTenant, scopeEmpresaFilter } = require('../libs/tenantScope');
const { trimString, parseDate, parsePositiveNumber } = require('../libs/formHelpers');
const { generarBloquesPeriodoAnio } = require('../libs/generarPeriodosAnio');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById
} = require('../services/tipoPeriodoNominaService');
const {
  listarPeriodos,
  generarPeriodosAnuales,
  getContextoPeriodo,
  abrirPeriodo,
  cerrarPeriodoAdmin
} = require('../services/periodoAdministracionService');
const {
  ESTATUS_PERIODO_NOMINA,
  TIPOS_NOMINA_ESPECIALES,
  TIPOS_NOMINA_ORDINARIOS,
  TIPOS_NOMINA_EXTRA
} = require('../config/periodosNomina');

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id);

  const filtros = {
    empresaId: empresa ? empresa._id : undefined,
    subsidiariaId: req.session.subsidiariaActiva?._id || undefined,
    tipoPeriodoId: trimString(req.query.tipoPeriodoId) || undefined,
    anio: req.query.anio ? Number(req.query.anio) : undefined,
    estatus: trimString(req.query.estatus) || undefined,
    tipoNomina: trimString(req.query.tipoNomina) || undefined
  };

  const [periodos, tiposPeriodo] = await Promise.all([
    empresa ? listarPeriodos(req.session.tenantId, filtros) : [],
    empresa ? listTiposPeriodo(req.session.tenantId, true, empresa._id) : []
  ]);

  const tipoMap = new Map(tiposPeriodo.map((t) => [String(t._id), t]));
  const tipoPeriodoSeleccionado = filtros.tipoPeriodoId
    ? tipoMap.get(String(filtros.tipoPeriodoId)) || null
    : null;
  const contextos = {};
  if (empresa) {
    for (const p of periodos) {
      contextos[String(p._id)] = await getContextoPeriodo(req.session.tenantId, p);
    }
  }

  res.render('Catalogos/periodos-admin', {
    periodos,
    tiposPeriodo,
    tipoMap,
    tipoPeriodoSeleccionado,
    contextos,
    filtros,
    estatusLabels: ESTATUS_PERIODO_NOMINA,
    tiposNomina: TIPOS_NOMINA_ESPECIALES,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function generarForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id);
  const tiposPeriodo = empresa ? await listTiposPeriodo(req.session.tenantId, true, empresa._id) : [];

  res.render('Catalogos/periodos-generar', {
    tiposPeriodo,
    tiposNominaOrdinarios: TIPOS_NOMINA_ORDINARIOS,
    tiposNominaExtra: TIPOS_NOMINA_EXTRA,
    anioActual: new Date().getFullYear(),
    empresa,
    error: error || null,
    session: req.session
  });
}

async function previewApi(req, res) {
  try {
    const tipoPeriodoRef = await getTipoPeriodoById(req.session.tenantId, req.body.tipoPeriodoId);
    if (!tipoPeriodoRef) return res.status(400).json({ error: 'Tipo de período no encontrado' });

    const fechaInicial = parseDate(req.body.fechaInicial);
    const anio = parsePositiveNumber(req.body.anio);
    if (!fechaInicial || !anio) return res.status(400).json({ error: 'Fecha inicial y año requeridos' });

    const bloques = generarBloquesPeriodoAnio({
      tipoMotor: tipoPeriodoRef.tipoMotor,
      diasPeriodo: tipoPeriodoRef.diasPeriodo,
      fechaInicial,
      anio,
      tipoPeriodoRef
    });

    res.json({
      total: bloques.length,
      tipoPeriodo: {
        nombre: tipoPeriodoRef.nombre,
        codigoLegado: tipoPeriodoRef.codigoLegado,
        aplicaAsistenciaPrenomina: tipoPeriodoRef.aplicaAsistenciaPrenomina !== false,
        compartirConNomina: tipoPeriodoRef.compartirConNomina !== false
      },
      bloques: bloques.map((b) => ({
        numeroPeriodo: b.numeroPeriodo,
        fechaInicio: b.fechaInicio.toISOString().slice(0, 10),
        fechaFin: b.fechaFin.toISOString().slice(0, 10)
      }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Error en vista previa' });
  }
}

async function generar(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/catalogos/periodos/generar');
    }

    const tipoPeriodoId = trimString(req.body.tipoPeriodoId);
    const tipoPeriodoRef = await getTipoPeriodoById(req.session.tenantId, tipoPeriodoId);
    if (!tipoPeriodoRef) {
      req.flash('error', 'Seleccione un tipo de período válido');
      return res.redirect('/catalogos/periodos/generar');
    }

    const fechaInicial = parseDate(req.body.fechaInicial);
    const anio = parsePositiveNumber(req.body.anio);
    if (!fechaInicial || !anio) {
      req.flash('error', 'Fecha inicial y año son obligatorios');
      return res.redirect('/catalogos/periodos/generar');
    }

    const result = await generarPeriodosAnuales(req.session.tenantId, empresa._id, {
      tipoPeriodoRef,
      anio,
      fechaInicial,
      tipoNomina: trimString(req.body.tipoNomina) || 'ordinaria',
      notas: trimString(req.body.notas),
      subsidiariaId: req.session.subsidiariaActiva?._id || null
    });

    req.flash(
      'success',
      `Generados ${result.insertados} períodos en estatus pendiente. Ábralos en Catálogos o en Pre-nómina / Pre-cálculo para operar. Omitidos: ${result.omitidos.length}`
    );
    res.redirect(`/catalogos/periodos?tipoPeriodoId=${tipoPeriodoId}&anio=${anio}&estatus=pendiente`);
  } catch (err) {
    req.flash('error', err.message || 'Error al generar períodos');
    res.redirect('/catalogos/periodos/generar');
  }
}

async function abrir(req, res) {
  try {
    const { empresa } = await requireEmpresaForTenant(req);
    const scope = scopeEmpresaFilter(req, empresa);
    const PayrollPeriod = await getPayrollPeriodModel();
    const exists = await PayrollPeriod.findOne({ _id: req.params.id, ...scope }).select('_id').lean();
    if (!exists) {
      req.flash('error', 'Período no encontrado en la subsidiaria activa');
      return res.redirect(req.get('Referer') || '/catalogos/periodos');
    }
    await abrirPeriodo(req.session.tenantId, req.params.id, req.session.userid || '');
    req.flash('success', 'Período declarado abierto');
  } catch (err) {
    const msgs = {
      PERIOD_NOT_FOUND: 'Período no encontrado',
      PERIOD_NOT_PENDING: 'Solo períodos pendientes pueden abrirse',
      PERIOD_OTHER_OPEN: 'Ya hay otro período abierto o en borrador para este tipo',
      PERIOD_PREVIOUS_NOT_CLOSED: 'El período anterior aún no está cerrado'
    };
    req.flash('error', msgs[err.message] || err.message || 'No se pudo abrir');
  }
  res.redirect(req.get('Referer') || '/catalogos/periodos');
}

async function cerrar(req, res) {
  try {
    const { empresa } = await requireEmpresaForTenant(req);
    const scope = scopeEmpresaFilter(req, empresa);
    const PayrollPeriod = await getPayrollPeriodModel();
    const exists = await PayrollPeriod.findOne({ _id: req.params.id, ...scope }).select('_id').lean();
    if (!exists) {
      req.flash('error', 'Período no encontrado en la subsidiaria activa');
      return res.redirect(req.get('Referer') || '/catalogos/periodos');
    }
    await cerrarPeriodoAdmin(req.session.tenantId, req.params.id, req.session.userid || '');
    req.flash('success', 'Período cerrado');
  } catch (err) {
    const msgs = {
      PERIOD_NOT_FOUND: 'Período no encontrado',
      PERIOD_CLOSED: 'El período ya estaba cerrado',
      PERIOD_NOT_OPEN: 'Abra el período antes de cerrarlo'
    };
    req.flash('error', msgs[err.message] || 'No se pudo cerrar');
  }
  res.redirect(req.get('Referer') || '/catalogos/periodos');
}

module.exports = { list, generarForm, previewApi, generar, abrir, cerrar };
