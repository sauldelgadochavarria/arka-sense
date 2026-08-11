'use strict';

/** Entidades federativas (clave INEGI / CURP). */
const ENTIDADES_FEDERATIVAS = [
  { value: 'AS', label: 'Aguascalientes' },
  { value: 'BC', label: 'Baja California' },
  { value: 'BS', label: 'Baja California Sur' },
  { value: 'CC', label: 'Campeche' },
  { value: 'CL', label: 'Coahuila' },
  { value: 'CM', label: 'Colima' },
  { value: 'CS', label: 'Chiapas' },
  { value: 'CH', label: 'Chihuahua' },
  { value: 'DF', label: 'Ciudad de México' },
  { value: 'DG', label: 'Durango' },
  { value: 'GT', label: 'Guanajuato' },
  { value: 'GR', label: 'Guerrero' },
  { value: 'HG', label: 'Hidalgo' },
  { value: 'JC', label: 'Jalisco' },
  { value: 'MC', label: 'México' },
  { value: 'MN', label: 'Michoacán' },
  { value: 'MS', label: 'Morelos' },
  { value: 'NT', label: 'Nayarit' },
  { value: 'NL', label: 'Nuevo León' },
  { value: 'OC', label: 'Oaxaca' },
  { value: 'PL', label: 'Puebla' },
  { value: 'QT', label: 'Querétaro' },
  { value: 'QR', label: 'Quintana Roo' },
  { value: 'SP', label: 'San Luis Potosí' },
  { value: 'SL', label: 'Sinaloa' },
  { value: 'SR', label: 'Sonora' },
  { value: 'TC', label: 'Tabasco' },
  { value: 'TS', label: 'Tamaulipas' },
  { value: 'TL', label: 'Tlaxcala' },
  { value: 'VZ', label: 'Veracruz' },
  { value: 'YN', label: 'Yucatán' },
  { value: 'ZS', label: 'Zacatecas' },
  { value: 'NE', label: 'Nacido en el extranjero' }
];

const ESTADOS_CIVILES = [
  { value: 'soltero', label: 'Soltero(a)' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'union_libre', label: 'Unión libre' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'separado', label: 'Separado(a)' },
  { value: 'viudo', label: 'Viudo(a)' }
];

/** Base de cotización IMSS / tipo de salario. */
const TIPOS_BASE_COTIZACION = [
  { value: 'fijo', label: 'Fija (salario fijo)' },
  { value: 'variable', label: 'Variable (comisiones / variables)' },
  { value: 'mixto', label: 'Mixta (fijo + variable)' }
];

module.exports = {
  ENTIDADES_FEDERATIVAS,
  ESTADOS_CIVILES,
  TIPOS_BASE_COTIZACION
};
