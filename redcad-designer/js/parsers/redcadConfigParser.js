import { latLonToProjectPoint } from '../gis/coordinateConverter.js';
import { uniqueId } from '../gis/geometryUtils.js';

export async function parseClientWorkbook(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseClientRows(csvToRows(await file.text()));
  }
  if (!window.XLSX) throw new Error('XLSX no esta cargado. No se puede leer Excel.');
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return parseClientRows(rows);
}

function csvToRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() || '').map((h) => h.trim());
  return lines.map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseClientRows(rows) {
  return rows.map((row, index) => {
    const lat = numberFrom(row, ['lat', 'latitud', 'LATITUD', 'LATITTUD', 'y']);
    const lon = numberFrom(row, ['lon', 'longitud', 'LONGITUD', 'x']);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const point = latLonToProjectPoint(lat, lon);
    return {
      id: textFrom(row, ['id', 'codigo', 'CODIGO', 'suministro', 'SUMINISTRO']) || uniqueId('CLI'),
      name: textFrom(row, ['nombre', 'NOMBRE', 'cliente', 'CLIENTE']) || `Cliente nuevo ${index + 1}`,
      source: 'Excel/CSV clientes nuevos',
      demandKw: numberFrom(row, ['demanda', 'DEMANDA', 'kw', 'KW', 'carga', 'CARGA']) || 0,
      type: 'client',
      ...point
    };
  }).filter(Boolean);
}

function textFrom(row, fields) {
  for (const field of fields) {
    const value = row[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function numberFrom(row, fields) {
  const text = textFrom(row, fields).replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}
