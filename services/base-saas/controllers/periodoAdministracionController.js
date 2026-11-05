'use strict';

const { requireEmpresaForTenant, scopeEmpresaFilter, sessionSubsidiariaId } = require('../libs/tenantScope');
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
  sugerirInicioGeneracion,
  clasificarBloquesPeriodo,
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
  const subId = sessionSubsidiariaId(req);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id, subId);

  const filtros = {
    empresaId: empresa ? empresa._id : undefined,
    subsidiariaId: subId || undefined,
    tipoPeriodoId: trimString(req.query.tipoPeriodoId) || undefined,
    anio: req.query.anio ? Number(req.query.anio) : undefined,
    estatus: trimString(req.query.estatus) || undefined,
    tipoNomina: trimString(req.query.tipoNomina) || undefined
  };

  const [periodos, tiposPeriodo] = await Promise.all([
    empresa ? listarPeriodos(req.session.tenantId, filtros) : [],
    empresa ? listTiposPeriodo(req.session.tenantId, true, empresa._id, subId || null) : []
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
  const subId = sessionSubsidiariaId(req);
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id, subId);
  const tiposPeriodo = empresa
    ? await listTiposPeriodo(req.session.tenantId, true, empresa._id, subId || null)
    : [];

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

function ymdDeBloque(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function sugerenciaApi(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) return res.status(400).json({ error: error || 'No hay empresa vinculada' });
    const tipoPeriodoRef = await getTipoPeriodoById(req.session.tenantId, req.query.tipoPeriodoId);
    if (!tipoPeriodoRef) return res.status(400).json({ error: 'Tipo de período no encontrado' });
    const anio = parsePositiveNumber(req.query.anio);
    if (!anio) return res.status(400).json({ error: 'Año requerido' });
    const sugerencia = await sugerirInicioGeneracion(req.session.tenantId, empresa._id, {
      tipoPeriodoRef,
      anio,
      tipoNomina: trimString(req.query.tipoNomina) || 'ordinaria',
      destino: trimString(req.query.destino),
      subsidiariaId: sessionSubsidiariaId(req)
    });
    res.json(sugerencia);
  } catch (err) {
    res.status(400).json({ error: err.message || 'No se pudo sugerir el inicio' });
  }
}

async function previewApi(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) return res.status(400).json({ error: error || 'No hay empresa vinculada' });
    const tipoPeriodoRef = await getTipoPeriodoById(req.session.tenantId, req.body.tipoPeriodoId);
    if (!tipoPeriodoRef) return res.status(400).json({ error: 'Tipo de período no encontrado' });

    const fechaInicial = parseDate(req.body.fechaInicial);
    const anio = parsePositiveNumber(req.body.anio);
    const numeroInicial = parsePositiveNumber(req.body.numeroInicial);
    if (!fechaInicial || !anio) return res.status(400).json({ error: 'Fecha inicial y año requeridos' });
    if (!numeroInicial || numeroInicial < 1) {
      return res.status(400).json({ error: 'Indica el número del primer período a generar' });
    }

    const bloques = generarBloquesPeriodoAnio({
      tipoMotor: tipoPeriodoRef.tipoMotor,
      diasPeriodo: tipoPeriodoRef.diasPeriodo,
      fechaInicial,
      anio,
      tipoPeriodoRef,
      numeroInicial
    });
    const filas = await clasificarBloquesPeriodo(
      req.session.tenantId,
      empresa._id,
      {
        tipoPeriodoRef,
        tipoNomina: trimString(req.body.tipoNomina) || 'ordinaria',
        destino: trimString(req.body.destino),
        subsidiariaId: sessionSubsidiariaId(req)
      },
      bloques
    );
    const porCrear = filas.filter((b) => b.crearPrenomina || b.crearNomina).length;

    res.json({
      total: filas.length,
      porCrear,
      tipoPeriodo: {
        nombre: tipoPeriodoRef.nombre,
        codigoLegado: tipoPeriodoRef.codigoLegado,
        aplicaAsistenciaPrenomina: tipoPeriodoRef.aplicaAsistenciaPrenomina !== false,
        compartirConNomina: tipoPeriodoRef.compartirConNomina !== false
      },
      destino: filas[0]?.destino || trimString(req.body.destino) || 'ambos',
      bloques: filas.map((b) => ({
        numeroPeriodo: b.numeroPeriodo,
        fechaInicio: ymdDeBloque(b.fechaInicio),
        fechaFin: ymdDeBloque(b.fechaFin),
        aplicaPrenomina: b.aplicaPrenomina,
        aplicaNomina: b.aplicaNomina,
        crearPrenomina: b.crearPrenomina,
        crearNomina: b.crearNomina,
        prenomina: b.prenomina,
        nomina: b.nomina
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
    const numeroInicial = parsePositiveNumber(req.body.numeroInicial);
    if (!fechaInicial || !anio) {
      req.flash('error', 'Fecha inicial y año son obligatorios');
      return res.redirect('/catalogos/periodos/generar');
    }
    if (!numeroInicial || numeroInicial < 1) {
      req.flash('error', 'Indica el número donde empieza la generación');
      return res.redirect('/catalogos/periodos/generar');
    }

    const result = await generarPeriodosAnuales(req.session.tenantId, empresa._id, {
      tipoPeriodoRef,
      anio,
      fechaInicial,
      numeroInicial,
      tipoNomina: trimString(req.body.tipoNomina) || 'ordinaria',
      destino: trimString(req.body.destino),
      notas: trimString(req.body.notas),
      subsidiariaId: sessionSubsidiariaId(req)
    });

    const donde = { prenomina: 'solo pre-nómina', nomina: 'solo nómina', ambos: 'pre-nómina y nómina' };
    req.flash(
      'success',
      `Generación (${donde[result.destino] || result.destino}). Pre-nómina: ${result.insertadosPrenomina} nuevo(s). Nómina: ${result.insertadosNomina} nuevo(s). Omitidos por ya existir: ${result.omitidos.length}.`
    );
    if (result.destino === 'nomina') {
      return res.redirect(`/nomina/periodos?anio=${anio}`);
    }
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

module.exports = { list, generarForm, sugerenciaApi, previewApi, generar, abrir, cerrar };
