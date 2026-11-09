'use strict';

const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { trimString, parseOptionalObjectId, parseDate } = require('../libs/formHelpers');
const getEmpleadoModel = require('../models/empleado');
const getMenuModel = require('../models/menu');
const getHistorialLaboralModel = require('../models/historialLaboral');
const { models: isnModels } = require('../models/isn');
const getSubsidiariaModel = require('../models/subsidiaria');
const { userCanEditCumplimiento, userCanViewCumplimiento } = require('../libs/roleAccess');
const {
  auditar,
  sincronizarDescuentoCredito,
  armarConciliacionMes,
  filasCsv
} = require('../services/cumplimientoPatronalService');
const {
  models,
  TIPOS_AFILIATORIOS,
  NATURALEZAS_SALARIO,
  ESTATUS_AFILIATORIO,
  TIPOS_DESCUENTO_CREDITO,
  PERIODICIDADES_CREDITO,
  RUBROS_EBA,
  ESTATUS_CREDITO,
  AVISOS_INFONAVIT,
  AVISOS_FONACOT,
  OBLIGACIONES,
  ESTATUS_CONCILIACION
} = require('../models/cumplimientoPatronal');

const TABS = ['imss', 'infonavit', 'fonacot', 'conciliacion', 'centros', 'auditoria'];

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function optionalMoney(v) {
  if (v === '' || v == null) return null;
  return money(v);
}

function usuario(req) {
  return String(req.session.userLabel || req.session.userid || req.session.userId || '').trim();
}

function nombreEmpleado(emp) {
  if (!emp) return '';
  const sat = String(emp.nombreSat || '').trim();
  if (sat) return sat;
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
}

async function ensureMenu() {
  const Menu = await getMenuModel();
  const nomina = await Menu.findOne({
    menuPrincipal: 'Nómina',
    esCategoria: true,
    parentId: null,
    activo: { $ne: false }
  }).lean();
  if (!nomina) return;
  const cumpl = await Menu.findOne({
    menuPrincipal: 'Cumplimiento',
    parentId: nomina._id,
    esCategoria: true
  }).lean();
  if (!cumpl) return;
  const items = [
    { menuPrincipal: 'Avisos IMSS', rutaApp: '/nomina/cumplimiento-patronal?tab=imss', orden: 44 },
    { menuPrincipal: 'INFONAVIT', rutaApp: '/nomina/cumplimiento-patronal?tab=infonavit', orden: 45 },
    { menuPrincipal: 'FONACOT', rutaApp: '/nomina/cumplimiento-patronal?tab=fonacot', orden: 46 }
  ];
  for (const item of items) {
    const data = {
      ...item,
      parentId: cumpl._id,
      activo: true,
      esCategoria: false,
      requiredFeatureKeys: ['nomina'],
      roles: []
    };
    const existing = await Menu.findOne({ rutaApp: item.rutaApp }).lean();
    if (existing) await Menu.updateOne({ _id: existing._id }, { $set: data });
    else await Menu.create(data);
  }
  await Menu.updateMany(
    { parentId: cumpl._id, rutaApp: '/nomina/cumplimiento-patronal' },
    { $set: { activo: false } }
  );
}

const PAGE_CREDITOS = 40;

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function etiquetaTrabajador(emp) {
  if (!emp) return 'Trabajador no encontrado';
  const nom = (emp.nombreSat || `${emp.firstName || ''} ${emp.lastName || ''}`).trim();
  return `${emp.numEmpleado || ''} ${nom}`.trim();
}

async function empleadosScope(req, empresa) {
  const Empleado = await getEmpleadoModel();
  const subId = sessionSubsidiariaId(req);
  const q = { tenantId: req.session.tenantId, empresaId: empresa._id };
  if (subId) q.subsidiariaId = subId;
  return Empleado.find(q)
    .select('numEmpleado firstName lastName nombreSat subsidiariaId')
    .sort({ numEmpleado: 1 })
    .limit(800)
    .lean();
}

