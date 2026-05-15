const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('assets/js/proyectadas/proyectadas-guiadas.js', 'utf8');

function makeLayer() {
  return {
    items: [],
    addLayer(item) { this.items.push(item); return this; },
    clearLayers() { this.items = []; return this; },
    getLayers() { return this.items; },
    addTo() { return this; }
  };
}

const context = {
  console,
  document: {
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    createElement() { return { style: {}, remove() {}, set id(value) { this._id = value; }, get id() { return this._id; } }; },
    getElementById() { return null; }
  },
  localStorage: {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
    removeItem(key) { delete this.data[key]; }
  },
  window: {},
  map: { on() {}, off() {}, once() {}, getContainer() { return { style: {} }; } },
  capaExcel: makeLayer(),
  L: {
    featureGroup: makeLayer,
    circleMarker() { return { bindTooltip() { return this; }, bindPopup() { return this; }, on() { return this; }, addTo(layer) { layer.addLayer(this); return this; }, bringToFront() {} }; },
    marker() { return { bindTooltip() { return this; }, on() { return this; }, addTo(layer) { layer.addLayer(this); return this; } }; },
    polyline() { return { bindTooltip() { return this; }, addTo(layer) { layer.addLayer(this); return this; } }; },
    divIcon(options) { return options; },
    DomEvent: { stop() {} }
  },
  showNotification() {},
  showLoadingMessage() {},
  hideLoadingMessage() {},
  construirProyectoRedcadDesignerDesdeArcgis: async () => ({
    parentSubstationId: 'SEDTEST',
    existingNetwork: { clients: [], substations: [], poles: [], btLines: [], mtLpLines: [] }
  }),
  wgs84ToUtm: (lat, lon) => ({ easting: lon * 1000, northing: lat * 1000 })
};

context.window = context;
vm.createContext(context);
vm.runInContext(source, context);

if (typeof context.window.iniciarProyectadasGuiadas !== 'function') {
  throw new Error('No se expuso iniciarProyectadasGuiadas');
}

console.log('OK proyectadas guiadas cargado');
