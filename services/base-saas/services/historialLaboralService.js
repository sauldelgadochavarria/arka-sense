'use strict';

const getTipoMovimientoLaboralModel = require('../models/tipoMovimientoLaboral');
const getHistorialLaboralModel = require('../models/historialLaboral');
const { TIPOS_MOVIMIENTO_DEFAULT } = require('../config/historialLaboralDefaults');

const DIAS_MES_REF = 30.4;

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function salariosDerivados(salarioDiario) {
  const diario = salarioDiario != null ? Number(salarioDiario) : null;
  if (diario == null || !Number.isFinite(diario)) {
    return { salarioDiario: null, salarioSemanal: null, salarioMensual: null };
  }
  return {
    salarioDiario: diario,
    salarioSemanal: round2(diario * 7),
    salarioMensual: round2(diario * DIAS_MES_REF)
  };
}

function snapshotEmpleado(empleado, extras = {}) {
  const sal = salariosDerivados(empleado.salarioDiario);
  const cfg = empleado.nominaConfig || {};
  const sueldoIntegrado =
    extras.sueldoIntegrado ??
    (cfg.sueldoIntegrado > 0 ? cfg.sueldoIntegrado : sal.salarioDiario);

  return {
    subsidiariaId: empleado.subsidiariaId || null,
    departamentoId: empleado.departamentoId || null,
    puestoId: empleado.puestoId || null,
    salarioDiario: sal.salarioDiario,
    salarioSemanal: sal.salarioSemanal,
    salarioMensual: sal.salarioMensual,
    sueldoIntegrado: sueldoIntegrado != null ? round2(sueldoIntegrado) : null,
    tipoContrato: empleado.tipoContrato || '',
    tipoSalario: extras.tipoSalario || empleado.tipoSalario || '',
    estatus: empleado.estatus || 'activo'
  };
}

function idChanged(a, b) {
  return String(a || '') !== String(b || '');
}

function numChanged(a, b) {
  const na = a == null ? null : Number(a);
  const nb = b == null ? null : Number(b);
  if (na == null && nb == null) return false;
  if (na == null || nb == null) return true;
  return Math.abs(na - nb) > 0.001;
}

function detectarTipoMovimiento(antes, despues) {
  if (antes.estatus !== 'baja' && despues.estatus === 'baja') return 'BAJA';
  if (antes.estatus === 'baja' && despues.estatus === 'activo') return 'REINGRESO';

  const orgCambio =
    idChanged(antes.departamentoId, despues.departamentoId) ||
    idChanged(antes.puestoId, despues.puestoId) ||
    idChanged(antes.subsidiariaId, despues.subsidiariaId);

  const salCambio =
    numChanged(antes.salarioDiario, despues.salarioDiario) ||
    numChanged(antes.sueldoIntegrado, despues.sueldoIntegrado);

  if (orgCambio) return 'CAMBIO_PLAZA';
  if (salCambio) return 'REAJUSTE';
  if (antes.estatus !== despues.estatus) return 'ACTUALIZACION';
  return null;
}

async function ensureTiposMovimientoForTenant(tenantId) {
  const TipoMovimientoLaboral = await getTipoMovimientoLaboralModel();

  for (const t of TIPOS_MOVIMIENTO_DEFAULT) {
    await TipoMovimientoLaboral.updateOne(
      { tenantId, codigo: t.codigo },
      {
        $setOnInsert: {
          tenantId,
          codigo: t.codigo,
          nombre: t.nombre,
          descripcion: t.descripcion,
          claveLegado: t.claveLegado,
          afectaSalario: t.afectaSalario,
          afectaOrganizacion: t.afectaOrganizacion,
          afectaEstatus: t.afectaEstatus,
          orden: t.orden,
          activo: true
        }
      },
      { upsert: true }
    );
  }
}

async function nextFolio(tenantId) {
  const HistorialLaboral = await getHistorialLaboralModel();
  const last = await HistorialLaboral.findOne({ tenantId })
    .sort({ folio: -1 })
    .select('folio')
    .lean();
  return (last?.folio || 0) + 1;
}

