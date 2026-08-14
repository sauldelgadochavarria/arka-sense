'use strict';

/** Checklist operativo Confronta Nómina–SUA–IDSE (control interno). */
const CHECKLIST_CONFRONTA = [
  {
    frecuencia: 'Cada periodo de nómina',
    items: [
      'Comparar SBC teórico del periodo (IMSS integra / BASE_IMSS) vs periodo anterior y detectar variaciones relevantes.',
      'Confirmar que altas y bajas del periodo se presentaron en IDSE dentro de 5 días hábiles.',
      'Marcar empleados con aumento de salario fijo para dar seguimiento a la modificación de salario en IDSE.'
    ]
  },
  {
    frecuencia: 'Mensual (antes de pagar SUA / cuotas IMSS)',
    items: [
      'Descargar EMA (Emisión Mensual Anticipada) desde IDSE o Consulta de Emisión en SUA.',
      'Ejecutar Confronta: SBC IDSE vs SBC SUA por trabajador.',
      'Verificar tope de 25 UMA en salarios altos.',
      'Conciliar activos en nómina vs vigentes en IDSE (altas/bajas fantasma).',
      'Calcular y pagar cuotas IMSS (Enf./Mat., Inv./Vida, Riesgo de Trabajo, Guarderías) — vencimiento día 17.'
    ]
  },
  {
    frecuencia: 'Bimestral',
    items: [
      'En meses impares (ene, mar, may, jul, sep, nov): presentar modificaciones de salario variable/mixto acumuladas (primeros 5 días hábiles).',
      'Descargar EBA (Emisión Bimestral Anticipada).',
      'Calcular y pagar RCV + INFONAVIT — vencimiento día 17 del mes siguiente al bimestre.'
    ]
  },
  {
    frecuencia: 'Anual',
    items: [
      'Confronta completa de los 6 bimestres del ejercicio.',
      'Papeles de trabajo para Dictamen IMSS (obligatorio con 300+ trabajadores) o declaración anual.',
      'Revisar SBC vs ingresos anuales por trabajador (cruce ISR / IMSS).'
    ]
  }
];

/** Calendario de obligaciones (referencia LSS). */
const CALENDARIO_OBLIGACIONES = [
  {
    obligacion: 'Aviso de alta',
    frecuencia: 'Por movimiento',
    vencimiento: '5 días hábiles desde el ingreso (o 1 día hábil antes)',
    notas: 'Art. 15 LSS'
  },
  {
    obligacion: 'Aviso de baja',
    frecuencia: 'Por movimiento',
    vencimiento: 'Mismo día del cese; máx. 5 días hábiles',
    notas: 'Art. 15 LSS'
  },
  {
    obligacion: 'Modificación de salario fijo',
    frecuencia: 'Por movimiento',
    vencimiento: '5 días hábiles desde el cambio',
    notas: 'Art. 15 LSS'
  },
  {
    obligacion: 'Modificación de salario variable/mixto',
    frecuencia: 'Bimestral',
    vencimiento: 'Primeros 5 días hábiles de ene, mar, may, jul, sep, nov',
    notas: 'Solo en meses impares'
  },
  {
    obligacion: 'Cuotas IMSS (Enf./Mat., Inv./Vida, RT, Guarderías)',
    frecuencia: 'Mensual',
    vencimiento: 'Día 17 del mes siguiente (o siguiente día hábil)',
    notas: 'Art. 39 LSS'
  },
  {
    obligacion: 'RCV + INFONAVIT',
    frecuencia: 'Bimestral',
    vencimiento: 'Día 17 del mes siguiente al bimestre',
    notas: 'Meses de pago: ene, mar, may, jul, sep, nov'
  },
  {
    obligacion: 'Confronta Nómina–SUA–IDSE',
    frecuencia: 'Recomendado: por periodo / mensual / bimestral / anual',
    vencimiento: 'Sin plazo legal — control interno',
    notas: 'Ver checklist operativo'
  },
  {
    obligacion: 'Dictamen IMSS',
    frecuencia: 'Anual',
    vencimiento: 'Según calendario IMSS del ejercicio',
    notas: 'Obligatorio con 300+ trabajadores; opcional para el resto'
  }
];

const TOLERANCIA_DEFAULT = 5;

module.exports = {
  CHECKLIST_CONFRONTA,
  CALENDARIO_OBLIGACIONES,
  TOLERANCIA_DEFAULT
};
