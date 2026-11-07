'use strict';

const getEmpleadoModel = require('../models/empleado');
const {
  requireEmpresaForTenant,
  findOneByTenant
} = require('../libs/tenantScope');
const { parseDate, trimString } = require('../libs/formHelpers');
const {
  listTiposMovimiento,
  crearTipoMovimiento,
  actualizarReglaSua,
  toggleTipoMovimiento,
  listHistorialEmpleado,
  registrarMovimiento,
  snapshotEmpleado,
  salariosDerivados,
  ensureTiposMovimientoForTenant
} = require('../services/historialLaboralService');
const { TIPOS_SALARIO } = require('../config/historialLaboralDefaults');
const getMenuModel = require('../models/menu');

const RUTA_TIPOS = '/config-sistema/tipos-movimiento-laboral';

async function ensureMenuTipos() {
  const Menu = await getMenuModel();
  const config = await Menu.findOne({
    menuPrincipal: 'Configuración',
    esCategoria: true,
    parentId: null,
    activo: { $ne: false }
  }).lean();
  if (!config) return;
  const hermana = await Menu.findOne({
    parentId: config._id,
    rutaApp: '/config-subsidiarias'
  }).lean();
  const data = {
    menuPrincipal: 'Tipos mov. laboral',
    rutaApp: RUTA_TIPOS,
    parentId: config._id,
    orden: 13,
    activo: true,
    esCategoria: false,
    requiredFeatureKeys: hermana?.requiredFeatureKeys?.length
      ? hermana.requiredFeatureKeys
      : ['config_admin'],
    roles: hermana?.roles || [],
    modulePackage: hermana?.modulePackage || 'nucleo'
  };
  const existing = await Menu.findOne({
    rutaApp: { $in: [RUTA_TIPOS, '/personal/tipos-movimiento-laboral'] }
  }).sort({ activo: -1 }).lean();
  if (existing) await Menu.updateOne({ _id: existing._id }, { $set: data });
  else await Menu.create(data);
  await Menu.updateMany(
    {
      rutaApp: '/personal/tipos-movimiento-laboral',
      ...(existing ? { _id: { $ne: existing._id } } : {})
    },
    { $set: { activo: false } }
  );
}

async function loadCatalogMaps(tenantId, empresaId) {
  const getDepartamentoModel = require('../models/departamento');
  const getPuestoModel = require('../models/puesto');
  const getSubsidiariaModel = require('../models/subsidiaria');

  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Subsidiaria = await getSubsidiariaModel();

  const [departamentos, puestos, subsidiarias] = await Promise.all([
    Departamento.find({ tenantId }).lean(),
    Puesto.find({ tenantId }).lean(),
    empresaId ? Subsidiaria.find({ empresaId }).lean() : []
  ]);

  return {
    deptMap: new Map(departamentos.map((d) => [String(d._id), d.nombre])),
    puestoMap: new Map(puestos.map((p) => [String(p._id), p.nombre])),
    subMap: new Map(subsidiarias.map((s) => [String(s._id), s.nombre]))
  };
}

function tipoSalarioLabel(value) {
  return TIPOS_SALARIO.find((t) => t.value === value)?.label || value || '—';
}

async function listTipos(req, res) {
  await ensureMenuTipos().catch(() => {});
  const { empresa, error } = await requireEmpresaForTenant(req);
  const tipos = await listTiposMovimiento(req.session.tenantId);

  res.render('ConfigSistema/tipos-movimiento-laboral', {
    tipos,
    empresa,
    error: error || null,
    session: req.session
  });
}

function nuevoTipo(req, res) {
  res.render('ConfigSistema/tipo-movimiento-nuevo', { session: req.session });
}

