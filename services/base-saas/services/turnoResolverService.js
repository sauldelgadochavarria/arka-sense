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

module.exports = {
  getOverrideForFecha,
  getAsignacionActiva,
  resolveTurnoVigente,
  resolveTurnoVigenteBatch
};