async function empleadoEnPlaza(req, empresa, { empleadoId = null, numEmpleado = '' } = {}) {
  const Empleado = await getEmpleadoModel();
  const q = { tenantId: req.session.tenantId, empresaId: empresa._id };
  const subId = sessionSubsidiariaId(req);
  if (subId) q.subsidiariaId = subId;
  const id = parseOptionalObjectId(empleadoId);
  if (id) {
    return Empleado.findOne({ ...q, _id: id })
      .select('numEmpleado firstName lastName nombreSat subsidiariaId')
      .lean();
  }
  const num = trimString(numEmpleado);
  if (!num) return null;
  const exacto = await Empleado.findOne({ ...q, numEmpleado: num })
    .select('numEmpleado firstName lastName nombreSat subsidiariaId')
    .lean();
  if (exacto || !/^\d+$/.test(num)) return exacto;
  return Empleado.findOne({ ...q, numEmpleado: new RegExp(`^0*${num}$`) })
    .select('numEmpleado firstName lastName nombreSat subsidiariaId')
    .lean();
}

async function listarCreditosPagina(req, empresa, institucion) {
  const { CreditoTrabajador } = await models();
  const Empleado = await getEmpleadoModel();
  const tenantId = req.session.tenantId;
  const subId = sessionSubsidiariaId(req);
  const q = trimString(req.query.q).slice(0, 60);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const plaza = { tenantId, empresaId: empresa._id };
  if (subId) plaza.subsidiariaId = subId;
  const idsPlaza = await Empleado.find(plaza).distinct('_id');
  const filter = { tenantId, empresaId: empresa._id, institucion, empleadoId: { $in: idsPlaza } };
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const idsBusqueda = await Empleado.find({
      ...plaza,
      $or: [{ numEmpleado: rx }, { firstName: rx }, { lastName: rx }, { nombreSat: rx }]
    }).distinct('_id');
    filter.$or = [{ numeroCredito: rx }, { empleadoId: { $in: idsBusqueda } }];
  }
  const total = await CreditoTrabajador.countDocuments(filter);
  const pages = Math.max(1, Math.ceil(total / PAGE_CREDITOS));
  const pagina = Math.min(page, pages);
  const rows = await CreditoTrabajador.find(filter)
    .sort({ numeroCredito: 1 })
    .skip((pagina - 1) * PAGE_CREDITOS)
    .limit(PAGE_CREDITOS)
    .lean();
  const emps = await Empleado.find({ _id: { $in: rows.map((c) => c.empleadoId) } })
    .select('numEmpleado firstName lastName nombreSat')
    .lean();
  const porId = new Map(emps.map((e) => [String(e._id), e]));
  return {
    creditos: rows.map((c) => ({ ...c, trabajador: etiquetaTrabajador(porId.get(String(c.empleadoId))) })),
    creditosMeta: { q, page: pagina, pages, total, pageSize: PAGE_CREDITOS }
  };
}

function empleadoPermitido(empleados, id) {
  return empleados.some((e) => String(e._id) === String(id));
}

function exigirEdicion(req, res, tab) {
  if (userCanEditCumplimiento(req.session)) return true;
  req.flash('error', 'Tu rol solo puede consultar el cumplimiento.');
  res.redirect(`/nomina/cumplimiento-patronal?tab=${tab}`);
  return false;
}

