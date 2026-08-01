'use strict';

const TIPOS_PERIODO = [
  { value: 'semanal', label: 'Semanal (lun–dom)' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'decena', label: 'Decena (cada 10 días)' }
];

const ESTATUS_PERIODO = {
  pendiente: 'Pendiente',
  abierto: 'Abierto',
  borrador: 'Borrador (calculado)',
  cerrado: 'Cerrado'
};

const DEFAULT_CONCEPTOS = [
  { clave: 'P001', nombre: 'Salario del período', tipo: 'percepcion', formula: 'salario_periodo', orden: 1 },
  { clave: 'P002', nombre: 'Horas extra ordinarias', tipo: 'percepcion', formula: 'horas_extra', orden: 2 },
  { clave: 'D001', nombre: 'Retardos', tipo: 'deduccion', formula: 'retardos', orden: 10 },
  { clave: 'D002', nombre: 'Faltas injustificadas', tipo: 'deduccion', formula: 'faltas', orden: 11 },
  { clave: 'D003', nombre: 'Salidas anticipadas', tipo: 'deduccion', formula: 'salida_anticipada', orden: 12 }
];

module.exports = { TIPOS_PERIODO, ESTATUS_PERIODO, DEFAULT_CONCEPTOS };
