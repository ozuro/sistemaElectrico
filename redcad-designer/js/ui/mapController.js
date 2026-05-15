import { addChildSubstation, selectParentSubstation, state } from '../state.js';
import { latLonToProjectPoint } from '../gis/coordinateConverter.js';
import { uniqueId } from '../gis/geometryUtils.js';

let map;
let layers;
let creatingChildSed = false;

export function initMap() {
  map = L.map('map').setView([-15.84, -70.02], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  layers = {
    substations: L.featureGroup().addTo(map),
    poles: L.featureGroup().addTo(map),
    lines: L.featureGroup().addTo(map),
    clients: L.featureGroup().addTo(map),
    childSubstations: L.featureGroup().addTo(map),
    projected: L.featureGroup().addTo(map)
  };

  map.on('click', (event) => {
    if (!creatingChildSed) return;
    if (!state.parentSubstationId) {
      creatingChildSed = false;
      alert('Primero seleccione una subestacion existente como padre.');
      return;
    }
    const point = latLonToProjectPoint(event.latlng.lat, event.latlng.lng);
    addChildSubstation({
      id: uniqueId('SED_PROY'),
      name: `SED proyectada ${state.projected.childSubstations.length + 1}`,
      parentId: state.parentSubstationId,
      capacityKva: 0,
      status: 'proyectada',
      clients: [],
      ...point
    });
    creatingChildSed = false;
    map.getContainer().style.cursor = '';
  });

  return map;
}

export function enableCreateChildSed() {
  creatingChildSed = true;
  map.getContainer().style.cursor = 'crosshair';
  setTimeout(() => {
    if (creatingChildSed) map.getContainer().style.cursor = '';
  }, 12000);
}

export function renderMap(currentState) {
  if (!layers) return;
  Object.values(layers).forEach((layer) => layer.clearLayers());

  currentState.existingNetwork.substations.forEach((sed) => {
    const marker = L.circleMarker([sed.lat, sed.lon], {
      radius: 8,
      color: currentState.parentSubstationId === sed.id ? '#dc2626' : '#2563eb',
      fillColor: currentState.parentSubstationId === sed.id ? '#ef4444' : '#3b82f6',
      fillOpacity: 0.85,
      weight: 2
    }).bindPopup(`<strong>${escapeHtml(sed.name)}</strong><br>Click: seleccionar padre`);
    marker.on('click', () => selectParentSubstation(sed.id));
    marker.addTo(layers.substations);
  });

  currentState.existingNetwork.poles.forEach((pole) => {
    L.circleMarker([pole.lat, pole.lon], {
      radius: 3,
      color: '#475569',
      fillColor: '#64748b',
      fillOpacity: 0.75,
      weight: 1
    }).addTo(layers.poles);
  });

  [...currentState.existingNetwork.btLines, ...currentState.existingNetwork.mtLpLines].forEach((line) => {
    L.polyline(line.points.map((point) => [point.lat, point.lon]), {
      color: line.type === 'mt_lp' ? '#f97316' : '#16a34a',
      weight: 2
    }).addTo(layers.lines);
  });

  getAllClients(currentState).forEach((client) => {
    L.circleMarker([client.lat, client.lon], {
      radius: 4,
      color: '#7c3aed',
      fillColor: '#8b5cf6',
      fillOpacity: 0.75,
      weight: 1
    }).bindTooltip(client.name || client.id).addTo(layers.clients);
  });

  currentState.projected.childSubstations.forEach((sed) => {
    L.circleMarker([sed.lat, sed.lon], {
      radius: 9,
      color: '#0f766e',
      fillColor: '#14b8a6',
      fillOpacity: 0.9,
      weight: 3
    }).bindPopup(`<strong>${escapeHtml(sed.name)}</strong><br>Hija de: ${escapeHtml(sed.parentId)}`).addTo(layers.childSubstations);
  });

  currentState.projected.lines.forEach((line) => {
    L.polyline(line.points.map((point) => [point.lat, point.lon]), {
      color: '#0ea5e9',
      weight: 3,
      dashArray: line.type === 'service_drop' ? '4 5' : ''
    }).addTo(layers.projected);
  });

  currentState.projected.poles.forEach((pole) => {
    L.circleMarker([pole.lat, pole.lon], {
      radius: 4,
      color: '#0f766e',
      fillColor: '#ccfbf1',
      fillOpacity: 1,
      weight: 2
    }).addTo(layers.projected);
  });

  fitWhenUseful();
}

function fitWhenUseful() {
  const group = L.featureGroup(Object.values(layers).flatMap((layer) => layer.getLayers()));
  if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 16 });
}

function getAllClients(currentState) {
  return [...currentState.existingNetwork.clients, ...currentState.newClients];
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