async function index(req, res) {
  await ensureMenu().catch(() => {});
  if (!userCanViewCumplimiento(req.session)) {
    req.flash('error', 'No tienes acceso al cumplimiento patronal.');
    return res.redirect('/dashboard');
  }
  const { empresa, error } = await requireEmpresaForTenant(req);
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'imss';
  const vacio = {
    empresa: null,
    error,
    tab,
    session: req.session,
    canEdit: userCanEditCumplimiento(req.session),
    empleados: [],
    patronales: [],
    subsidiarias: [],
    movimientos: [],
    creditos: [],
    creditosMeta: { q: '', page: 1, pages: 1, total: 0, pageSize: PAGE_CREDITOS },
    avisos: [],
    conciliaciones: [],
    centros: [],
    asignaciones: [],
    auditoria: [],
    comparacionesEba: [],
    catalogos: {}
  };
  if (!empresa) {
    return res.render('Nomina/cumplimiento/index', vacio);
  }

  const {
    MovimientoAfiliatorio,
    ConciliacionObligacion,
    CentroTrabajo,
    TrabajadorAsignacion,
    AuditoriaCumplimiento,
    ComparacionEba
  } = await models();
  const { RegistroPatronal } = await isnModels();
  const Subsidiaria = await getSubsidiariaModel();
  const subId = sessionSubsidiariaId(req);
  const base = { tenantId: req.session.tenantId, empresaId: empresa._id };
  const scope = subId ? { ...base, subsidiariaId: subId } : base;
  const institucion = tab === 'fonacot' ? 'FONACOT' : 'INFONAVIT';

  const [empleados, patronales, movimientos, conciliaciones, subsidiarias, centros, asignaciones, auditoria, comparacionesEba] =
    await Promise.all([
    tab === 'imss' || tab === 'centros' ? empleadosScope(req, empresa) : [],
    RegistroPatronal.find({ ...base, activo: { $ne: false } }).sort({ numero: 1 }).lean(),
    tab === 'imss'
      ? MovimientoAfiliatorio.find(scope).sort({ fechaEfectiva: -1 }).limit(200).lean()
      : [],
    tab === 'conciliacion'
      ? ConciliacionObligacion.find(base).sort({ anio: -1, mes: -1 }).limit(200).lean()
      : [],
    tab === 'centros'
      ? Subsidiaria.find({ empresaId: empresa._id, activo: { $ne: false } }).select('nombre').sort({ nombre: 1 }).lean()
      : [],
    tab === 'centros' ? CentroTrabajo.find(base).sort({ clave: 1 }).lean() : [],
    tab === 'centros'
      ? TrabajadorAsignacion.find(scope).sort({ fechaInicio: -1 }).limit(300).lean()
      : [],
    tab === 'auditoria'
      ? AuditoriaCumplimiento.find(base).sort({ createdAt: -1 }).limit(200).lean()
      : [],
    tab === 'infonavit'
      ? ComparacionEba.find(base).sort({ anio: -1, bimestre: -1, rubro: 1 }).limit(200).lean()
      : []
  ]);
  const paginaCreditos =
    tab === 'infonavit' || tab === 'fonacot'
      ? await listarCreditosPagina(req, empresa, institucion)
      : { creditos: [], creditosMeta: { q: '', page: 1, pages: 1, total: 0, pageSize: PAGE_CREDITOS } };
  const avisos = [];

  res.render('Nomina/cumplimiento/index', {
    empresa,
    error: error || null,
    tab,
    session: req.session,
    canEdit: userCanEditCumplimiento(req.session),
    empleados,
    patronales,
    subsidiarias,
    movimientos,
    creditos: paginaCreditos.creditos,
    creditosMeta: paginaCreditos.creditosMeta,
    avisos,
    conciliaciones,
    centros,
    asignaciones,
    auditoria,
    comparacionesEba,
    catalogos: {
      tiposAfiliatorios: TIPOS_AFILIATORIOS,
      naturalezas: NATURALEZAS_SALARIO,
      estatusAfiliatorio: ESTATUS_AFILIATORIO,
      tiposDescuento: TIPOS_DESCUENTO_CREDITO,
      periodicidades: PERIODICIDADES_CREDITO,
      rubrosEba: RUBROS_EBA,
      estatusCredito: ESTATUS_CREDITO,
      avisosInfonavit: AVISOS_INFONAVIT,
      avisosFonacot: AVISOS_FONACOT,
      obligaciones: OBLIGACIONES,
      estatusConciliacion: ESTATUS_CONCILIACION
    }
  });
}

async function guardarMovimiento(req, res) {
  if (!exigirEdicion(req, res, 'imss')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const tipo = trimString(req.body.tipo).toUpperCase();
    if (!TIPOS_AFILIATORIOS.includes(tipo)) throw new Error('Tipo de aviso IMSS no válido');
    const naturaleza = trimString(req.body.naturalezaSalario).toLowerCase();
    if (tipo === 'MODIFICACION_SALARIAL' && !NATURALEZAS_SALARIO.includes(naturaleza)) {
      throw new Error('La modificación salarial indica si el salario es fijo, variable o mixto');
    }
    const empleados = await empleadosScope(req, empresa);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    if (!empleadoId || !empleadoPermitido(empleados, empleadoId)) {
      throw new Error('El trabajador no pertenece a la subsidiaria activa');
    }
    const fechaEfectiva = parseDate(req.body.fechaEfectiva);
    if (!fechaEfectiva) throw new Error('Fecha efectiva requerida');

    let historialLaboralId = null;
    if (trimString(req.body.vincularHistorial) === '1') {
      const Historial = await getHistorialLaboralModel();
      const ultimo = await Historial.findOne({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        empleadoId
      })
        .sort({ fechaMovimiento: -1 })
        .select('_id')
        .lean();
      historialLaboralId = ultimo ? ultimo._id : null;
    }

    const { MovimientoAfiliatorio } = await models();
    await MovimientoAfiliatorio.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req),
      empleadoId,
      registroPatronalId: parseOptionalObjectId(req.body.registroPatronalId),
      historialLaboralId,
      tipo,
      naturalezaSalario: tipo === 'MODIFICACION_SALARIAL' ? naturaleza : '',
      fechaEfectiva,
      sbcAnterior: optionalMoney(req.body.sbcAnterior),
      sbcNuevo: optionalMoney(req.body.sbcNuevo),
      estatus: 'pendiente',
      notas: trimString(req.body.notas),
      registradoPor: usuario(req)
    });
    req.flash('success', 'Aviso afiliatorio registrado. Sigue pendiente hasta que se envíe y el IMSS lo acepte.');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo registrar el aviso');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=imss');
}

