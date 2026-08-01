'use strict';

const getAsignacionRotacionModel = require('../models/asignacionRotacion');
const getPlantillaRotacionModel = require('../models/plantillaRotacion');
const getTurnoModel = require('../models/turno');
const { parseOptionalObjectId, parseDate } = require('../libs/formHelpers');
const { startOfDay } = require('../libs/timeHelpers');
const { TIPOS_PLANTILLA } = require('../config/plantillasHorario');
const { describePlantillaResumen, getPlantillaTipo } = require('./rotacionService');

async function upsertAsignacion(tenantId, empresaId, empleadoId, plantillaId, fechaAncla) {
  const AsignacionRotacion = await getAsignacionRotacionModel();
  return AsignacionRotacion.findOneAndUpdate(
    { tenantId, empleadoId },
    {
      $set: {
        tenantId,
        empresaId,
        empleadoId,
        plantillaRotacionId: plantillaId,
        fechaAncla: startOfDay(fechaAncla),
        activo: true,
        notas: ''
      }
    },
    { upsert: true, new: true }
  );
}

async function clearAsignacion(tenantId, empleadoId) {
  const AsignacionRotacion = await getAsignacionRotacionModel();
  await AsignacionRotacion.updateOne({ tenantId, empleadoId }, { $set: { activo: false } });
}

async function syncAsignacionFromBody(tenantId, empresaId, empleadoId, body) {
  const plantillaId = parseOptionalObjectId(body.plantillaRotacionId);
  if (plantillaId) {
    const fechaAncla = parseDate(body.plantillaFechaAncla) || startOfDay(new Date());
    await upsertAsignacion(tenantId, empresaId, empleadoId, plantillaId, fechaAncla);
    return { assigned: true, plantillaId };
  }
  if (body.plantillaRotacionId === '' || body.sinPlantilla === '1') {
    await clearAsignacion(tenantId, empleadoId);
    return { assigned: false };
  }
  return { assigned: null };
}

async function loadPlantillasActivas(tenantId) {
  const PlantillaRotacion = await getPlantillaRotacionModel();
  const Turno = await getTurnoModel();
  const [plantillas, turnos] = await Promise.all([
    PlantillaRotacion.find({ tenantId, activo: true }).sort({ nombre: 1 }).lean(),
    Turno.find({ tenantId }).lean()
  ]);
  const turnoMap = new Map(turnos.map((t) => [String(t._id), t.nombre]));
  return plantillas.map((p) => {
    const tipo = getPlantillaTipo(p);
    const tipoLabel = TIPOS_PLANTILLA.find((t) => t.value === tipo)?.label || tipo;
    return {
      ...p,
      tipoLabel,
      resumen: describePlantillaResumen(p, turnoMap)
    };
  });
}

async function loadAsignacionEmpleado(tenantId, empleadoId) {
  const AsignacionRotacion = await getAsignacionRotacionModel();
  const asignacion = await AsignacionRotacion.findOne({
    tenantId,
    empleadoId,
    activo: true
  }).lean();

  if (!asignacion) {
    return { asignacion: null, plantilla: null, plantillaLabel: '', plantillaResumen: '' };
  }

  const PlantillaRotacion = await getPlantillaRotacionModel();
  const Turno = await getTurnoModel();
  const plantilla = await PlantillaRotacion.findOne({
    _id: asignacion.plantillaRotacionId,
    tenantId
  }).lean();

  if (!plantilla) {
    return { asignacion, plantilla: null, plantillaLabel: '—', plantillaResumen: '' };
  }

  const turnos = await Turno.find({ tenantId }).lean();
  const turnoMap = new Map(turnos.map((t) => [String(t._id), t.nombre]));
  const tipo = getPlantillaTipo(plantilla);
  const tipoLabel = TIPOS_PLANTILLA.find((t) => t.value === tipo)?.label || tipo;

  return {
    asignacion,
    plantilla,
    plantillaLabel: `${plantilla.nombre} (${tipoLabel})`,
    plantillaResumen: describePlantillaResumen(plantilla, turnoMap)
  };
}

module.exports = {
  upsertAsignacion,
  clearAsignacion,
  syncAsignacionFromBody,
  loadPlantillasActivas,
  loadAsignacionEmpleado
};
