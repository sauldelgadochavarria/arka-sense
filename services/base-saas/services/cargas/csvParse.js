'use strict';

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text) {
  const raw = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!raw) return { headers: [], rows: [] };

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] != null ? cols[idx] : '';
    });
    rows.push({ fila: i + 1, data: obj });
  }
  return { headers, rows };
}

function toNum(v, fallback = null) {
  if (v == null || String(v).trim() === '') return fallback;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function toDate(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const d = new Date(s.includes('T') ? s : `${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = { parseCsv, splitCsvLine, toNum, toDate };
