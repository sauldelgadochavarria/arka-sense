'use strict';

/**
 * Política de pago del descanso semanal / días pagados.
 * No hay una sola regla LFT universal: cada empresa documenta la suya.
 */
const POLITICA_DESCANSO_DEFAULT = {
  activo: true,
  /**
   * todo_o_nada — si hay falta injustificada, pierde el descanso del período (práctica frecuente).
   * proporcional — prorratea descanso según cumplimiento de días programados.
   * conservar — siempre paga el descanso (salvo flags en contrario).
   * ninguno — nunca agrega días de descanso al sueldo.
   */
  modoDescanso: 'todo_o_nada',
  pierdeDescansoConUnaFaltaInjustificada: true,
  pagaDescansoConIncapacidad: true,
  pagaDescansoConVacaciones: true,
  pagaDescansoConPermisoConGoce: true,
  /** Las ausencias justificadas cuentan como “cumplidas” para no perder el descanso. */
  cuentaJustificadasComoCumplidas: true,
  /**
   * null = derivar del tipo de período (diasLaborables / esSeptimo).
   * Ej. semanal oficina: 5 programados + 2 descanso.
   */
  diasProgramadosPorPeriodo: null,
  diasDescansoPorPeriodo: null,
  /** IMSS / cotización: usar días pagados (incluye descanso pagado). */
  imssUsaDiasPagados: true,
  notas:
    'La pérdida del séptimo día no es regla automática de la LFT; depende de contrato, CCT y política de la empresa.'
};

module.exports = { POLITICA_DESCANSO_DEFAULT };
