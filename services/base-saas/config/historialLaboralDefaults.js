'use strict';

/** Tipos de movimiento alineados a Fortia (CLA_TIPO_MOV). */
const TIPOS_MOVIMIENTO_DEFAULT = [
  {
    codigo: 'ALTA',
    claveLegado: 1,
    nombre: 'Alta / ingreso',
    descripcion: 'Registro inicial del trabajador',
    afectaSalario: true,
    afectaOrganizacion: true,
    afectaEstatus: true,
    orden: 10
  },
  {
    codigo: 'CAMBIO_PLAZA',
    claveLegado: 7,
    nombre: 'Cambio de plaza',
    descripcion: 'Cambio de departamento, puesto o ubicación',
    afectaSalario: false,
    afectaOrganizacion: true,
    afectaEstatus: false,
    orden: 20
  },
  {
    codigo: 'BAJA',
    claveLegado: 10,
    nombre: 'Baja',
    descripcion: 'Terminación de la relación laboral',
    afectaSalario: false,
    afectaOrganizacion: false,
    afectaEstatus: true,
    orden: 30
  },
  {
    codigo: 'REAJUSTE',
    claveLegado: 14,
    nombre: 'Reajuste salarial',
    descripcion: 'Modificación de sueldo o sueldo integrado',
    afectaSalario: true,
    afectaOrganizacion: false,
    afectaEstatus: false,
    orden: 40
  },
  {
    codigo: 'REINGRESO',
    claveLegado: 11,
    nombre: 'Reingreso',
    descripcion: 'Reactivación después de baja',
    afectaSalario: false,
    afectaOrganizacion: false,
    afectaEstatus: true,
    orden: 50
  },
  {
    codigo: 'ACTUALIZACION',
    claveLegado: 99,
    nombre: 'Actualización general',
    descripcion: 'Otros cambios administrativos',
    afectaSalario: false,
    afectaOrganizacion: false,
    afectaEstatus: false,
    orden: 90
  }
];

const TIPOS_SALARIO = [
  { value: 'fijo', label: 'Fijo', claveLegado: 0 },
  { value: 'mixto', label: 'Mixto', claveLegado: 2 },
  { value: 'variable', label: 'Variable', claveLegado: 1 }
];

const MAPEO_TIPO_MOV_LEGADO = {
  1: 'ALTA',
  7: 'CAMBIO_PLAZA',
  10: 'BAJA',
  14: 'REAJUSTE',
  11: 'REINGRESO'
};

module.exports = {
  TIPOS_MOVIMIENTO_DEFAULT,
  TIPOS_SALARIO,
  MAPEO_TIPO_MOV_LEGADO
};
