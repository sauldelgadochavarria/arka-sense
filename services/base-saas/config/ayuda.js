'use strict';

const AYUDA_CATEGORIAS = [
  { value: 'general', label: 'General' },
  { value: 'nomina', label: 'Nómina' },
  { value: 'asistencia', label: 'Asistencia / Pre-nómina' },
  { value: 'personal', label: 'Personal' },
  { value: 'configuracion', label: 'Configuración' }
];

function labelCategoria(value) {
  const found = AYUDA_CATEGORIAS.find((c) => c.value === value);
  return found ? found.label : value || 'General';
}

module.exports = {
  AYUDA_CATEGORIAS,
  labelCategoria
};
