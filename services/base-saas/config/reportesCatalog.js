'use strict';

const REPORTES = [
  {
    slug: 'asistencia-periodo',
    title: 'Asistencia por período',
    descripcion: 'Resumen de presentes, retardos, faltas e incompletos por empleado.',
    filtros: ['periodo', 'departamento', 'turno', 'empleado']
  },
  {
    slug: 'incidencias-periodo',
    title: 'Incidencias del período',
    descripcion: 'Todas las incidencias registradas con tipo y estatus.',
    filtros: ['periodo', 'departamento', 'empleado', 'tipoIncidencia', 'estatusIncidencia']
  },
  {
    slug: 'retardos',
    title: 'Retardos',
    descripcion: 'Detalle de retardos y minutos acumulados por empleado.',
    filtros: ['periodo', 'departamento', 'empleado']
  },
  {
    slug: 'faltas',
    title: 'Faltas',
    descripcion: 'Faltas justificadas e injustificadas del período.',
    filtros: ['periodo', 'departamento', 'empleado']
  },
  {
    slug: 'horas-extra',
    title: 'Horas extra',
    descripcion: 'Detalle de HE ordinaria, doble y triple por empleado.',
    filtros: ['periodo', 'departamento', 'empleado']
  },
  {
    slug: 'asistencia-perfecta',
    title: 'Asistencia perfecta',
    descripcion: 'Empleados sin retardos, faltas ni incidencias en el período.',
    filtros: ['periodo', 'departamento']
  },
  {
    slug: 'vacaciones',
    title: 'Vacaciones',
    descripcion: 'Saldos de vacaciones y días tomados en el año.',
    filtros: ['anio', 'departamento', 'empleado']
  },
  {
    slug: 'rotacion-personal',
    title: 'Rotación de personal',
    descripcion: 'Altas y bajas de empleados en el período.',
    filtros: ['periodo', 'departamento']
  },
  {
    slug: 'productividad-turno',
    title: 'Productividad por turno',
    descripcion: 'Porcentaje de asistencia agrupado por turno.',
    filtros: ['periodo', 'departamento', 'turno']
  },
  {
    slug: 'registros-parciales',
    title: 'Registros parciales pendientes',
    descripcion: 'Días con registro parcial por falta de marcaje de comida.',
    filtros: ['periodo', 'departamento', 'empleado']
  },
  {
    slug: 'marcajes-fuera-rango',
    title: 'Marcajes fuera de rango',
    descripcion: 'Checadas fuera de la ventana de holgura del turno.',
    filtros: ['periodo', 'departamento', 'empleado']
  },
  {
    slug: 'sin-codigo-externo',
    title: 'Sin código externo',
    descripcion: 'Empleados activos con incidencias o movimientos sin código de exportación.',
    filtros: ['periodo']
  },
  {
    slug: 'prenomina-borrador',
    title: 'Pre-nómina borrador',
    descripcion: 'Vista previa de períodos calculados sin cerrar.',
    filtros: ['periodoNomina']
  },
  {
    slug: 'prenomina-cerrada',
    title: 'Pre-nómina cerrada',
    descripcion: 'Períodos cerrados con totales de cálculo.',
    filtros: ['periodoNomina']
  },
  {
    slug: 'conciliacion-export',
    title: 'Conciliación de exportación',
    descripcion: 'Estatus de envíos de pre-nómina al ERP o archivos de integración.',
    filtros: ['periodo']
  },
  {
    slug: 'dispositivos',
    title: 'Dispositivos biométricos',
    descripcion: 'Estado y actividad de dispositivos registrados.',
    filtros: []
  }
];

const REPORTES_BY_SLUG = Object.fromEntries(REPORTES.map((r) => [r.slug, r]));

module.exports = { REPORTES, REPORTES_BY_SLUG };
