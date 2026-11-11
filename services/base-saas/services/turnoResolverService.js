'use strict';

const getTurnoModel = require('../models/turno');
const getPlantillaRotacionModel = require('../models/plantillaRotacion');
const getAsignacionRotacionModel = require('../models/asignacionRotacion');
const getOverrideTurnoModel = require('../models/overrideTurno');
const { resolveSlotFromPlantilla } = require('./rotacionService');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

async function getOverrideForFecha(tenantId, empleadoId, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const OverrideTurno = await getOverrideTurnoModel();
  return OverrideTurno.findOne({
    tenantId,
    empleadoId,
    fecha: { $gte: fecha, $lte: endOfDay(fecha) },
    activo: true
  }).lean();
}

async function getAsignacionActiva(tenantId, empleadoId) {
  const AsignacionRotacion = await getAsignacionRotacionModel();
  return AsignacionRotacion.findOne({ tenantId, empleadoId, activo: true }).lean();
}

async function resolveTurnoVigente(tenantId, empleado, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const Turno = await getTurnoModel();

  const override = await getOverrideForFecha(tenantId, empleado._id, fecha);
  if (override) {
    if (override.esDescanso || !override.turnoId) {
      return {
        turno: null,
        origen: 'override',
        esDescansoForzado: true,
        plantilla: null,
        asignacion: null,
        slot: null,
        override
      };
    }
    const turno = await Turno.findOne({ _id: override.turnoId, tenantId, activo: true }).lean();
    return {
      turno,
      origen: 'override',
      esDescansoForzado: false,
      plantilla: null,
      asignacion: null,
      slot: null,
      override
    };
  }

  const asignacion = await getAsignacionActiva(tenantId, empleado._id);
  if (asignacion) {
    const PlantillaRotacion = await getPlantillaRotacionModel();
    const plantilla = await PlantillaRotacion.findOne({
      _id: asignacion.plantillaRotacionId,
      tenantId,
      activo: true
    }).lean();

    if (plantilla) {
      const slot = resolveSlotFromPlantilla(plantilla, asignacion.fechaAncla, fecha);
      if (slot?.esDescanso || (slot && !slot.turnoId && slot.esDescanso !== false)) {
        return {
          turno: null,
          origen: 'plantilla',
          esDescansoForzado: true,
          plantilla,
          asignacion,
          slot,
          override: null
        };
      }
      if (slot?.turnoId) {
        const turno = await Turno.findOne({ _id: slot.turnoId, tenantId, activo: true }).lean();
        if (turno) {
          return {
            turno,
            origen: 'plantilla',
            esDescansoForzado: false,
            plantilla,
            asignacion,
            slot,
            override: null
          };
        }
      }
    }
  }

  if (empleado.turnoId) {
    const turno = await Turno.findOne({ _id: empleado.turnoId, tenantId }).lean();
    return {
      turno,
      origen: 'empleado',
      esDescansoForzado: false,
      plantilla: null,
      asignacion: null,
      slot: null,
      override: null
    };
  }

  return {
    turno: null,
    origen: 'ninguno',
    esDescansoForzado: false,
    plantilla: null,
    asignacion: null,
    slot: null,
    override: null
  };
}

async function resolveTurnoVigenteBatch(tenantId, empleadoIds, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const map = new Map();
  for (const empleadoId of empleadoIds) {
    map.set(String(empleadoId), await resolveTurnoVigente(tenantId, { _id: empleadoId }, fecha));
  }
  return { fecha, map };
}

/**
 * Lee overrides, rotaciones y turnos una sola vez para resolver el día en memoria.
 * El resultado sigue las mismas reglas que resolveTurnoVigente.
 */
