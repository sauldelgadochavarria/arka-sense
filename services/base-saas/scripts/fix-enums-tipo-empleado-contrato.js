'use strict';

/**
 * Corrige la mezcla tipocontrato ↔ tipoempleado en system_enums y migra empleados.
 * Uso (host): node scripts/fix-enums-tipo-empleado-contrato.js
 * Mongo host: mongodb://localhost:27020/config
 */

const mongoose = require('mongoose');
const getSystemEnumModel = require('../models/systemEnum');
const getEmpleadoModel = require('../models/empleado');
const getConceptoNominaModel = require('../models/conceptoNomina');

const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27020/config';

const TIPO_CONTRATO_ITEMS = [
  { value: 'indefinido', label: 'Indefinido (planta)', orden: 1, activo: true },
  { value: 'temporal', label: 'Temporal', orden: 2, activo: true },
  { value: 'eventual', label: 'Eventual', orden: 3, activo: true },
  { value: 'proyecto', label: 'Por proyecto', orden: 4, activo: true },
  { value: 'capacitacion', label: 'Aprendizaje / capacitación', orden: 5, activo: true }
];

const TIPO_EMPLEADO_ITEMS = [
  { value: 'confianza', label: 'Confianza', orden: 1, activo: true },
  { value: 'sindicalizado', label: 'Sindicalizado', orden: 2, activo: true }
];

/** Valores que estaban mal en tipo_empleado → tipo_contrato */
const EMPLEADO_A_CONTRATO = {
  planta: 'indefinido',
  eventual: 'eventual',
  aprendiz: 'capacitacion',
  temporal: 'temporal',
  proyecto: 'proyecto',
  indefinido: 'indefinido',
  capacitacion: 'capacitacion'
};

const VALORES_EMPLEADO_OK = new Set(['confianza', 'sindicalizado']);

async function main() {
  await mongoose.connect(MONGO);
  const SystemEnum = await getSystemEnumModel();
  const Empleado = await getEmpleadoModel();
  const ConceptoNomina = await getConceptoNominaModel();

  await SystemEnum.updateOne(
    { grupo: 'tipo_contrato' },
    {
      $set: {
        nombre: 'Tipo de contrato',
        descripcion:
          'Naturaleza jurídica del contrato (duración / modalidad). No confundir con tipo de empleado.',
        editable: true,
        activo: true,
        items: TIPO_CONTRATO_ITEMS
      }
    },
    { upsert: true }
  );

  await SystemEnum.updateOne(
    { grupo: 'tipo_empleado' },
    {
      $set: {
        nombre: 'Tipo de empleado',
        descripcion:
          'Clasificación laboral (confianza / sindicalizado). Independiente del tipo de contrato.',
        editable: true,
        activo: true,
        items: TIPO_EMPLEADO_ITEMS
      }
    },
    { upsert: true }
  );
  console.log('Enums tipo_contrato y tipo_empleado actualizados');

  const empleados = await Empleado.find({}).lean();
  let moved = 0;
  let cleared = 0;
  for (const e of empleados) {
    const te = String(e.tipoEmpleado || '').trim();
    if (!te || VALORES_EMPLEADO_OK.has(te)) continue;

    const patch = { tipoEmpleado: '' };
    const mapped = EMPLEADO_A_CONTRATO[te];
    if (mapped && !String(e.tipoContrato || '').trim()) {
      patch.tipoContrato = mapped;
      moved += 1;
    } else if (mapped) {
      // Ya tenía contrato: solo quita el valor inválido de tipo empleado
      moved += 1;
    } else {
      cleared += 1;
    }
    await Empleado.updateOne({ _id: e._id }, { $set: patch });
  }
  console.log(`Empleados: ${moved} valores mal ubicados corregidos, ${cleared} desconocidos limpiados`);

  const conceptos = await ConceptoNomina.find({
    aplicaTiposEmpleado: { $exists: true, $ne: [] }
  }).lean();
  let conceptosFixed = 0;
  for (const c of conceptos) {
    const next = (c.aplicaTiposEmpleado || []).filter((v) => VALORES_EMPLEADO_OK.has(String(v)));
    if (next.length !== (c.aplicaTiposEmpleado || []).length) {
      await ConceptoNomina.updateOne({ _id: c._id }, { $set: { aplicaTiposEmpleado: next } });
      conceptosFixed += 1;
    }
  }
  console.log(`Conceptos con aplicaTiposEmpleado depurados: ${conceptosFixed}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
