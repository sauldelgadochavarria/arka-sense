'use strict';

/** Días de vacaciones según antigüedad (LFT México, tabla simplificada). */
function diasVacacionesPorAntiguedad(aniosServicio) {
  const y = Math.max(0, Math.floor(aniosServicio));
  if (y < 1) return 0;
  if (y === 1) return 12;
  if (y === 2) return 14;
  if (y === 3) return 16;
  if (y === 4) return 18;
  if (y === 5) return 20;
  if (y <= 10) return 20 + (y - 5) * 2;
  if (y <= 15) return 30 + Math.floor((y - 11) / 5) * 2;
  return 32;
}

function calcularAniosServicio(fechaIngreso, referencia = new Date()) {
  if (!fechaIngreso) return 0;
  const ingreso = new Date(fechaIngreso);
  const ref = new Date(referencia);
  let years = ref.getFullYear() - ingreso.getFullYear();
  const aniversario = new Date(ref.getFullYear(), ingreso.getMonth(), ingreso.getDate());
  if (ref < aniversario) years -= 1;
  return Math.max(0, years);
}

module.exports = { diasVacacionesPorAntiguedad, calcularAniosServicio };
