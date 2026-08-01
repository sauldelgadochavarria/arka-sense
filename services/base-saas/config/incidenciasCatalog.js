'use strict';

const DEFAULT_TIPOS_INCIDENCIA = [
  { clave: 'FI', nombre: 'Falta injustificada', afectaPago: true, requiereAprobacion: false, requiereDocumento: false, esAutomatica: true },
  { clave: 'FJ', nombre: 'Falta justificada', afectaPago: false, requiereAprobacion: true, requiereDocumento: true, esAutomatica: false },
  { clave: 'PCG', nombre: 'Permiso con goce', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: false },
  { clave: 'PSG', nombre: 'Permiso sin goce', afectaPago: true, requiereAprobacion: true, requiereDocumento: true, esAutomatica: false },
  { clave: 'VAC', nombre: 'Vacaciones', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: false },
  { clave: 'RET', nombre: 'Retardo', afectaPago: true, requiereAprobacion: false, requiereDocumento: false, esAutomatica: true },
  { clave: 'SA', nombre: 'Salida anticipada', afectaPago: true, requiereAprobacion: false, requiereDocumento: false, esAutomatica: true },
  { clave: 'HEO', nombre: 'Hora extra ordinaria', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: true },
  { clave: 'HED', nombre: 'Hora extra doble', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: true },
  { clave: 'HEF', nombre: 'Hora extra festivo', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: true },
  { clave: 'RP', nombre: 'Registro parcial', afectaPago: true, requiereAprobacion: true, requiereDocumento: false, esAutomatica: true },
  { clave: 'FR', nombre: 'Fuera de rango / sin clasificar', afectaPago: false, requiereAprobacion: true, requiereDocumento: false, esAutomatica: true },
  { clave: 'AJM', nombre: 'Ajuste manual', afectaPago: false, requiereAprobacion: true, requiereDocumento: true, esAutomatica: false }
];

const ESTATUS_INCIDENCIA = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aprobada', label: 'Aprobada' },
  { value: 'rechazada', label: 'Rechazada' },
  { value: 'cancelada', label: 'Cancelada' }
];

module.exports = { DEFAULT_TIPOS_INCIDENCIA, ESTATUS_INCIDENCIA };
