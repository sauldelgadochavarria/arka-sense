'use strict';

/** Tipos de período alineados a Fortia (CLA_PERIODO / NOM_PERIODO). */
const TIPOS_PERIODO_DEFAULT = [
  {
    codigoLegado: 1,
    nombre: 'SEMANAL SIND',
    tipoMotor: 'semanal',
    diasPeriodo: 7,
    esSeptimo: true,
    diasLaborables: 6,
    leyenda: 'SINDICALIZADO',
    periodicidadPagoSat: 2,
    aplicaAsistenciaPrenomina: true,
    compartirConNomina: true
  },
  {
    codigoLegado: 2,
    nombre: 'SEMANAL CONF.',
    tipoMotor: 'semanal',
    diasPeriodo: 7,
    esSeptimo: true,
    diasLaborables: 6,
    leyenda: 'CONFIANZA',
    periodicidadPagoSat: 2,
    aplicaAsistenciaPrenomina: true,
    compartirConNomina: true
  },
  {
    codigoLegado: 3,
    nombre: 'JUBILADOS sind',
    tipoMotor: 'mensual',
    diasPeriodo: 30,
    esSeptimo: false,
    diasLaborables: 15,
    leyenda: null,
    periodicidadPagoSat: 5,
    aplicaAsistenciaPrenomina: false,
    compartirConNomina: true
  },
  {
    codigoLegado: 4,
    nombre: 'JUBILADOS CONF',
    tipoMotor: 'mensual',
    diasPeriodo: 30,
    esSeptimo: false,
    diasLaborables: 15,
    leyenda: 'JUB-CONF',
    periodicidadPagoSat: 5,
    aplicaAsistenciaPrenomina: false,
    compartirConNomina: true
  }
];

const PERIODICIDAD_SAT = [
  { value: 1, label: 'Diario' },
  { value: 2, label: 'Semanal' },
  { value: 3, label: 'Catorcenal' },
  { value: 4, label: 'Quincenal' },
  { value: 5, label: 'Mensual' },
  { value: 6, label: 'Bimestral' },
  { value: 7, label: 'Unidad obra' },
  { value: 8, label: 'Comisión' },
  { value: 9, label: 'Precio alzado' },
  { value: 10, label: 'Decena' },
  { value: 99, label: 'Otra periodicidad' }
];

module.exports = { TIPOS_PERIODO_DEFAULT, PERIODICIDAD_SAT };
