const getPayrollPeriodModel = require('../models/payrollPeriod');
const getPayrollDetailModel = require('../models/payrollDetail');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { resolvePeriodRange } = require('../libs/payrollPeriodDates');
const { trimString, parseDate, parseCheckbox } = require('../libs/formHelpers');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { TIPOS_PERIODO, ESTATUS_PERIODO } = require('../config/prenomina');
const { FORMULAS_CONCEPTO } = require('../config/catalogos');
const {
  ensurePayrollConceptsForTenant,
  listPrenominaConceptos,
  toPrenominaShape
} = require('../services/payrollConceptService');
const {
  ensureTiposPeriodoForTenant,
  listTiposPeriodo,
  getTipoPeriodoById
} = require('../services/tipoPeriodoNominaService');
const {
  calculatePayrollPeriod,
  applyManualAdjustment,
  closePayrollPeriod
} = require('../services/payrollCalculationService');
const { validateCodigoExternoForPeriod } = require('../services/payrollPreflightService');
const { getContextoPeriodo, abrirPeriodo } = require('../services/periodoAdministracionService');
const { findOneByTenant, findOneDocByTenant } = require('../libs/tenantScope');
const { parsePositiveNumber } = require('../libs/formHelpers');

async function listPeriodos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PayrollPeriod = await getPayrollPeriodModel();
  if (empresa) await ensureTiposPeriodoForTenant(req.session.tenantId, empresa._id);

  const anioActual = new Date().getFullYear();
  const anioFiltro = req.query.anio ? Number(req.query.anio) : anioActual;

  const periodos = empresa
    ? await PayrollPeriod.find({
        tenantId: req.session.tenantId,
        $or: [
          { anio: anioFiltro },
          { anio: { $exists: false }, fechaInicio: {
            $gte: new Date(anioFiltro, 0, 1),
            $lt: new Date(anioFiltro + 1, 0, 1)
          } },
          // Incluir abiertos/borrador de otros años que sigan operables
          { estatus: { $in: ['abierto', 'borrador'] } }
        ]
      })
        .sort({ anio: -1, numeroPeriodo: 1, fechaInicio: 1 })
        .limit(120)
        .lean()
    : [];

  const contextos = {};
  for (const p of periodos) {
    if (p.estatus === 'pendiente') {
      try {
        contextos[String(p._id)] = await getContextoPeriodo(req.session.tenantId, p);
      } catch (_) {
        contextos[String(p._id)] = { puedeAbrir: false };
      }
    }
  }

  const tiposPeriodoCatalogo = empresa ? await listTiposPeriodo(req.session.tenantId, true) : [];

  res.render('Prenomina/periodos', {
    periodos,
    contextos,
    anioFiltro,
    tiposPeriodoCatalogo,
    tiposPeriodoMotor: TIPOS_PERIODO,
    estatusLabels: ESTATUS_PERIODO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createPeriodo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/prenomina-periodos');
    }

    const tipoPeriodoId = trimString(req.body.tipoPeriodoId) || null;
    let tipo = trimString(req.body.tipo) || 'quincenal';
    let aplicaAsistencia = parseCheckbox(req.body.aplicaAsistenciaPrenomina);
    let compartirNomina = parseCheckbox(req.body.compartirConNomina);
    let codigoLegadoTipoPeriodo = null;
    let tipoPeriodoRef = null;

    if (tipoPeriodoId) {
      tipoPeriodoRef = await getTipoPeriodoById(req.session.tenantId, tipoPeriodoId);
      if (!tipoPeriodoRef) {
        req.flash('error', 'Tipo de período no encontrado');
        return res.redirect('/prenomina-periodos');
      }
      tipo = tipoPeriodoRef.tipoMotor;
      aplicaAsistencia = tipoPeriodoRef.aplicaAsistenciaPrenomina;
      compartirNomina = tipoPeriodoRef.compartirConNomina;
      codigoLegadoTipoPeriodo = tipoPeriodoRef.codigoLegado;
    }

    const ref = parseDate(req.body.fechaReferencia) || new Date();
    const { fechaInicio, fechaFin } = resolvePeriodRange(tipo, ref);

    const PayrollPeriod = await getPayrollPeriodModel();
    const exists = await PayrollPeriod.findOne({
      tenantId: req.session.tenantId,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: endOfDay(fechaFin)
    });
    if (exists) {
      req.flash('error', 'Ya existe un período con esas fechas');
      return res.redirect('/prenomina-periodos');
    }

    const period = await PayrollPeriod.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      tipo,
      fechaInicio: startOfDay(fechaInicio),
      fechaFin: endOfDay(fechaFin),
      estatus: 'pendiente',
      anio: startOfDay(fechaInicio).getFullYear(),
      notas: trimString(req.body.notas),
      tipoPeriodoId: tipoPeriodoRef?._id || null,
      codigoLegadoTipoPeriodo,
      aplicaAsistenciaPrenomina: aplicaAsistencia,
      compartirConNomina: compartirNomina
    });

    await ensurePayrollConceptsForTenant(req.session.tenantId, empresa._id);
    req.flash('success', 'Período creado (pendiente). Ábralo desde Catálogos → Períodos.');
    res.redirect(`/prenomina-periodos/${period._id}`);
  } catch (err) {
    console.error('[prenomina]', err);
    req.flash('error', 'Error al crear período');
    res.redirect('/prenomina-periodos');
  }
}

