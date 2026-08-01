'use strict';

const contpaqi = require('./adapters/contpaqiAdapter');
const aspel = require('./adapters/aspelAdapter');
const sap = require('./adapters/sapAdapter');
const csv = require('./adapters/csvAdapter');

const ADAPTERS = new Map([
  [contpaqi.id, contpaqi],
  [aspel.id, aspel],
  [sap.id, sap],
  [csv.id, csv]
]);

function getAdapter(adaptador) {
  return ADAPTERS.get(adaptador) || null;
}

function listAdapters() {
  return [...ADAPTERS.values()];
}

module.exports = { getAdapter, listAdapters };