async function estatusMovimiento(req, res) {
  if (!exigirEdicion(req, res, 'imss')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const estatus = trimString(req.body.estatus).toLowerCase();
    if (!ESTATUS_AFILIATORIO.includes(estatus)) throw new Error('Estado no válido');
    const { MovimientoAfiliatorio } = await models();
    const doc = await MovimientoAfiliatorio.findOne({
      _id: req.params.id,
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
    if (!doc) throw new Error('Aviso no encontrado');
    const anterior = doc.estatus;
    doc.estatus = estatus;
    doc.resultado = trimString(req.body.resultado);
    doc.acuseReferencia = trimString(req.body.acuseReferencia);
    if (estatus === 'enviado' || estatus === 'aceptado' || estatus === 'rechazado') {
      doc.fechaEnvio = doc.fechaEnvio || new Date();
    }
    await doc.save();
    await auditar({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      entidad: 'movimiento_imss',
      entidadId: doc._id,
      campo: 'estatus',
      valorAnterior: anterior,
      valorNuevo: estatus,
      motivo: trimString(req.body.resultado),
      usuario: usuario(req)
    });
    req.flash('success', 'Estado del aviso actualizado. Generarlo no significa que el IMSS lo haya aceptado.');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo actualizar el aviso');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=imss');
}

async function guardarCredito(req, res) {
  const institucion = trimString(req.body.institucion).toUpperCase() === 'FONACOT' ? 'FONACOT' : 'INFONAVIT';
  const tab = institucion === 'FONACOT' ? 'fonacot' : 'infonavit';
  if (!exigirEdicion(req, res, tab)) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const trabajador = await empleadoEnPlaza(req, empresa, {
      empleadoId: req.body.empleadoId,
      numEmpleado: req.body.numEmpleado
    });
    if (!trabajador) throw new Error('El trabajador no pertenece a la subsidiaria activa');
    const empleadoId = trabajador._id;
    const tipoDescuento = trimString(req.body.tipoDescuento);
    if (!TIPOS_DESCUENTO_CREDITO.includes(tipoDescuento)) throw new Error('Tipo de descuento no válido');
    const numeroCredito = trimString(req.body.numeroCredito);
    if (!numeroCredito) throw new Error('Número de crédito requerido');
    const fechaInicio = parseDate(req.body.fechaInicio);
    if (!fechaInicio) throw new Error('Fecha de inicio requerida');

    const { CreditoTrabajador, CreditoAviso } = await models();
    const credito = await CreditoTrabajador.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: sessionSubsidiariaId(req),
      empleadoId,
      institucion,
      numeroCredito,
      tipoDescuento,
      valorDescuento: money(req.body.valorDescuento),
      fechaInicio,
      fechaFin: parseDate(req.body.fechaFin),
      periodicidad: PERIODICIDADES_CREDITO.includes(trimString(req.body.periodicidad))
        ? trimString(req.body.periodicidad)
        : 'cada_periodo',
      documentoOrigen: trimString(req.body.documentoOrigen),
      fechaVigencia: parseDate(req.body.fechaVigencia),
      importeRetenido: money(req.body.importeRetenido),
      importeDeterminado: money(req.body.importeDeterminado),
      importeEnterado: money(req.body.importeEnterado),
      notas: trimString(req.body.notas),
      registradoPor: usuario(req)
    });
    await CreditoAviso.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      creditoId: credito._id,
      institucion,
      tipoAviso: institucion === 'FONACOT' ? 'FONACOT_ALTA_CREDITO' : 'RETENCION',
      fechaRecepcion: fechaInicio,
      fechaAplicacion: fechaInicio,
      valorNuevo: credito.valorDescuento,
      registradoPor: usuario(req)
    });
    let extra = '';
    try {
      const vinculo = await sincronizarDescuentoCredito(credito, {
        userId: req.session.userid || req.session.userId || '',
        userLabel: usuario(req)
      });
      extra = vinculo.mensaje;
    } catch (syncErr) {
      extra = syncErr.message || 'No se vinculó el descuento de nómina.';
    }
    req.flash('success', `Crédito ${institucion} registrado. ${extra}`);
    return res.redirect(`/nomina/cumplimiento-patronal/creditos/${credito._id}`);
  } catch (err) {
    const msg = err.code === 11000 ? 'Ese número de crédito ya existe en la empresa' : err.message;
    req.flash('error', msg || 'No se pudo registrar el crédito');
  }
  const vuelta = trimString(req.body.empleadoId);
  res.redirect(`/nomina/cumplimiento-patronal/creditos/nuevo?institucion=${tab === 'fonacot' ? 'FONACOT' : 'INFONAVIT'}${vuelta ? `&empleadoId=${vuelta}` : ''}`);
}