async function registrarMovimiento(tenantId, empresaId, empleadoId, payload) {
  const HistorialLaboral = await getHistorialLaboralModel();
  const folio = payload.folio ?? (await nextFolio(tenantId));

  return HistorialLaboral.create({
    tenantId,
    empresaId,
    empleadoId,
    tipoMovimientoCodigo: String(payload.tipoMovimientoCodigo).toUpperCase(),
    fechaMovimiento: payload.fechaMovimiento || new Date(),
    folio,
    subsidiariaId: payload.subsidiariaId ?? null,
    departamentoId: payload.departamentoId ?? null,
    puestoId: payload.puestoId ?? null,
    salarioDiario: payload.salarioDiario ?? null,
    salarioSemanal: payload.salarioSemanal ?? null,
    salarioMensual: payload.salarioMensual ?? null,
    sueldoIntegrado: payload.sueldoIntegrado ?? null,
    tipoContrato: payload.tipoContrato || '',
    tipoSalario: payload.tipoSalario || '',
    estatus: payload.estatus || '',
    diasContrato: payload.diasContrato ?? null,
    terminoContrato: payload.terminoContrato ?? null,
    observaciones: payload.observaciones || '',
    anterior: payload.anterior || {},
    origen: payload.origen || 'sistema',
    registradoPor: payload.registradoPor || '',
    metadata: payload.metadata || {}
  });
}

async function registrarAlta(tenantId, empresaId, empleado, options = {}) {
  await ensureTiposMovimientoForTenant(tenantId);
  const snap = snapshotEmpleado(empleado, options);
  return registrarMovimiento(tenantId, empresaId, empleado._id, {
    tipoMovimientoCodigo: 'ALTA',
    fechaMovimiento: empleado.fechaIngreso || new Date(),
    ...snap,
    anterior: {},
    observaciones: options.observaciones || 'Alta registrada por el sistema',
    origen: options.origen || 'sistema',
    registradoPor: options.registradoPor || ''
  });
}

async function registrarCambioAutomatico(tenantId, empresaId, empleadoAntes, empleadoDespues, options = {}) {
  await ensureTiposMovimientoForTenant(tenantId);

  const antes = snapshotEmpleado(empleadoAntes);
  const despues = snapshotEmpleado(empleadoDespues, options);

  const tipo = options.tipoMovimientoCodigo || detectarTipoMovimiento(antes, despues);
  if (!tipo) return null;

  return registrarMovimiento(tenantId, empresaId, empleadoDespues._id, {
    tipoMovimientoCodigo: tipo,
    fechaMovimiento: options.fechaMovimiento || new Date(),
    ...despues,
    anterior: antes,
    observaciones: options.observaciones || '',
    origen: options.origen || 'sistema',
    registradoPor: options.registradoPor || '',
    metadata: options.metadata || {}
  });
}

async function listHistorialEmpleado(tenantId, empleadoId, limit = 100) {
  const HistorialLaboral = await getHistorialLaboralModel();
  return HistorialLaboral.find({ tenantId, empleadoId })
    .sort({ fechaMovimiento: -1, folio: -1 })
    .limit(limit)
    .lean();
}

async function listTiposMovimiento(tenantId) {
  await ensureTiposMovimientoForTenant(tenantId);
  const TipoMovimientoLaboral = await getTipoMovimientoLaboralModel();
  return TipoMovimientoLaboral.find({ tenantId }).sort({ orden: 1, codigo: 1 }).lean();
}

async function crearTipoMovimiento(tenantId, data) {
  const TipoMovimientoLaboral = await getTipoMovimientoLaboralModel();
  const codigo = String(data.codigo || '').trim().toUpperCase();
  if (!codigo) throw new Error('Código requerido');

  const exists = await TipoMovimientoLaboral.findOne({ tenantId, codigo }).lean();
  if (exists) throw new Error('Ya existe un tipo con ese código');

  return TipoMovimientoLaboral.create({
    tenantId,
    codigo,
    nombre: String(data.nombre || '').trim(),
    descripcion: String(data.descripcion || '').trim(),
    claveLegado: data.claveLegado != null ? Number(data.claveLegado) : null,
    afectaSalario: Boolean(data.afectaSalario),
    afectaOrganizacion: Boolean(data.afectaOrganizacion),
    afectaEstatus: Boolean(data.afectaEstatus),
    orden: Number(data.orden) || 100,
    activo: true
  });
}

async function toggleTipoMovimiento(tenantId, id) {
  const TipoMovimientoLaboral = await getTipoMovimientoLaboralModel();
  const doc = await TipoMovimientoLaboral.findOne({ _id: id, tenantId });
  if (!doc) throw new Error('Tipo de movimiento no encontrado');
  doc.activo = !doc.activo;
  await doc.save();
}

module.exports = {
  round2,
  salariosDerivados,
  snapshotEmpleado,
  detectarTipoMovimiento,
  ensureTiposMovimientoForTenant,
  registrarMovimiento,
  registrarAlta,
  registrarCambioAutomatico,
  listHistorialEmpleado,
  listTiposMovimiento,
  crearTipoMovimiento,
  toggleTipoMovimiento
};
