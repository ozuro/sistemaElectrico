import { latLonToProjectPoint } from '../gis/coordinateConverter.js';
import { uniqueId } from '../gis/geometryUtils.js';

export function parseKmlText(kmlText) {
  const xml = new DOMParser().parseFromString(kmlText, 'application/xml');
  const placemarks = Array.from(xml.getElementsByTagName('Placemark'));
  const network = {
    substations: [],
    poles: [],
    btLines: [],
    mtLpLines: [],
    serviceDrops: [],
    clients: []
  };

  placemarks.forEach((placemark, index) => {
    const name = textOf(placemark, 'name') || `Elemento ${index + 1}`;
    const description = textOf(placemark, 'description');
    const folderName = findFolderName(placemark);
    const typeText = `${name} ${description} ${folderName}`.toUpperCase();
    const pointNode = placemark.getElementsByTagName('Point')[0];
    const lineNode = placemark.getElementsByTagName('LineString')[0];

    if (pointNode) {
      const point = parseCoordinateText(textOf(pointNode, 'coordinates'))[0];
      if (!point) return;
      const feature = {
        id: stableId(name, index),
        name,
        source: 'KMZ/KML existente',
        folderName,
        ...point
      };
      if (isSubstation(typeText)) network.substations.push({ ...feature, type: 'substation' });
      else if (isClient(typeText)) network.clients.push({ ...feature, type: 'client' });
      else network.poles.push({ ...feature, type: 'pole' });
      return;
    }

    if (lineNode) {
      const points = parseCoordinateText(textOf(lineNode, 'coordinates'));
      if (points.length < 2) return;
      const line = {
        id: stableId(name, index),
        name,
        source: 'KMZ/KML existente',
        folderName,
        points,
        type: isMtLpLine(typeText) ? 'mt_lp' : isServiceDrop(typeText) ? 'service_drop' : 'bt'
      };
      if (line.type === 'mt_lp') network.mtLpLines.push(line);
      else if (line.type === 'service_drop') network.serviceDrops.push(line);
      else network.btLines.push(line);
    }
  });

  return network;
}

function textOf(node, tagName) {
  return node.getElementsByTagName(tagName)[0]?.textContent?.trim() || '';
}

function parseCoordinateText(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((part) => {
      const [lon, lat] = part.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return latLonToProjectPoint(lat, lon);
    })
    .filter(Boolean);
}

function findFolderName(placemark) {
  let node = placemark.parentElement;
  while (node) {
    if (node.tagName === 'Folder') return textOf(node, 'name');
    node = node.parentElement;
  }
  return '';
}

function stableId(name, index) {
  const clean = String(name || '').replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 40);
  return clean ? `${clean}_${index + 1}` : uniqueId('KML');
}

function isSubstation(text) {
  return /SUBEST|SED|S\.E\.|TRANSFORMADOR|TRAFO/.test(text);
}

function isClient(text) {
  return /CLIENTE|SUMINIST|USUARIO|VIVIENDA|CASA|ACOMETIDA/.test(text);
}

function isMtLpLine(text) {
  return /MEDIA|MT|LINEA PRIMARIA|L[ÍI]NEA PRIMARIA| LP |PRIMARIA/.test(text);
}

function isServiceDrop(text) {
  return /ACOMETIDA/.test(text);
}
