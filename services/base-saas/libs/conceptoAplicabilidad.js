'use strict';

/**
 * Filtros de alcance del concepto.
 * Lista vacía / ausente = aplica a todos.
 * Valor actual vacío en empleado = no restringe (compat).
 */
function listaAplica(lista, valorActual, { requireValor = false } = {}) {
  const list = Array.isArray(lista)
    ? lista.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (!list.length) return true;
  const v = String(valorActual || '').trim();
  if (!v) return !requireValor;
  return list.includes(v);
}

function conceptoAplicaEnCalculo(conceptoMeta, { tipoEmpleado, tipoPeriodo, tipoNomina } = {}) {
  const meta = conceptoMeta || {};
  if (!listaAplica(meta.aplicaTiposEmpleado, tipoEmpleado)) return false;
  if (!listaAplica(meta.aplicaTiposPeriodo, tipoPeriodo, { requireValor: true })) return false;
  if (!listaAplica(meta.aplicaTipoNomina, tipoNomina, { requireValor: true })) return false;
  return true;
}

function parseBodyStringList(bodyValue) {
  if (Array.isArray(bodyValue)) {
    return bodyValue.map((s) => String(s).trim()).filter(Boolean);
  }
  if (bodyValue == null || bodyValue === '') return [];
  return String(bodyValue)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = {
  listaAplica,
  conceptoAplicaEnCalculo,
  parseBodyStringList
};
