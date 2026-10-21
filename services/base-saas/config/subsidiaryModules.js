'use strict';

/**
 * Módulos que la subsidiaria puede apagar (AND con licencia del tenant).
 * Si la sub no define el campo, se hereda (ON solo si el tenant tiene el flag).
 * Vacaciones y recibos son flags propios: no se encienden por incidencias ni por nómina.
 */
const SUBSIDIARY_MODULE_KEYS = [
  {
    key: 'asistencia',
    label: 'Asistencia',
    description: 'Marcaciones, jornada diaria y app de checado.',
    tenantAnyOf: ['asistencia']
  },
  {
    key: 'recibos',
    label: 'Recibos de nómina',
    description: 'Consulta de recibos en portal y app. Sigue el flag recibos del tenant.',
    tenantAnyOf: ['recibos']
  },
  {
    key: 'vacaciones',
    label: 'Vacaciones',
    description: 'Solicitud y aprobación de vacaciones. Sigue el flag vacaciones del tenant.',
    tenantAnyOf: ['vacaciones']
  }
];

module.exports = { SUBSIDIARY_MODULE_KEYS };
