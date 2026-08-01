'use strict';

const TIPOS_PLANTILLA = [
  { value: 'fijo', label: 'Turno fijo', descripcion: 'El mismo turno todos los días laborables.' },
  {
    value: 'secuencia',
    label: 'Rotación por secuencia',
    descripcion: 'Ciclo repetitivo de turnos (ej. T1 → T2 → T3 → descanso).'
  },
  {
    value: 'matriz',
    label: 'Matriz multi-semana',
    descripcion: 'Cuadrícula semana × día para patrones complejos (Qualtia).'
  }
];

const TIPOS_PLANTILLA_MAP = Object.fromEntries(TIPOS_PLANTILLA.map((t) => [t.value, t]));

function normalizeTipoPlantilla(tipo) {
  const t = String(tipo || 'matriz').trim().toLowerCase();
  return TIPOS_PLANTILLA_MAP[t] ? t : 'matriz';
}

module.exports = { TIPOS_PLANTILLA, TIPOS_PLANTILLA_MAP, normalizeTipoPlantilla };