async function avisoCredito(req, res) {
  let tab = 'infonavit';
  if (!exigirEdicion(req, res, tab)) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const { CreditoTrabajador, CreditoAviso } = await models();
    const credito = await CreditoTrabajador.findOne({
      _id: req.body.creditoId,
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
    if (!credito) throw new Error('Crédito no encontrado');
    tab = credito.institucion === 'FONACOT' ? 'fonacot' : 'infonavit';
    const permitidos = credito.institucion === 'FONACOT' ? AVISOS_FONACOT : AVISOS_INFONAVIT;
    const tipoAviso = trimString(req.body.tipoAviso).toUpperCase();
    if (!permitidos.includes(tipoAviso)) throw new Error('Tipo de aviso no corresponde a la institución');

    const valorAnterior = credito.valorDescuento;
    const valorNuevo = req.body.valorNuevo === '' ? null : money(req.body.valorNuevo);
    await CreditoAviso.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      creditoId: credito._id,
      institucion: credito.institucion,
      tipoAviso,
      fechaRecepcion: parseDate(req.body.fechaRecepcion),
      fechaAplicacion: parseDate(req.body.fechaAplicacion),
      valorAnterior,
      valorNuevo,
      documentoReferencia: trimString(req.body.documentoReferencia),
      numeroCedula: trimString(req.body.numeroCedula),
      periodoCedula: trimString(req.body.periodoCedula),
      importeCedula: req.body.importeCedula === '' ? null : money(req.body.importeCedula),
      notas: trimString(req.body.notas),
      registradoPor: usuario(req)
    });
    if (valorNuevo != null) credito.valorDescuento = valorNuevo;
    if (tipoAviso.includes('SUSPENSION')) credito.estatus = 'suspendido';
    if (tipoAviso.includes('LIQUIDACION')) {
      credito.estatus = 'liquidado';
      credito.fechaFin = credito.fechaFin || new Date();
    }
    if (tipoAviso === 'FONACOT_BAJA') credito.estatus = 'cancelado';
    if (tipoAviso === 'REINICIO' || tipoAviso === 'FONACOT_ALTA_CREDITO') credito.estatus = 'activo';
    if (req.body.importeRetenido !== '') credito.importeRetenido = money(req.body.importeRetenido);
    if (req.body.importeDeterminado !== '') credito.importeDeterminado = money(req.body.importeDeterminado);
    if (req.body.importeEnterado !== '') credito.importeEnterado = money(req.body.importeEnterado);
    await credito.save();
    await auditar({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      entidad: 'credito',
      entidadId: credito._id,
      campo: 'aviso',
      valorAnterior,
      valorNuevo: valorNuevo == null ? valorAnterior : valorNuevo,
      motivo: tipoAviso,
      usuario: usuario(req)
    });
    let extra = '';
    try {
      const vinculo = await sincronizarDescuentoCredito(credito, {
        userId: req.session.userid || req.session.userId || '',
        userLabel: usuario(req)
      });
      extra = vinculo.mensaje;
    } catch (syncErr) {
      extra = syncErr.message || 'No se vinculó el descuento de nómina.';
    }
    req.flash('success', `Aviso registrado. ${extra}`);
    return res.redirect(`/nomina/cumplimiento-patronal/creditos/${credito._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo registrar el aviso');
  }
  const creditoId = parseOptionalObjectId(req.body.creditoId);
  res.redirect(creditoId ? `/nomina/cumplimiento-patronal/creditos/${creditoId}` : `/nomina/cumplimiento-patronal?tab=${tab}`);
}

async function guardarConciliacion(req, res) {
  if (!exigirEdicion(req, res, 'conciliacion')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const obligacion = trimString(req.body.obligacion).toUpperCase();
    if (!OBLIGACIONES.includes(obligacion)) throw new Error('Obligación no válida');
    const anio = Number(req.body.anio);
    const mes = Number(req.body.mes);
    if (!anio || mes < 1 || mes > 12) throw new Error('Periodo no válido');
    const importeCalculado = money(req.body.importeCalculado);
    const importeOficial = money(req.body.importeOficial);
    const estatus = ESTATUS_CONCILIACION.includes(trimString(req.body.estatus))
      ? trimString(req.body.estatus)
      : 'pendiente';
    const { ConciliacionObligacion } = await models();
    await ConciliacionObligacion.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      obligacion,
      anio,
      mes,
      registroPatronal: trimString(req.body.registroPatronal).toUpperCase(),
      entidad: trimString(req.body.entidad).toUpperCase(),
      importeCalculado,
      importeOficial,
      diferencia: money(importeCalculado - importeOficial),
      motivo: trimString(req.body.motivo),
      estatus,
      responsable: usuario(req),
      fechaResolucion: estatus === 'resuelta' ? new Date() : null
    });
    req.flash('success', 'Conciliación registrada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo registrar la conciliación');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=conciliacion');
}

function diaAnterior(fecha) {
  const x = new Date(fecha);
  x.setUTCDate(x.getUTCDate() - 1);
  return x;
}

async function guardarCentro(req, res) {
  if (!exigirEdicion(req, res, 'centros')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const clave = trimString(req.body.clave).toUpperCase();
    const nombre = trimString(req.body.nombre);
    if (!clave || !nombre) throw new Error('Clave y nombre del centro de trabajo son obligatorios');
    const { CentroTrabajo } = await models();
    await CentroTrabajo.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: parseOptionalObjectId(req.body.subsidiariaId),
      registroPatronalId: parseOptionalObjectId(req.body.registroPatronalId),
      clave,
      nombre,
      entidadFederativa: trimString(req.body.entidadFederativa).toUpperCase(),
      activo: true
    });
    req.flash('success', 'Centro de trabajo registrado. La sucursal no lo sustituye.');
  } catch (err) {
    const msg = err.code === 11000 ? 'Ya existe un centro con esa clave' : err.message;
    req.flash('error', msg || 'No se pudo registrar el centro');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=centros');
}

async function guardarAsignacion(req, res) {
  if (!exigirEdicion(req, res, 'centros')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const empleados = await empleadosScope(req, empresa);
    const empleadoId = parseOptionalObjectId(req.body.empleadoId);
    if (!empleadoId || !empleadoPermitido(empleados, empleadoId)) {
      throw new Error('El trabajador no pertenece a la subsidiaria activa');
    }
    const fechaInicio = parseDate(req.body.fechaInicio);
    if (!fechaInicio) throw new Error('Fecha de inicio requerida');
    const porcentaje = Number(req.body.porcentajeAsignacion);
    if (!Number.isFinite(porcentaje) || porcentaje <= 0 || porcentaje > 100) {
      throw new Error('El porcentaje de asignación va de 0 a 100');
    }
    const { CentroTrabajo, TrabajadorAsignacion } = await models();
    const centro = await CentroTrabajo.findOne({
      _id: req.body.centroTrabajoId,
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
    if (!centro) throw new Error('Centro de trabajo no encontrado');
    const entidad = trimString(req.body.entidad).toUpperCase() || centro.entidadFederativa || '';
    if (porcentaje === 100) {
      const abiertas = await TrabajadorAsignacion.find({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        empleadoId,
        fechaFin: null
      });
      if (abiertas.some((a) => new Date(a.fechaInicio) >= fechaInicio)) {
        throw new Error('Hay una asignación vigente con fecha igual o posterior');
      }
      for (const a of abiertas) {
        a.fechaFin = diaAnterior(fechaInicio);
        await a.save();
      }
    }
    const asignacion = await TrabajadorAsignacion.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      empleadoId,
      centroTrabajoId: centro._id,
      subsidiariaId: centro.subsidiariaId || sessionSubsidiariaId(req),
      registroPatronalId: centro.registroPatronalId,
      entidad,
      porcentajeAsignacion: porcentaje,
      fechaInicio,
      criterioAsignacion: 'lugar_servicio',
      observaciones: trimString(req.body.observaciones),
      registradoPor: usuario(req)
    });
    const Empleado = await getEmpleadoModel();
    const emp = await Empleado.findOne({
      _id: empleadoId,
      tenantId: req.session.tenantId,
      empresaId: empresa._id
    });
    if (emp) {
      const centroAnterior = emp.centroTrabajoId ? String(emp.centroTrabajoId) : '';
      const entidadAnterior = emp.estadoTrabajo || '';
      emp.centroTrabajoId = centro._id;
      if (porcentaje === 100 && entidad) emp.estadoTrabajo = entidad;
      await emp.save();
      await auditar({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        entidad: 'asignacion',
        entidadId: asignacion._id,
        campo: 'centroTrabajoId',
        valorAnterior: centroAnterior,
        valorNuevo: String(centro._id),
        motivo: trimString(req.body.observaciones) || 'Nueva vigencia de centro de trabajo',
        usuario: usuario(req)
      });
      if (porcentaje === 100 && entidad && entidad !== entidadAnterior) {
        await auditar({
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          entidad: 'asignacion',
          entidadId: emp._id,
          campo: 'estadoTrabajo',
          valorAnterior: entidadAnterior,
          valorNuevo: entidad,
          motivo: 'Asignación al 100% del lugar donde presta el servicio',
          usuario: usuario(req)
        });
      }
    }
    req.flash(
      'success',
      porcentaje === 100
        ? 'Asignación registrada. La anterior quedó cerrada y el ISN del mes usa esta entidad si la vigencia cubre el día 15.'
        : 'Asignación parcial registrada. El ISN reparte el mes solo cuando las vigencias del día 15 suman 100%.'
    );
  } catch (err) {
    req.flash('error', err.message || 'No se pudo registrar la asignación');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=centros');
}

async function armarConciliacion(req, res) {
  if (!exigirEdicion(req, res, 'conciliacion')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const anio = Number(req.body.anio);
    const mes = Number(req.body.mes);
    if (!anio || mes < 1 || mes > 12) throw new Error('Periodo no válido');
    const resultado = await armarConciliacionMes({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      anio,
      mes,
      usuario: usuario(req)
    });
    req.flash(
      'success',
      `Conciliación del mes: ${resultado.creadas} nuevas, ${resultado.actualizadas} actualizadas. ${resultado.notas.join(' ')}`
    );
  } catch (err) {
    req.flash('error', err.message || 'No se pudo armar la conciliación');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=conciliacion');
}

async function importarConciliacion(req, res) {
  if (!exigirEdicion(req, res, 'conciliacion')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const filas = filasCsv(req.body.csv);
    if (!filas.length) throw new Error('El archivo no tiene filas');
    const { ConciliacionObligacion } = await models();
    let n = 0;
    for (const f of filas) {
      if (!OBLIGACIONES.includes(f.obligacion) || !f.anio || f.mes < 1 || f.mes > 12) continue;
      const ref = String(f.referencia || '').trim().toUpperCase();
      const entidad = f.obligacion === 'ISN' && ref.length === 2 ? ref : '';
      await ConciliacionObligacion.create({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        obligacion: f.obligacion,
        anio: f.anio,
        mes: f.mes,
        registroPatronal: entidad ? '' : ref,
        entidad,
        referencia: ref,
        importeCalculado: f.calculado,
        importeOficial: f.oficial,
        diferencia: money(f.calculado - f.oficial),
        motivo: 'Importación de emisión o cédula',
        origen: 'manual',
        estatus: 'pendiente',
        responsable: usuario(req)
      });
      n += 1;
    }
    if (!n) throw new Error('Ninguna fila tenía obligación, año y mes válidos');
    req.flash('success', `${n} filas importadas. Cada fila queda como conciliación pendiente.`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo importar');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=conciliacion');
}

const ETIQUETA_RUBRO = {
  trabajadores: 'Trabajadores',
  salarios: 'Salarios',
  dias_cotizados: 'Días cotizados',
  aportaciones: 'Aportaciones patronales',
  amortizaciones: 'Amortizaciones',
  creditos_activos: 'Créditos activos',
  descuentos_aplicados: 'Descuentos aplicados'
};

async function guardarEba(req, res) {
  if (!exigirEdicion(req, res, 'infonavit')) return;
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) throw new Error(error || 'Sin empresa');
    const anio = Number(req.body.anio);
    const bimestre = Number(req.body.bimestre);
    if (!anio || bimestre < 1 || bimestre > 6) throw new Error('Año y bimestre no válidos');
    const registroPatronal = trimString(req.body.registroPatronal).toUpperCase();
    const rubros = [].concat(req.body.rubro || []);
    const calculados = [].concat(req.body.calculado || []);
    const ebas = [].concat(req.body.eba || []);
    const { ComparacionEba } = await models();
    let n = 0;
    for (let i = 0; i < rubros.length; i += 1) {
      const rubro = trimString(rubros[i]);
      if (!RUBROS_EBA.includes(rubro)) continue;
      const calculado = money(calculados[i]);
      const eba = money(ebas[i]);
      await ComparacionEba.findOneAndUpdate(
        {
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          anio,
          bimestre,
          registroPatronal,
          rubro
        },
        {
          $set: {
            calculado,
            eba,
            diferencia: money(calculado - eba),
            registradoPor: usuario(req)
          }
        },
        { upsert: true, new: true }
      );
      n += 1;
    }
    if (!n) throw new Error('No hay rubros para comparar');
    req.flash('success', 'Comparación con la EBA guardada. Lo retenido en nómina sigue aparte de lo enterado.');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar la comparación');
  }
  res.redirect('/nomina/cumplimiento-patronal?tab=infonavit');
}

async function nuevoCredito(req, res) {
  if (!userCanViewCumplimiento(req.session)) {
    req.flash('error', 'No tienes acceso al cumplimiento patronal.');
    return res.redirect('/dashboard');
  }
  const { empresa, error } = await requireEmpresaForTenant(req);
  const institucion = trimString(req.query.institucion).toUpperCase() === 'FONACOT' ? 'FONACOT' : 'INFONAVIT';
  let trabajador = null;
  if (empresa) {
    trabajador = await empleadoEnPlaza(req, empresa, { empleadoId: req.query.empleadoId });
  }
  res.render('Nomina/cumplimiento/credito-nuevo', {
    empresa,
    error: error || null,
    session: req.session,
    canEdit: userCanEditCumplimiento(req.session),
    institucion,
    trabajador,
    catalogos: {
      tiposDescuento: TIPOS_DESCUENTO_CREDITO,
      periodicidades: PERIODICIDADES_CREDITO
    }
  });
}

async function verCredito(req, res) {
  if (!userCanViewCumplimiento(req.session)) {
    req.flash('error', 'No tienes acceso al cumplimiento patronal.');
    return res.redirect('/dashboard');
  }
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (!empresa) return res.redirect('/nomina/cumplimiento-patronal?tab=infonavit');
  const creditoId = parseOptionalObjectId(req.params.id);
  if (!creditoId) return res.status(404).send('Crédito no encontrado');
  const { CreditoTrabajador, CreditoAviso } = await models();
  const credito = await CreditoTrabajador.findOne({
    _id: creditoId,
    tenantId: req.session.tenantId,
    empresaId: empresa._id
  }).lean();
  if (!credito) return res.status(404).send('Crédito no encontrado');
  const trabajador = await empleadoEnPlaza(req, empresa, { empleadoId: credito.empleadoId });
  if (sessionSubsidiariaId(req) && !trabajador) {
    return res.status(404).send('Crédito no encontrado');
  }
  const avisos = await CreditoAviso.find({ creditoId: credito._id }).sort({ fechaAplicacion: -1, createdAt: -1 }).lean();
  res.render('Nomina/cumplimiento/credito-detalle', {
    empresa,
    error: error || null,
    session: req.session,
    canEdit: userCanEditCumplimiento(req.session),
    credito: { ...credito, trabajador: etiquetaTrabajador(trabajador) },
    trabajador,
    avisos,
    catalogos: {
      avisosInfonavit: AVISOS_INFONAVIT,
      avisosFonacot: AVISOS_FONACOT
    }
  });
}

module.exports = {
  ensureMenu,
  index,
  nuevoCredito,
  verCredito,
  guardarMovimiento,
  estatusMovimiento,
  guardarCredito,
  avisoCredito,
  guardarConciliacion,
  guardarCentro,
  guardarAsignacion,
  armarConciliacion,
  importarConciliacion,
  guardarEba,
  etiquetaRubro: ETIQUETA_RUBRO
};
