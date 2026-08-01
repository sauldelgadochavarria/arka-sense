'use strict';

const mongoose = require('mongoose');

function trimString(value) {
  return String(value || '').trim();
}

function trimUpper(value) {
  return trimString(value).toUpperCase();
}

function trimLower(value) {
  return trimString(value).toLowerCase();
}

function parseOptionalObjectId(value) {
  const id = trimString(value);
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return id;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePositiveNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) return null;
  return num;
}

function parseOptionalPositiveNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  return parsePositiveNumber(value);
}

function parseOptionalLegadoCode(value) {
  if (value === '' || value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseCheckbox(body, fieldName) {
  if (!body || !(fieldName in body)) return false;
  const value = body[fieldName];
  return value === '1' || value === 'on' || value === true || value === 'true';
}

function parseObjectIdArray(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .map((id) => trimString(id))
    .filter((id) => id && mongoose.Types.ObjectId.isValid(id));
}

module.exports = {
  trimString,
  trimUpper,
  trimLower,
  parseOptionalObjectId,
  parseDate,
  parsePositiveNumber,
  parseOptionalPositiveNumber,
  parseOptionalLegadoCode,
  toDateInputValue,
  parseCheckbox,
  parseObjectIdArray
};