async function showPeriodo(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const PayrollPeriod = await getPayrollPeriodModel();
  const PayrollDetail = await getPayrollDetailModel();
  const Empleado = await getEmpleadoModel();
  const getDailyAttendanceModel = require('../models/dailyAttendance');
  const DailyAttendance = await getDailyAttendanceModel();

  const periodo = await PayrollPeriod.findOne({
    _id: req.params.id,
    tenantId: req.session.tenantId
  }).lean();
  if (!periodo) return res.status(404).send('Período no encontrado');

  const [detalles, empleados] = await Promise.all([
    PayrollDetail.find({ tenantId: req.session.tenantId, periodId: periodo._id })
      .sort({ netoPagar: -1 })
      .lean(),
    Empleado.find({ tenantId: req.session.tenantId }).lean()
  ]);

  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const inicio = startOfDay(periodo.fechaInicio);
  const fin = endOfDay(periodo.fechaFin);

  const dailies = await DailyAttendance.find({
    tenantId: req.session.tenantId,
    fecha: { $gte: inicio, $lte: fin }
  })
    .select('empleadoId estatus fecha')
    .lean();

  const porEmpleado = new Map();
  for (const d of dailies) {
    const k = String(d.empleadoId);
    if (!porEmpleado.has(k)) porEmpleado.set(k, { total: 0, presentes: 0, faltas: 0 });
    const row = porEmpleado.get(k);
    row.total += 1;
    if (d.estatus === 'presente' || d.estatus === 'retardo') row.presentes += 1;
    if (['falta', 'registro_parcial', 'fuera_de_rango'].includes(d.estatus)) row.faltas += 1;
  }

  const empleadosActivos = empleados.filter((e) => e.estatus === 'activo' && e.activo !== false);
  const cobertura = {
    registrosDiarios: dailies.length,
    empleadosConAsistencia: porEmpleado.size,
    empleadosActivos: empleadosActivos.length,
    empleadosSinAsistencia: Math.max(0, empleadosActivos.length - porEmpleado.size),
    usaAsistencia: periodo.aplicaAsistenciaPrenomina !== false,
    fechaInicioStr: inicio.toISOString().slice(0, 10),
    fechaFinStr: startOfDay(periodo.fechaFin).toISOString().slice(0, 10)
  };

  const preflight =
    periodo.estatus === 'borrador'
      ? await validateCodigoExternoForPeriod(periodo, req.session.tenantId)
      : null;

  res.render('Prenomina/periodo-show', {
    periodo,
    detalles,
    empMap,
    cobertura,
    preflight,
    estatusLabels: ESTATUS_PERIODO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function calcularPeriodo(req, res) {
  try {
    await calculatePayrollPeriod(req.params.id, req.session.tenantId, req.session.userid || '');
    req.flash('success', 'Pre-nómina calculada (borrador)');
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  } catch (err) {
    console.error('[prenomina]', err);
    const msg =
      err.message === 'PERIOD_CLOSED'
        ? 'El período está cerrado'
        : err.message === 'PERIOD_NOT_FOUND'
          ? 'Período no encontrado'
          : err.message === 'PERIOD_NOT_OPEN'
            ? 'El período debe estar abierto o en borrador para (re)calcular'
            : 'Error al calcular pre-nómina';
    req.flash('error', msg);
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  }
}

async function reprocesarAsistenciaPeriodo(req, res) {
  try {
    const PayrollPeriod = await getPayrollPeriodModel();
    const periodo = await PayrollPeriod.findOne({
      _id: req.params.id,
      tenantId: req.session.tenantId
    }).lean();
    if (!periodo) {
      req.flash('error', 'Período no encontrado');
      return res.redirect('/prenomina-periodos');
    }
    if (periodo.estatus === 'cerrado') {
      req.flash('error', 'El período está cerrado');
      return res.redirect(`/prenomina-periodos/${periodo._id}`);
    }

    const { recalculateRangeForTenant } = require('../services/attendanceProcessingService');
    const result = await recalculateRangeForTenant(
      req.session.tenantId,
      periodo.fechaInicio,
      periodo.fechaFin
    );
    req.flash(
      'success',
      `Asistencia reprocesada: ${result.dias} día(s), ${result.registros} registro(s) diario(s). Ahora puedes (re)calcular la pre-nómina.`
    );
    res.redirect(`/prenomina-periodos/${periodo._id}`);
  } catch (err) {
    console.error('[prenomina] reprocesar asistencia', err);
    req.flash('error', err.message || 'Error al reprocesar asistencia del período');
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  }
}

async function cerrarPeriodo(req, res) {
  try {
    await closePayrollPeriod(req.params.id, req.session.tenantId, req.session.userid || '');
    req.flash('success', 'Período cerrado. Ya no admite cambios.');
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  } catch (err) {
    console.error('[prenomina]', err);
    const msg =
      err.message === 'PERIOD_NOT_CALCULATED'
        ? 'Calcula la pre-nómina antes de cerrar'
        : err.message === 'PERIOD_CLOSED'
          ? 'El período ya estaba cerrado'
          : err.message === 'MISSING_CODIGO_EXTERNO'
            ? `No se puede cerrar: ${(err.sinCodigo || []).length} empleado(s) sin código externo ni número de empleado`
            : err.message === 'PERIOD_NOT_FOUND'
              ? 'Período no encontrado'
              : `Error al cerrar período: ${err.message || 'desconocido'}`;
    req.flash('error', msg);
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  }
}

async function showComprobante(req, res) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const PayrollDetail = await getPayrollDetailModel();
  const Empleado = await getEmpleadoModel();

  const periodo = await PayrollPeriod.findOne({
    _id: req.params.periodId,
    tenantId: req.session.tenantId
  }).lean();
  if (!periodo) return res.status(404).send('Período no encontrado');

  const [detalle, empleado] = await Promise.all([
    PayrollDetail.findOne({
      tenantId: req.session.tenantId,
      periodId: periodo._id,
      empleadoId: req.params.empleadoId
    }).lean(),
    Empleado.findOne({ _id: req.params.empleadoId, tenantId: req.session.tenantId }).lean()
  ]);

  if (!detalle || !empleado) return res.status(404).send('Comprobante no encontrado');

  res.render('Prenomina/comprobante', { periodo, detalle, empleado, session: req.session });
}

async function aplicarAjuste(req, res) {
  try {
    const monto = Number(req.body.monto);
    await applyManualAdjustment(
      req.params.id,
      req.session.tenantId,
      req.params.empleadoId,
      {
        concepto: trimString(req.body.concepto),
        monto,
        tipo: trimString(req.body.tipo),
        nota: trimString(req.body.nota)
      },
      req.session.userid || ''
    );
    req.flash('success', 'Ajuste manual aplicado');
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  } catch (err) {
    console.error('[prenomina]', err);
    req.flash('error', err.message === 'PERIOD_CLOSED' ? 'Período cerrado' : 'Error al aplicar ajuste');
    res.redirect(`/prenomina-periodos/${req.params.id}`);
  }
}

async function listConceptos(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  let conceptos = [];
  if (empresa) {
    await ensurePayrollConceptsForTenant(req.session.tenantId, empresa._id);
    conceptos = await listPrenominaConceptos(req.session.tenantId, { soloActivos: false });
  }

  res.render('Prenomina/conceptos', {
    conceptos,
    formulasConcepto: FORMULAS_CONCEPTO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function newConcepto(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  res.render('Prenomina/concepto-nuevo', {
    formulasConcepto: FORMULAS_CONCEPTO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function createConcepto(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/prenomina-conceptos');
    }

    const clave = trimString(req.body.clave).toUpperCase();
    const nombre = trimString(req.body.nombre);
    const tipo = trimString(req.body.tipo);
    const formula = trimString(req.body.formula) || 'manual';

    if (!clave || !nombre || !['percepcion', 'deduccion'].includes(tipo)) {
      req.flash('error', 'Clave, nombre y tipo son obligatorios');
      return res.redirect('/prenomina-conceptos');
    }

    const Concepto = await getConceptoNominaModel();
    await Concepto.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      codigo: clave,
      clavePrenomina: clave,
      nombre,
      tipo,
      naturaleza: 'gravado',
      aplicaEn: 'prenomina',
      formulaPrenomina: formula,
      ordenCalculo: parsePositiveNumber(req.body.orden) || 99,
      codigoExterno: trimString(req.body.codigoExterno),
      cuentaContable: trimString(req.body.cuentaContable),
      activo: true
    });

    req.flash('success', 'Concepto creado (colección única)');
    res.redirect('/prenomina-conceptos');
  } catch (err) {
    console.error('[prenomina/conceptos]', err);
    req.flash('error', err.code === 11000 ? 'Ya existe un concepto con ese código' : 'Error al crear concepto');
    res.redirect('/prenomina-conceptos');
  }
}

async function editConcepto(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Concepto = await getConceptoNominaModel();
  const doc = await findOneByTenant(Concepto, req.session.tenantId, req.params.id);
  if (!doc) return res.status(404).send('Concepto no encontrado');

  res.render('Prenomina/concepto-edit', {
    concepto: toPrenominaShape(doc),
    formulasConcepto: FORMULAS_CONCEPTO,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function updateConcepto(req, res) {
  try {
    const Concepto = await getConceptoNominaModel();
    const concepto = await findOneDocByTenant(Concepto, req.session.tenantId, req.params.id);
    if (!concepto) return res.status(404).send('Concepto no encontrado');

    concepto.nombre = trimString(req.body.nombre);
    concepto.tipo = trimString(req.body.tipo);
    concepto.formulaPrenomina = trimString(req.body.formula) || 'manual';
    concepto.ordenCalculo = parsePositiveNumber(req.body.orden) ?? concepto.ordenCalculo;
    concepto.codigoExterno = trimString(req.body.codigoExterno);
    concepto.cuentaContable = trimString(req.body.cuentaContable);
    if (!concepto.aplicaEn || concepto.aplicaEn === 'nomina') {
      concepto.aplicaEn = 'ambos';
    }
    await concepto.save();

    req.flash('success', 'Concepto actualizado');
    res.redirect('/prenomina-conceptos');
  } catch (err) {
    console.error('[prenomina/conceptos]', err);
    req.flash('error', 'Error al actualizar concepto');
    res.redirect(`/prenomina-conceptos/${req.params.id}/edit`);
  }
}

async function toggleConcepto(req, res) {
  const Concepto = await getConceptoNominaModel();
  const concepto = await findOneDocByTenant(Concepto, req.session.tenantId, req.params.id);
  if (!concepto) return res.status(404).send('Concepto no encontrado');

  concepto.activo = !concepto.activo;
  await concepto.save();
  req.flash('success', concepto.activo ? 'Concepto activado' : 'Concepto desactivado');
  res.redirect('/prenomina-conceptos');
}

async function abrirPeriodoAction(req, res) {
  try {
    await abrirPeriodo(req.session.tenantId, req.params.id, req.session.userid || req.session.userId || '');
    req.flash('success', 'Período abierto. Ya puedes calcularlo en pre-nómina / pre-cálculo.');
    return res.redirect(`/prenomina-periodos/${req.params.id}`);
  } catch (err) {
    const msgs = {
      PERIOD_NOT_FOUND: 'Período no encontrado',
      PERIOD_NOT_PENDING: 'Solo períodos pendientes pueden abrirse',
      PERIOD_OTHER_OPEN: 'Ya hay otro período abierto del mismo tipo; ciérralo antes',
      PERIOD_PREVIOUS_NOT_CLOSED: 'El período anterior aún no está cerrado'
    };
    req.flash('error', msgs[err.message] || err.message || 'No se pudo abrir el período');
    return res.redirect(req.get('Referer') || '/prenomina-periodos');
  }
}

module.exports = {
  listPeriodos,
  createPeriodo,
  showPeriodo,
  abrirPeriodoAction,
  calcularPeriodo,
  reprocesarAsistenciaPeriodo,
  cerrarPeriodo,
  showComprobante,
  aplicarAjuste,
  listConceptos,
  newConcepto,
  createConcepto,
  editConcepto,
  updateConcepto,
  toggleConcepto
};
