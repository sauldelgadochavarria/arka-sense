'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const {
  parseOptionalObjectId,
  parseDate,
  parseCheckbox,
  toDateInputValue
} = require('../libs/formHelpers');
const getEmpleadoModel = require('../models/empleado');
const getSubsidiariaModel = require('../models/subsidiaria');
const getConceptoNominaModel = require('../models/conceptoNomina');
const {
  ESTATUS_DESCUENTO,
  MODALIDADES,
  PERIODICIDADES
} = require('../models/descuentoProgramado');
const { userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');
const {
  SECCIONES_NOMINA,
  MODULO_NOMINA
} = require('../config/nomina');
const dp = require('../services/nomina/descuentoProgramadoService');

function canView(session) {
  return userCanViewNomina(session) || userCanEditNomina(session);
}

function canEdit(session) {
  return userCanEditNomina(session);
}

function flashRedirect(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function usuarioFromSession(session) {
  return {
    userId: session?.userId || session?.user?._id || '',
    userLabel: session?.userName || session?.user?.email || session?.email || ''
  };
}

function money(n) {
  return Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

async function index(req, res) {
  if (!canView(req.session)) return res.status(403).send('Sin permiso');
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const tenantId = req.session.tenantId;
  const estatus = (req.query.estatus || '').trim() || null;
  const conceptoCodigo = (req.query.concepto || '').trim() || null;
  const subsidiariaId = parseOptionalObjectId(req.query.subsidiariaId);

  const [descuentos, conceptos, subsidiarias, configEmpresa] = await Promise.all([
    dp.listarDescuentos(tenantId, {
      empresaId: empresa?._id,
      estatus,
      conceptoCodigo,
      subsidiariaId,
      limit: 300
    }),
    dp.conceptosHabilitadosCatalogo(tenantId),
    (async () => {
      if (!empresa) return [];
      const Subsidiaria = await getSubsidiariaModel();
      return Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean();
    })(),
    empresa ? dp.resolverConfig(tenantId, empresa._id, null) : null
  ]);

  const Empleado = await getEmpleadoModel();
  const empIds = [...new Set(descuentos.map((d) => String(d.empleadoId)))];
  const empleados = empIds.length
    ? await Empleado.find({ _id: { $in: empIds } })
        .select('numEmpleado firstName lastName')
        .lean()
    : [];
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  const items = descuentos.map((d) => {
    const e = empMap.get(String(d.empleadoId));
    return {
      ...d,
      empleadoLabel: e
        ? `${e.numEmpleado} ${e.firstName || ''} ${e.lastName || ''}`.trim()
        : String(d.empleadoId)
    };
  });

  res.render('Nomina/descuentos-programados/index', {
    session: req.session,
    empresa,
    items,
    conceptos,
    subsidiarias,
    configEmpresa,
    filtros: { estatus, conceptoCodigo, subsidiariaId: subsidiariaId || '' },
    estatusLabels: Object.fromEntries(ESTATUS_DESCUENTO.map((e) => [e, e])),
    money,
    canEdit: canEdit(req.session),
    secciones: SECCIONES_NOMINA,
    modulo: MODULO_NOMINA
  });
}

async function configForm(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) return flashRedirect(req, res, '/nomina/descuentos-programados', 'error', 'Sin empresa');

  const tenantId = req.session.tenantId;
  const subsidiariaId = parseOptionalObjectId(req.query.subsidiariaId);
  const Subsidiaria = await getSubsidiariaModel();
  const Concepto = await getConceptoNominaModel();

  const [subsidiarias, config, conceptosDed] = await Promise.all([
    Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean(),
    dp.resolverConfig(tenantId, empresa._id, subsidiariaId),
    Concepto.find({
      tenantId,
      tipo: 'deduccion',
      activo: true
    })
      .sort({ codigo: 1 })
      .lean()
  ]);

  const cfgMap = new Map((config?.conceptos || []).map((c) => [c.conceptoCodigo, c]));

  res.render('Nomina/descuentos-programados/config', {
    session: req.session,
    empresa,
    subsidiarias,
    subsidiariaId: subsidiariaId || '',
    config: config || { moduloActivo: false, conceptos: [], notas: '' },
    conceptos: conceptosDed.map((c) => ({
      ...c,
      cfg: cfgMap.get(c.codigo) || {
        activo: false,
        generaSaldo: Boolean(c.descuentoProgramado?.permiteSaldo),
        aplicaAutomatico: true,
        permiteParcial: Boolean(c.descuentoProgramado?.permiteParcial)
      }
    })),
    money
  });
}

async function saveConfig(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  if (!empresa) return flashRedirect(req, res, '/nomina/descuentos-programados', 'error', 'Sin empresa');

  const subsidiariaId = parseOptionalObjectId(req.body.subsidiariaId);
  const codigos = [].concat(req.body.conceptoCodigo || []);
  const conceptos = codigos.map((codigo) => ({
    conceptoCodigo: codigo,
    activo: parseCheckbox(req.body, `activo_${codigo}`),
    generaSaldo: parseCheckbox(req.body, `generaSaldo_${codigo}`),
    aplicaAutomatico: parseCheckbox(req.body, `aplicaAutomatico_${codigo}`),
    permiteParcial: parseCheckbox(req.body, `permiteParcial_${codigo}`)
  }));

  // Also mark catalog flags for checked "permite" concepts
  const Concepto = await getConceptoNominaModel();
  for (const c of conceptos) {
    if (c.activo) {
      await Concepto.updateOne(
        { tenantId: req.session.tenantId, codigo: c.conceptoCodigo },
        {
          $set: {
            'descuentoProgramado.permite': true,
            'descuentoProgramado.permiteSaldo': c.generaSaldo,
            'descuentoProgramado.permiteParcial': c.permiteParcial
          }
        }
      );
    }
  }

  await dp.upsertConfig({
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    subsidiariaId,
    moduloActivo: parseCheckbox(req.body, 'moduloActivo'),
    conceptos: conceptos.filter((c) => c.activo),
    notas: req.body.notas || '',
    usuario: usuarioFromSession(req.session)
  });

  const q = subsidiariaId ? `?subsidiariaId=${subsidiariaId}` : '';
  return flashRedirect(
    req,
    res,
    `/nomina/descuentos-programados/config${q}`,
    'success',
    'Configuración de descuentos programados guardada'
  );
}

async function nuevoForm(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const tenantId = req.session.tenantId;
  const Empleado = await getEmpleadoModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [empleados, conceptos, subsidiarias] = await Promise.all([
    Empleado.find({ tenantId, empresaId: empresa._id, activo: true, estatus: 'activo' })
      .select('numEmpleado firstName lastName subsidiariaId')
      .sort({ numEmpleado: 1 })
      .lean(),
    dp.conceptosHabilitadosCatalogo(tenantId),
    Subsidiaria.find({ empresaId: empresa._id, activo: true }).sort({ nombre: 1 }).lean()
  ]);

  res.render('Nomina/descuentos-programados/nuevo', {
    session: req.session,
    empresa,
    empleados,
    conceptos,
    subsidiarias,
    modalidades: MODALIDADES,
    periodicidades: PERIODICIDADES,
    toDateInputValue,
    hoy: toDateInputValue(new Date())
  });
}

async function create(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  try {
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    if (!empleadoId) throw new Error('Selecciona un empleado');
    const Empleado = await getEmpleadoModel();
    const emp = await Empleado.findOne({ _id: empleadoId, tenantId: req.session.tenantId }).lean();
    if (!emp) throw new Error('Empleado no encontrado');

    const doc = await dp.crearDescuento(
      {
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        subsidiariaId: parseOptionalObjectId(req.body.subsidiariaId) || emp.subsidiariaId || null,
        empleadoId,
        conceptoCodigo: req.body.conceptoCodigo,
        fechaInicio: parseDate(req.body.fechaInicio) || new Date(),
        fechaTermino: parseDate(req.body.fechaTermino),
        montoOriginal: Number(req.body.montoOriginal) || 0,
        saldoPendiente:
          req.body.saldoPendiente !== '' && req.body.saldoPendiente != null
            ? Number(req.body.saldoPendiente)
            : undefined,
        importePorPeriodo: Number(req.body.importePorPeriodo) || 0,
        modalidad: req.body.modalidad || 'monto_fijo',
        porcentaje: Number(req.body.porcentaje) || 0,
        basePorcentaje: req.body.basePorcentaje || 'sueldo_periodo',
        importeVariable:
          req.body.importeVariable !== '' && req.body.importeVariable != null
            ? Number(req.body.importeVariable)
            : null,
        periodicidad: req.body.periodicidad || 'cada_periodo',
        numeroPagos: req.body.numeroPagos,
        observaciones: req.body.observaciones || ''
      },
      usuarioFromSession(req.session)
    );

    return flashRedirect(
      req,
      res,
      `/nomina/descuentos-programados/${doc._id}`,
      'success',
      'Descuento programado registrado'
    );
  } catch (err) {
    return flashRedirect(
      req,
      res,
      '/nomina/descuentos-programados/nuevo',
      'error',
      err.message || 'Error al crear'
    );
  }
}

async function show(req, res) {
  if (!canView(req.session)) return res.status(403).send('Sin permiso');
  const tenantId = req.session.tenantId;
  const Model = await require('../models/descuentoProgramado')();
  const doc = await Model.findOne({ _id: req.params.id, tenantId }).lean();
  if (!doc) return flashRedirect(req, res, '/nomina/descuentos-programados', 'error', 'No encontrado');

  const Empleado = await getEmpleadoModel();
  const Concepto = await getConceptoNominaModel();
  const getPeriodoNominaModel = require('../models/periodoNomina');
  const [empleado, concepto, movimientosRaw] = await Promise.all([
    Empleado.findById(doc.empleadoId).select('numEmpleado firstName lastName').lean(),
    Concepto.findOne({ tenantId, codigo: doc.conceptoCodigo }).lean(),
    dp.listarMovimientos(tenantId, { descuentoId: doc._id, limit: 80 })
  ]);

  const periodoIds = [
    ...new Set(
      (movimientosRaw || [])
        .map((m) => (m.periodoId ? String(m.periodoId) : ''))
        .filter(Boolean)
    )
  ];
  let periodoMap = new Map();
  if (periodoIds.length) {
    const Periodo = await getPeriodoNominaModel();
    const periodos = await Periodo.find({ tenantId, _id: { $in: periodoIds } })
      .select('numeroPeriodo tipoPeriodo tipoNomina fechaInicio fechaFin anio')
      .lean();
    periodoMap = new Map(periodos.map((p) => [String(p._id), p]));
  }

  const movimientos = (movimientosRaw || []).map((m) => {
    const p = m.periodoId ? periodoMap.get(String(m.periodoId)) : null;
    const numeroNomina =
      m.numeroPeriodo != null
        ? m.numeroPeriodo
        : p && p.numeroPeriodo != null
          ? p.numeroPeriodo
          : null;
    return {
      ...m,
      numeroNomina,
      periodoLabel:
        numeroNomina != null
          ? `#${numeroNomina}${p && p.tipoPeriodo ? ' · ' + p.tipoPeriodo : ''}`
          : null
    };
  });

  res.render('Nomina/descuentos-programados/show', {
    session: req.session,
    doc,
    empleado,
    concepto,
    movimientos,
    money,
    toDateInputValue,
    canEdit: canEdit(req.session),
    estatusLabels: Object.fromEntries(ESTATUS_DESCUENTO.map((e) => [e, e]))
  });
}

async function suspender(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  try {
    await dp.cambiarEstatus(req.params.id, req.session.tenantId, 'suspendido', usuarioFromSession(req.session));
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'success', 'Suspendido');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'error', err.message);
  }
}

async function reactivar(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  try {
    await dp.cambiarEstatus(req.params.id, req.session.tenantId, 'activo', usuarioFromSession(req.session));
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'success', 'Reactivado');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'error', err.message);
  }
}

async function cancelar(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  try {
    await dp.cambiarEstatus(req.params.id, req.session.tenantId, 'cancelado', usuarioFromSession(req.session));
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'success', 'Cancelado');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'error', err.message);
  }
}

async function ajusteSaldo(req, res) {
  if (!canEdit(req.session)) return res.status(403).send('Sin permiso');
  try {
    const nuevo = Number(req.body.saldoPendiente);
    if (Number.isNaN(nuevo) || nuevo < 0) throw new Error('Saldo inválido');
    await dp.ajustarSaldo(
      req.params.id,
      req.session.tenantId,
      nuevo,
      usuarioFromSession(req.session),
      req.body.mensaje || ''
    );
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'success', 'Saldo ajustado');
  } catch (err) {
    return flashRedirect(req, res, `/nomina/descuentos-programados/${req.params.id}`, 'error', err.message);
  }
}

module.exports = {
  index,
  configForm,
  saveConfig,
  nuevoForm,
  create,
  show,
  suspender,
  reactivar,
  cancelar,
  ajusteSaldo
};