async function cargarContextoTurnos(tenantId, empleados, desde, hasta) {
  const ids = (empleados || []).map((e) => e && e._id).filter(Boolean);
  const inicio = startOfDay(desde);
  const fin = endOfDay(hasta || desde);
  const OverrideTurno = await getOverrideTurnoModel();
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const Turno = await getTurnoModel();

  const [overrides, asignaciones, turnos] = await Promise.all([
    ids.length
      ? OverrideTurno.find({
          tenantId,
          empleadoId: { $in: ids },
          fecha: { $gte: inicio, $lte: fin },
          activo: true
        }).lean()
      : [],
    ids.length
      ? AsignacionRotacion.find({ tenantId, empleadoId: { $in: ids }, activo: true }).lean()
      : [],
    Turno.find({ tenantId }).lean()
  ]);

  const plantillaIds = [
    ...new Set(asignaciones.map((a) => a.plantillaRotacionId).filter(Boolean).map(String))
  ];
  const plantillas = plantillaIds.length
    ? await PlantillaRotacion.find({ _id: { $in: plantillaIds }, tenantId, activo: true }).lean()
    : [];

  const overridesPorEmpleado = new Map();
  for (const o of overrides) {
    const key = String(o.empleadoId);
    if (!overridesPorEmpleado.has(key)) overridesPorEmpleado.set(key, []);
    overridesPorEmpleado.get(key).push(o);
  }
  const asignacionPorEmpleado = new Map();
  for (const a of asignaciones) {
    const key = String(a.empleadoId);
    if (!asignacionPorEmpleado.has(key)) asignacionPorEmpleado.set(key, a);
  }

  return {
    overridesPorEmpleado,
    asignacionPorEmpleado,
    plantillaPorId: new Map(plantillas.map((p) => [String(p._id), p])),
    turnoPorId: new Map(turnos.map((t) => [String(t._id), t]))
  };
}

function turnoDelContexto(ctx, turnoId, soloActivo) {
  if (!turnoId) return null;
  const turno = ctx.turnoPorId.get(String(turnoId));
  if (!turno) return null;
  if (soloActivo && turno.activo !== true) return null;
  return turno;
}

function resolverTurnoConContexto(ctx, empleado, fechaInput) {
  const fecha = startOfDay(fechaInput);
  const desde = fecha.getTime();
  const hasta = endOfDay(fecha).getTime();
  const empKey = String(empleado._id);
  const overrides = ctx.overridesPorEmpleado.get(empKey) || [];
  const override = overrides.find((o) => {
    const t = new Date(o.fecha).getTime();
    return t >= desde && t <= hasta;
  });

  if (override) {
    if (override.esDescanso || !override.turnoId) {
      return {
        turno: null,
        origen: 'override',
        esDescansoForzado: true,
        plantilla: null,
        asignacion: null,
        slot: null,
        override
      };
    }
    return {
      turno: turnoDelContexto(ctx, override.turnoId, true),
      origen: 'override',
      esDescansoForzado: false,
      plantilla: null,
      asignacion: null,
      slot: null,
      override
    };
  }

  const asignacion = ctx.asignacionPorEmpleado.get(empKey) || null;
  if (asignacion) {
    const plantilla = ctx.plantillaPorId.get(String(asignacion.plantillaRotacionId)) || null;
    if (plantilla) {
      const slot = resolveSlotFromPlantilla(plantilla, asignacion.fechaAncla, fecha);
      if (slot?.esDescanso || (slot && !slot.turnoId && slot.esDescanso !== false)) {
        return {
          turno: null,
          origen: 'plantilla',
          esDescansoForzado: true,
          plantilla,
          asignacion,
          slot,
          override: null
        };
      }
      if (slot?.turnoId) {
        const turno = turnoDelContexto(ctx, slot.turnoId, true);
        if (turno) {
          return {
            turno,
            origen: 'plantilla',
            esDescansoForzado: false,
            plantilla,
            asignacion,
            slot,
            override: null
          };
        }
      }
    }
  }

  if (empleado.turnoId) {
    return {
      turno: turnoDelContexto(ctx, empleado.turnoId, false),
      origen: 'empleado',
      esDescansoForzado: false,
      plantilla: null,
      asignacion: null,
      slot: null,
      override: null
    };
  }

  return {
    turno: null,
    origen: 'ninguno',
    esDescansoForzado: false,
    plantilla: null,
    asignacion: null,
    slot: null,
    override: null
  };
}

module.exports = {
  getOverrideForFecha,
  getAsignacionActiva,
  resolveTurnoVigente,
  resolveTurnoVigenteBatch,
  cargarContextoTurnos,
  resolverTurnoConContexto
};