async function createTipo(req, res) {
  try {
    await crearTipoMovimiento(req.session.tenantId, {
      codigo: trimString(req.body.codigo),
      nombre: trimString(req.body.nombre),
      descripcion: trimString(req.body.descripcion),
      claveLegado: req.body.claveLegado ? Number(req.body.claveLegado) : null,
      afectaSalario: Boolean(req.body.afectaSalario),
      afectaOrganizacion: Boolean(req.body.afectaOrganizacion),
      afectaEstatus: Boolean(req.body.afectaEstatus),
      orden: Number(req.body.orden) || 100,
      entraSua: req.body.entraSua === '1',
      archivoSua: trimString(req.body.archivoSua),
      claveSua: trimString(req.body.claveSua),
      condicionSua: trimString(req.body.condicionSua)
    });
    req.flash('success', 'Tipo de movimiento creado');
    res.redirect(RUTA_TIPOS);
  } catch (err) {
    req.flash('error', err.message || 'Error al crear tipo');
    res.redirect(`${RUTA_TIPOS}/nuevo`);
  }
}

async function updateReglaSua(req, res) {
  try {
    await actualizarReglaSua(req.session.tenantId, req.params.id, {
      entraSua: req.body.entraSua === '1',
      archivoSua: trimString(req.body.archivoSua),
      claveSua: trimString(req.body.claveSua),
      condicionSua: trimString(req.body.condicionSua)
    });
    req.flash('success', 'La regla SUA del tipo quedó actualizada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo actualizar la regla SUA');
  }
  res.redirect(RUTA_TIPOS);
}

async function toggleTipo(req, res) {
  try {
    await toggleTipoMovimiento(req.session.tenantId, req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect(RUTA_TIPOS);
}

async function showHistorialEmpleado(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Empleado = await getEmpleadoModel();
  const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
  if (!empleado) return res.status(404).send('Empleado no encontrado');

  const [movimientos, tipos, maps] = await Promise.all([
    listHistorialEmpleado(req.session.tenantId, empleado._id, 200),
    listTiposMovimiento(req.session.tenantId),
    loadCatalogMaps(req.session.tenantId, empresa?._id)
  ]);

  const tipoMap = new Map(tipos.map((t) => [t.codigo, t.nombre]));

  res.render('Personal/historial-laboral', {
    empleado,
    movimientos,
    tipos: tipos.filter((t) => t.activo),
    tipoMap,
    tipoSalarioLabel,
    tiposSalario: TIPOS_SALARIO,
    empresa,
    error: error || null,
    session: req.session,
    ...maps
  });
}

async function createMovimientoManual(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect(`/personal-empleados/${req.params.id}/historial-laboral`);
    }

    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) return res.status(404).send('Empleado no encontrado');

    await ensureTiposMovimientoForTenant(req.session.tenantId);

    const salarioDiario = req.body.salarioDiario ? Number(req.body.salarioDiario) : empleado.salarioDiario;
    const sal = salariosDerivados(salarioDiario);
    const snap = snapshotEmpleado(empleado, {
      tipoSalario: trimString(req.body.tipoSalario)
    });

    await registrarMovimiento(req.session.tenantId, empresa._id, empleado._id, {
      tipoMovimientoCodigo: trimString(req.body.tipoMovimientoCodigo).toUpperCase(),
      fechaMovimiento: parseDate(req.body.fechaMovimiento) || new Date(),
      subsidiariaId: empleado.subsidiariaId,
      departamentoId: empleado.departamentoId,
      puestoId: empleado.puestoId,
      salarioDiario: sal.salarioDiario,
      salarioSemanal: sal.salarioSemanal,
      salarioMensual: sal.salarioMensual,
      sueldoIntegrado: req.body.sueldoIntegrado ? Number(req.body.sueldoIntegrado) : snap.sueldoIntegrado,
      tipoContrato: empleado.tipoContrato || '',
      tipoSalario: trimString(req.body.tipoSalario) || snap.tipoSalario,
      estatus: empleado.estatus,
      observaciones: trimString(req.body.observaciones),
      anterior: {},
      origen: 'manual',
      registradoPor: req.session.username || req.session.userName || ''
    });

    req.flash('success', 'Movimiento registrado');
  } catch (err) {
    console.error('[historial-laboral]', err);
    req.flash('error', err.message || 'Error al registrar movimiento');
  }
  res.redirect(`/personal-empleados/${req.params.id}/historial-laboral`);
}

module.exports = {
  listTipos,
  nuevoTipo,
  createTipo,
  updateReglaSua,
  toggleTipo,
  showHistorialEmpleado,
  createMovimientoManual,
  tipoSalarioLabel
};
