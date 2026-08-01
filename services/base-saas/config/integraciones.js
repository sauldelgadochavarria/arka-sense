'use strict';

const ADAPTADORES_NOMINA = [
  { value: 'contpaqi', label: 'CONTPAQi Nóminas', descripcion: 'Layout CSV compatible CONTPAQi' },
  { value: 'aspel', label: 'ASPEL NOI', descripcion: 'Layout CSV compatible ASPEL NOI' },
  { value: 'sap', label: 'SAP HCM', descripcion: 'Layout CSV para carga SAP HCM' },
  { value: 'csv', label: 'CSV genérico', descripcion: 'Columnas configurables por mapeo de campos' }
];

const TIPOS_SYNC = {
  prenomina_export: 'Exportación pre-nómina',
  empleados_export: 'Exportación empleados (ABC)',
  empleados_import: 'Importación empleados (ABC)',
  catalogo_dispositivo: 'Sincronización catálogo dispositivo'
};

const ESTATUS_SYNC = {
  ok: 'Completado',
  parcial: 'Parcial',
  error: 'Error'
};

const TIPOS_DISPOSITIVO = [
  { value: 'zkteco', label: 'ZKTeco' },
  { value: 'anviz', label: 'Anviz' },
  { value: 'generico', label: 'Genérico / API' }
];

const DEFAULT_FIELD_MAPPING = {
  numEmpleado: 'NUM_EMPLEADO',
  rfc: 'RFC',
  curp: 'CURP',
  nss: 'NSS',
  nombre: 'NOMBRE',
  apellidos: 'APELLIDOS',
  salarioDiario: 'SALARIO_DIARIO',
  diasTrabajados: 'DIAS_TRABAJADOS',
  totalPercepciones: 'PERCEPCIONES',
  totalDeducciones: 'DEDUCCIONES',
  netoPagar: 'NETO'
};

const CAMPOS_MAPEABLES = [
  { key: 'numEmpleado', label: 'Número de empleado' },
  { key: 'rfc', label: 'RFC' },
  { key: 'curp', label: 'CURP' },
  { key: 'nss', label: 'NSS' },
  { key: 'nombre', label: 'Nombre' },
  { key: 'apellidos', label: 'Apellidos' },
  { key: 'salarioDiario', label: 'Salario diario' },
  { key: 'diasTrabajados', label: 'Días trabajados' },
  { key: 'totalPercepciones', label: 'Total percepciones' },
  { key: 'totalDeducciones', label: 'Total deducciones' },
  { key: 'netoPagar', label: 'Neto a pagar' }
];

module.exports = {
  ADAPTADORES_NOMINA,
  TIPOS_SYNC,
  ESTATUS_SYNC,
  TIPOS_DISPOSITIVO,
  DEFAULT_FIELD_MAPPING,
  CAMPOS_MAPEABLES
};
