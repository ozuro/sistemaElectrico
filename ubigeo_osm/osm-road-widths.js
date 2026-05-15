(function () {
  const btn = document.getElementById('roadWidthBtn');
  const ubigeoInput = document.getElementById('ubigeoInput');
  const api = window.OsmUbigeoTool;

  const LAYER_BY_BASE = {
    OSM_CARRETERA: 'OSM_BORDE_CARRETERA',
    OSM_CALLES: 'OSM_BORDE_CALLES',
    OSM_TROCHAS: 'OSM_BORDE_TROCHAS',
    OSM_CAMINOS: 'OSM_BORDE_CAMINOS',
    OSM_PASAJES: 'OSM_BORDE_PASAJES',
    OSM_SERVICIOS: 'OSM_BORDE_SERVICIOS'
  };

  const COLORS = {
    OSM_BORDE_CARRETERA: 1,
    OSM_BORDE_CALLES: 3,
    OSM_BORDE_TROCHAS: 30,
    OSM_BORDE_CAMINOS: 94,
    OSM_BORDE_PASAJES: 40,
    OSM_BORDE_SERVICIOS: 8,
    OSM_ANCHO_TEXTOS: 7
  };

  function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round(Number(value) * factor) / factor;
  }

  function parseMeters(value) {
    const text = String(value || '').toLowerCase().replace(',', '.');
    const match = text.match(/-?\d+(\.\d+)?/);
    if (!match) return 0;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function roadWidthMeters(feature) {
    const p = feature.properties || {};
    const explicit = parseMeters(p.width);
    if (explicit >= 2 && explicit <= 30) return explicit;

    const lanes = parseMeters(p.lanes);
    if (lanes >= 1 && lanes <= 8) return round(Math.max(3, lanes * 3.2), 1);

    const highway = String(p.type || '').toLowerCase();
    if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(highway)) return 7;
    if (/^(residential|living_street|unclassified|road)$/.test(highway)) return 5;
    if (/^track$/.test(highway)) return 4;
    if (/^(service|services|bus_guideway)$/.test(highway)) return 4;
    if (/^(path|footway|bridleway|cycleway|pedestrian|steps|corridor)$/.test(highway)) return 3;
    return 5;
  }

  function cleanCoords(coords) {
    const output = [];
    for (const coord of coords || []) {
      const x = Number(coord[0]);
      const y = Number(coord[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const last = output[output.length - 1];
      if (!last || Math.hypot(x - last[0], y - last[1]) > 0.05) output.push([x, y]);
    }
    return output;
  }

  function segmentNormal(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) return [0, 0];
    return [-dy / len, dx / len];
  }

  function offsetLine(coords, distance) {
    const points = cleanCoords(coords);
    if (points.length < 2) return [];
    const result = [];
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      const next = points[i + 1];
      let nx = 0;
      let ny = 0;

      if (!prev && next) {
        [nx, ny] = segmentNormal(cur, next);
      } else if (prev && !next) {
        [nx, ny] = segmentNormal(prev, cur);
      } else if (prev && next) {
        const n1 = segmentNormal(prev, cur);
        const n2 = segmentNormal(cur, next);
        nx = n1[0] + n2[0];
        ny = n1[1] + n2[1];
        const len = Math.hypot(nx, ny);
        if (len < 0.001) {
          [nx, ny] = n2;
        } else {
          nx /= len;
          ny /= len;
          const dot = Math.max(0.35, Math.min(1.8, nx * n2[0] + ny * n2[1]));
          nx /= dot;
          ny /= dot;
        }
      }

      result.push([round(cur[0] + nx * distance, 3), round(cur[1] + ny * distance, 3)]);
    }
    return result;
  }

  function textSafe(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  class WidthDxfWriter {
    constructor() {
      this.layers = new Map();
      this.entities = [];
      this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }

    ensureLayer(layer, color = 7) {
      if (!this.layers.has(layer)) this.layers.set(layer, color);
    }

    track(x, y) {
      this.bounds.minX = Math.min(this.bounds.minX, x);
      this.bounds.minY = Math.min(this.bounds.minY, y);
      this.bounds.maxX = Math.max(this.bounds.maxX, x);
      this.bounds.maxY = Math.max(this.bounds.maxY, y);
    }

    addPolyline(layer, coords, color) {
      if (!coords || coords.length < 2) return;
      this.ensureLayer(layer, color);
      coords.forEach(([x, y]) => this.track(x, y));
      const entity = ['0', 'POLYLINE', '8', layer, '62', String(color), '66', '1', '70', '0', '10', '0', '20', '0', '30', '0'];
      coords.forEach(([x, y]) => entity.push('0', 'VERTEX', '8', layer, '10', String(round(x, 3)), '20', String(round(y, 3)), '30', '0'));
      entity.push('0', 'SEQEND', '8', layer);
      this.entities.push(entity.join('\n'));
    }

    addText(layer, coord, value, color = 7) {
      const text = textSafe(value);
      if (!text || !coord) return;
      this.ensureLayer(layer, color);
      this.track(coord[0], coord[1]);
      this.entities.push(['0', 'TEXT', '8', layer, '62', String(color), '10', String(round(coord[0], 3)), '20', String(round(coord[1], 3)), '30', '0', '40', '2.2', '1', text].join('\n'));
    }

    toString() {
      Object.entries(COLORS).forEach(([layer, color]) => this.ensureLayer(layer, color));
      const minX = Number.isFinite(this.bounds.minX) ? this.bounds.minX : 0;
      const minY = Number.isFinite(this.bounds.minY) ? this.bounds.minY : 0;
      const maxX = Number.isFinite(this.bounds.maxX) ? this.bounds.maxX : 100;
      const maxY = Number.isFinite(this.bounds.maxY) ? this.bounds.maxY : 100;
      const layerTable = Array.from(this.layers.entries()).map(([name, color]) => ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS'].join('\n')).join('\n');
      return ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '9', '$EXTMIN', '10', String(round(minX, 3)), '20', String(round(minY, 3)), '30', '0', '9', '$EXTMAX', '10', String(round(maxX, 3)), '20', String(round(maxY, 3)), '30', '0', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0', '0', 'ENDTAB', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size), layerTable, '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', this.entities.join('\n'), '0', 'ENDSEC', '0', 'EOF'].join('\n');
    }
  }

  function midpoint(coords) {
    const points = cleanCoords(coords);
    return points[Math.floor(points.length / 2)] || null;
  }

  function buildRoadWidthDxf(features) {
    const writer = new WidthDxfWriter();
    let count = 0;
    for (const feature of features) {
      if (feature.geometry?.type !== 'LineString') continue;
      const baseLayer = feature.properties?.layer || 'OSM_CALLES';
      const layer = LAYER_BY_BASE[baseLayer] || 'OSM_BORDE_CALLES';
      const color = COLORS[layer] || 7;
      const width = roadWidthMeters(feature);
      const half = width / 2;
      const coords = cleanCoords(feature.geometry.coordinates);
      if (coords.length < 2) continue;
      writer.addPolyline(layer, offsetLine(coords, half), color);
      writer.addPolyline(layer, offsetLine(coords, -half), color);
      writer.addText('OSM_ANCHO_TEXTOS', midpoint(coords), `${feature.properties?.name || feature.properties?.type || 'via'} | ancho ${width} m`, 7);
      count += 1;
    }
    return { dxf: writer.toString(), count };
  }

  async function downloadRoadWidths() {
    if (!api) {
      alert('El modulo OSM base no esta disponible.');
      return;
    }
    const ubigeo = api.cleanUbigeo(ubigeoInput.value);
    ubigeoInput.value = ubigeo;
    if (ubigeo.length !== 6) {
      api.setStatus('Ingrese un UBIGEO de distrito con 6 digitos.', 'error');
      return;
    }

    btn.disabled = true;
    try {
      api.setStatus(`Preparando calles con ancho referencial para ${ubigeo}...`);
      const districtInfo = await api.fetchDistrictPolygon(ubigeo);
      const district = api.turfFeature(districtInfo.geometry, { ubigeo, name: districtInfo.tags.name || '' });
      const zone = api.utmZoneForDistrict(ubigeo, districtInfo.geometry);
      const poly = api.polygonToOverpassPoly(districtInfo.geometry);
      const osmData = await api.postOverpass(api.buildOsmQuery(poly, false));
      const { features, stats } = api.convertElements(osmData.elements || [], district, zone);
      const roads = features.filter((feature) => feature.geometry?.type === 'LineString' && feature.properties?.layer);
      const { dxf, count } = buildRoadWidthDxf(roads);
      if (!count) {
        api.setStatus('No se encontraron vias OSM para generar bordes de calles.', 'warn');
        return;
      }
      api.download(`base_osm_${ubigeo}_calles_ancho.dxf`, dxf, 'application/dxf;charset=utf-8');
      const note = districtInfo.osmWarning ? ` Limite obtenido de ${districtInfo.source}.` : '';
      api.setStatus(`DXF de calles con ancho generado: ${count} vias, UTM ${zone}S. Anchos referenciales por tipo OSM: principal 7 m, calles 5 m, trochas/servicio 4 m, caminos/pasajes 3 m.${note}`, districtInfo.osmWarning ? 'warn' : 'ok');
    } catch (error) {
      console.error(error);
      api.setStatus(`Error al generar calles con ancho: ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  if (btn) btn.addEventListener('click', downloadRoadWidths);
})();
