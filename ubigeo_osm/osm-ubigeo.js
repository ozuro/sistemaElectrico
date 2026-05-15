(function () {
  const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
  ];
  const MINAM_UBIGEO_URL = 'https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioUbigeo/MapServer/0/query';
  const DEG = Math.PI / 180;
  const statusEl = document.getElementById('status');
  const ubigeoInput = document.getElementById('ubigeoInput');
  const modeInput = document.getElementById('modeInput');
  const downloadBtn = document.getElementById('downloadBtn');
  const map = L.map('map').setView([-15.84, -70.02], 9);
  const layers = L.featureGroup().addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  const ROAD_LAYERS = {
    OSM_CARRETERA: 1,
    OSM_CALLES: 3,
    OSM_TROCHAS: 30,
    OSM_CAMINOS: 94,
    OSM_PASAJES: 40,
    OSM_SERVICIOS: 8
  };

  const WATER_LAYERS = {
    OSM_RIOS: 5,
    OSM_QUEBRADAS: 151,
    OSM_CANALES: 4,
    OSM_DRENES: 140,
    OSM_LAGUNAS: 130,
    OSM_CUERPOS_AGUA: 150
  };

  function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`.trim();
  }

  function cleanUbigeo(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 6);
  }

  function escapeOverpass(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  async function postOverpass(query) {
    let lastError = null;
    for (const url of OVERPASS_URLS) {
      const attempts = [
        () => fetch(`${url}?data=${encodeURIComponent(query)}`, { method: 'GET' }),
        () => fetch(url, { method: 'POST', body: query }),
        () => fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: query
        })
      ];

      for (const attempt of attempts) {
        try {
          const response = await attempt();
          if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
          return await response.json();
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw new Error(`No se pudo consultar Overpass API. Detalle: ${lastError?.message || 'conexion bloqueada'}`);
  }

  function ringArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return area / 2;
  }

  function closeRing(ring) {
    if (!ring.length) return ring;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return ring;
  }

  function normalizeRing(points) {
    const ring = points
      .map((p) => [Number(p.lon), Number(p.lat)])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    return closeRing(ring);
  }

  function normalizeLine(points) {
    return points
      .map((p) => [Number(p.lon), Number(p.lat)])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  }

  function coordKey(coord) {
    return `${round(coord[0], 7)},${round(coord[1], 7)}`;
  }

  function reverseLine(line) {
    return line.slice().reverse();
  }

  function assembleRings(lines) {
    const segments = lines.map((line) => line.slice()).filter((line) => line.length > 1);
    const rings = [];
    while (segments.length) {
      let ring = segments.shift();
      let changed = true;
      while (changed && coordKey(ring[0]) !== coordKey(ring[ring.length - 1])) {
        changed = false;
        for (let i = 0; i < segments.length; i += 1) {
          const candidate = segments[i];
          const first = coordKey(candidate[0]);
          const last = coordKey(candidate[candidate.length - 1]);
          const ringFirst = coordKey(ring[0]);
          const ringLast = coordKey(ring[ring.length - 1]);
          if (first === ringLast) {
            ring = ring.concat(candidate.slice(1));
          } else if (last === ringLast) {
            ring = ring.concat(reverseLine(candidate).slice(1));
          } else if (last === ringFirst) {
            ring = candidate.concat(ring.slice(1));
          } else if (first === ringFirst) {
            ring = reverseLine(candidate).concat(ring.slice(1));
          } else {
            continue;
          }
          segments.splice(i, 1);
          changed = true;
          break;
        }
      }
      if (ring.length >= 3 && coordKey(ring[0]) === coordKey(ring[ring.length - 1])) {
        rings.push(closeRing(ring));
      }
    }
    return rings.filter((ring) => ring.length >= 4);
  }

  function relationGeometryToPolygon(relation) {
    const outerLines = [];
    const innerLines = [];
    for (const member of relation.members || []) {
      if (member.type !== 'way' || !Array.isArray(member.geometry) || member.geometry.length < 2) continue;
      const line = normalizeLine(member.geometry);
      if (line.length < 2) continue;
      if (member.role === 'inner') innerLines.push(line);
      else outerLines.push(line);
    }

    const outerRings = assembleRings(outerLines);
    const innerRings = assembleRings(innerLines);
    outerRings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    if (!outerRings.length) throw new Error('La relacion del UBIGEO no contiene poligono util.');
    return {
      type: outerRings.length === 1 ? 'Polygon' : 'MultiPolygon',
      coordinates: outerRings.length === 1
        ? [outerRings[0], ...innerRings]
        : outerRings.map((ring) => [ring])
    };
  }

  function polygonRings(geometry) {
    if (geometry.type === 'Polygon') return geometry.coordinates;
    return geometry.coordinates.flat();
  }

  function polygonToOverpassPoly(geometry) {
    let largest = polygonRings(geometry)[0] || [];
    for (const ring of polygonRings(geometry)) {
      if (Math.abs(ringArea(ring)) > Math.abs(ringArea(largest))) largest = ring;
    }
    const simplified = simplifyRingForOverpass(largest);
    return simplified.map(([lon, lat]) => `${round(lat, 7)} ${round(lon, 7)}`).join(' ');
  }

  function simplifyRingForOverpass(ring) {
    if (ring.length <= 350) return ring;
    const step = Math.ceil(ring.length / 350);
    const simplified = ring.filter((_, index) => index % step === 0);
    return closeRing(simplified);
  }

  async function fetchDistrictPolygonFromOsm(ubigeo) {
    const query = `
      [out:json][timeout:60];
      (
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["ref:ubigeo"="${escapeOverpass(ubigeo)}"];
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["ref:INEI"="${escapeOverpass(ubigeo)}"];
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["ref:inei"="${escapeOverpass(ubigeo)}"];
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["ubigeo"="${escapeOverpass(ubigeo)}"];
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["INEI"="${escapeOverpass(ubigeo)}"];
        relation["boundary"="administrative"]["admin_level"~"^(8|9)$"]["inei"="${escapeOverpass(ubigeo)}"];
      );
      out geom;
    `;
    const data = await postOverpass(query);
    const relation = (data.elements || []).find((el) => el.type === 'relation');
    if (!relation) {
      throw new Error(`OSM no tiene el limite ${ubigeo} etiquetado con UBIGEO.`);
    }
    return {
      geometry: relationGeometryToPolygon(relation),
      tags: relation.tags || {},
      source: 'OpenStreetMap'
    };
  }

  async function fetchDistrictPolygonFromMinam(ubigeo) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: `IDDIST='${ubigeo}' OR DCTO='${ubigeo}'`,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326'
    });
    const response = await fetch(`${MINAM_UBIGEO_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status} consultando MINAM UBIGEO.`);
    const data = await response.json();
    const feature = (data.features || [])[0];
    if (!feature?.geometry) throw new Error(`No encontre el poligono del distrito ${ubigeo} en MINAM.`);
    const props = feature.properties || {};
    return {
      geometry: feature.geometry,
      tags: {
        name: props.NOMBDIST || props.NOMBRE || '',
        province: props.NOMBPROV || '',
        department: props.NOMBDEP || ''
      },
      source: 'MINAM ServicioUbigeo'
    };
  }

  async function fetchDistrictPolygon(ubigeo) {
    try {
      return await fetchDistrictPolygonFromOsm(ubigeo);
    } catch (osmError) {
      console.warn('No se obtuvo limite por OSM; usando MINAM:', osmError);
      const district = await fetchDistrictPolygonFromMinam(ubigeo);
      district.osmWarning = osmError.message;
      return district;
    }
  }

  function buildOsmQuery(poly, includeWater) {
    const water = includeWater ? `
        way["waterway"~"^(river|stream|canal|ditch|drain)$"](poly:"${poly}");
        relation["waterway"~"^(river|stream|canal|ditch|drain)$"](poly:"${poly}");
        way["natural"="water"](poly:"${poly}");
        relation["natural"="water"](poly:"${poly}");
        way["water"~"^(river|lake|reservoir)$"](poly:"${poly}");
        relation["water"~"^(river|lake|reservoir)$"](poly:"${poly}");
    ` : '';
    return `
      [out:json][timeout:120];
      (
        way["highway"](poly:"${poly}");
        relation["highway"](poly:"${poly}");
        ${water}
      );
      out tags geom;
    `;
  }

  function getUtmZone(lon) {
    return Math.floor((lon + 180) / 6) + 1;
  }

  function wgs84ToUtm(lat, lon, zoneOverride) {
    const zone = zoneOverride || getUtmZone(lon);
    const latRad = lat * DEG;
    const lonRad = lon * DEG;
    const lonOrigin = ((zone - 1) * 6 - 180 + 3) * DEG;
    const a = 6378137.0;
    const eccSquared = 0.00669437999014;
    const k0 = 0.9996;
    const eccPrimeSquared = eccSquared / (1 - eccSquared);
    const n = a / Math.sqrt(1 - eccSquared * Math.sin(latRad) ** 2);
    const t = Math.tan(latRad) ** 2;
    const c = eccPrimeSquared * Math.cos(latRad) ** 2;
    const aa = Math.cos(latRad) * (lonRad - lonOrigin);
    const m = a * (
      (1 - eccSquared / 4 - 3 * eccSquared ** 2 / 64 - 5 * eccSquared ** 3 / 256) * latRad -
      (3 * eccSquared / 8 + 3 * eccSquared ** 2 / 32 + 45 * eccSquared ** 3 / 1024) * Math.sin(2 * latRad) +
      (15 * eccSquared ** 2 / 256 + 45 * eccSquared ** 3 / 1024) * Math.sin(4 * latRad) -
      (35 * eccSquared ** 3 / 3072) * Math.sin(6 * latRad)
    );
    const easting = k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * eccPrimeSquared) * aa ** 5 / 120) + 500000;
    let northing = k0 * (m + n * Math.tan(latRad) * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * eccPrimeSquared) * aa ** 6 / 720));
    if (lat < 0) northing += 10000000;
    return { easting, northing, zone, hemisphere: lat < 0 ? 'S' : 'N' };
  }

  function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round(Number(value) * factor) / factor;
  }

  function centroidLonLat(geometry) {
    if (window.turf) {
      return turf.centroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates;
    }
    const ring = polygonRings(geometry)[0] || [[-70, -15]];
    const sum = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / ring.length, sum[1] / ring.length];
  }

  function utmZoneForDistrict(ubigeo, geometry) {
    if (String(ubigeo).startsWith('21')) return 19;
    const [lon] = centroidLonLat(geometry);
    return getUtmZone(lon);
  }

  function pointInDistrict(coord, district) {
    if (window.turf) return turf.booleanPointInPolygon(turf.point(coord), district);
    return pointInRing(coord, polygonRings(district.geometry)[0] || []);
  }

  function pointInRing(point, ring) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function classifyRoad(tags) {
    const highway = tags.highway || '';
    if (/^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(highway)) return 'OSM_CARRETERA';
    if (/^(residential|living_street|unclassified|road)$/.test(highway)) return 'OSM_CALLES';
    if (/^track$/.test(highway)) return 'OSM_TROCHAS';
    if (/^(path|footway|bridleway|cycleway)$/.test(highway)) return 'OSM_CAMINOS';
    if (/^(pedestrian|steps|corridor)$/.test(highway)) return 'OSM_PASAJES';
    if (/^(service|services|bus_guideway)$/.test(highway)) return 'OSM_SERVICIOS';
    return 'OSM_CALLES';
  }

  function classifyWater(tags, closed) {
    const waterway = tags.waterway || '';
    const water = tags.water || '';
    if (waterway === 'river') return 'OSM_RIOS';
    if (waterway === 'stream') return 'OSM_QUEBRADAS';
    if (waterway === 'canal') return 'OSM_CANALES';
    if (/^(ditch|drain)$/.test(waterway)) return 'OSM_DRENES';
    if (closed && /^(lake|reservoir)$/.test(water)) return 'OSM_LAGUNAS';
    if (closed && tags.natural === 'water') return 'OSM_CUERPOS_AGUA';
    if (water === 'river') return 'OSM_RIOS';
    return closed ? 'OSM_CUERPOS_AGUA' : 'OSM_RIOS';
  }

  function elementGeometry(element) {
    if (Array.isArray(element.geometry) && element.geometry.length > 1) {
      return element.geometry.map((p) => [Number(p.lon), Number(p.lat)]).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    }
    const lines = [];
    for (const member of element.members || []) {
      if (member.type === 'way' && Array.isArray(member.geometry) && member.geometry.length > 1) {
        lines.push(member.geometry.map((p) => [Number(p.lon), Number(p.lat)]).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)));
      }
    }
    return lines.length === 1 ? lines[0] : lines;
  }

  function isClosed(coords) {
    if (!Array.isArray(coords) || coords.length < 4) return false;
    const first = coords[0];
    const last = coords[coords.length - 1];
    return first[0] === last[0] && first[1] === last[1];
  }

  function geometryFeature(coords, closed, props) {
    if (closed) return turfFeature({ type: 'Polygon', coordinates: [closeRing(coords.slice())] }, props);
    return turfFeature({ type: 'LineString', coordinates: coords }, props);
  }

  function turfFeature(geometry, props) {
    return { type: 'Feature', properties: props, geometry };
  }

  function splitInsideSegments(lineFeature, district) {
    if (!window.turf) return basicInsideSegments(lineFeature.geometry.coordinates, district);
    try {
      const boundary = turf.polygonToLine(district);
      const split = turf.lineSplit(lineFeature, boundary);
      const pieces = split.features.length ? split.features : [lineFeature];
      return pieces
        .map((piece) => piece.geometry.coordinates)
        .filter((coords) => coords.length > 1)
        .filter((coords) => {
          const mid = coords[Math.floor(coords.length / 2)];
          return pointInDistrict(mid, district);
        });
    } catch (error) {
      return basicInsideSegments(lineFeature.geometry.coordinates, district);
    }
  }

  function basicInsideSegments(coords, district) {
    const segments = [];
    let current = [];
    for (const coord of coords) {
      if (pointInDistrict(coord, district)) {
        current.push(coord);
      } else if (current.length > 1) {
        segments.push(current);
        current = [];
      } else {
        current = [];
      }
    }
    if (current.length > 1) segments.push(current);
    return segments;
  }

  function polygonInside(feature, district) {
    if (!window.turf) return pointInDistrict(feature.geometry.coordinates[0][0], district);
    try {
      const clipped = turf.intersect(feature, district);
      return clipped || null;
    } catch (error) {
      return turf.booleanPointInPolygon(turf.centroid(feature), district) ? feature : null;
    }
  }

  function convertElements(elements, district, zone) {
    const seen = new Set();
    const features = [];
    const stats = { roads: 0, waterLines: 0, waterAreas: 0, skippedDuplicates: 0 };

    for (const element of elements) {
      const tags = element.tags || {};
      const rawGeom = elementGeometry(element);
      const geometries = Array.isArray(rawGeom[0]?.[0]) ? rawGeom : [rawGeom];
      for (const coords of geometries) {
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const closed = isClosed(coords);
        const isRoad = Boolean(tags.highway);
        const isWater = Boolean(tags.waterway || tags.natural === 'water' || tags.water);
        if (!isRoad && !isWater) continue;
        const layer = isRoad ? classifyRoad(tags) : classifyWater(tags, closed);
        const props = {
          osm_id: `${element.type}/${element.id}`,
          layer,
          name: tags.name || '',
          type: tags.highway || tags.waterway || tags.water || tags.natural || '',
          width: tags.width || '',
          lanes: tags.lanes || '',
          surface: tags.surface || '',
          source: 'OpenStreetMap',
          utm_zone: zone ? `${zone}S` : ''
        };
        const baseKey = `${props.osm_id}:${layer}:${coords.map((c) => c.join(',')).join(';')}`;
        if (seen.has(baseKey)) {
          stats.skippedDuplicates += 1;
          continue;
        }
        seen.add(baseKey);

        if (closed && isWater) {
          const feature = geometryFeature(coords, true, props);
          const clipped = polygonInside(feature, district);
          if (!clipped) continue;
          const rings = clipped.geometry.type === 'Polygon'
            ? clipped.geometry.coordinates
            : clipped.geometry.coordinates.flatMap((polygon) => polygon);
          for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 4) continue;
            features.push(projectFeature(turfFeature({ type: 'Polygon', coordinates: [closeRing(ring.slice())] }, props), zone));
            stats.waterAreas += 1;
          }
          continue;
        }

        const feature = geometryFeature(coords, false, props);
        for (const segment of splitInsideSegments(feature, district)) {
          const projected = projectFeature(turfFeature({ type: 'LineString', coordinates: segment }, props), zone);
          if (projected.geometry.coordinates.length > 1) {
            features.push(projected);
            if (isRoad) stats.roads += 1;
            else stats.waterLines += 1;
          }
        }
      }
    }
    return { features, stats };
  }

  function projectCoord(coord, zone) {
    const [lon, lat] = coord;
    const utm = wgs84ToUtm(lat, lon, zone);
    return [round(utm.easting, 3), round(utm.northing, 3)];
  }

  function projectFeature(feature, zone) {
    if (!zone) return JSON.parse(JSON.stringify(feature));
    const geometry = feature.geometry;
    if (geometry.type === 'LineString') {
      return turfFeature({ type: 'LineString', coordinates: geometry.coordinates.map((coord) => projectCoord(coord, zone)) }, feature.properties);
    }
    return turfFeature({ type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map((coord) => projectCoord(coord, zone))) }, feature.properties);
  }

  function dxfText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  class DxfWriter {
    constructor() {
      this.layers = new Map();
      this.entities = [];
      this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }

    ensureLayer(name, color = 7) {
      if (!this.layers.has(name)) this.layers.set(name, color);
    }

    track(x, y) {
      this.bounds.minX = Math.min(this.bounds.minX, x);
      this.bounds.minY = Math.min(this.bounds.minY, y);
      this.bounds.maxX = Math.max(this.bounds.maxX, x);
      this.bounds.maxY = Math.max(this.bounds.maxY, y);
    }

    addPolyline(layer, coords, closed, color) {
      if (!coords || coords.length < 2) return;
      this.ensureLayer(layer, color);
      coords.forEach(([x, y]) => this.track(x, y));
      const lines = ['0', 'POLYLINE', '8', layer, '62', String(color), '66', '1', '70', closed ? '1' : '0', '10', '0', '20', '0', '30', '0'];
      coords.forEach(([x, y]) => lines.push('0', 'VERTEX', '8', layer, '10', String(round(x, 3)), '20', String(round(y, 3)), '30', '0'));
      lines.push('0', 'SEQEND', '8', layer);
      this.entities.push(lines.join('\n'));
    }

    addText(layer, coord, text, color) {
      const value = dxfText(text);
      if (!value || !coord) return;
      this.ensureLayer(layer, color);
      this.track(coord[0], coord[1]);
      this.entities.push(['0', 'TEXT', '8', layer, '62', String(color), '10', String(round(coord[0], 3)), '20', String(round(coord[1], 3)), '30', '0', '40', '2.5', '1', value].join('\n'));
    }

    toString() {
      const minX = Number.isFinite(this.bounds.minX) ? this.bounds.minX : 0;
      const minY = Number.isFinite(this.bounds.minY) ? this.bounds.minY : 0;
      const maxX = Number.isFinite(this.bounds.maxX) ? this.bounds.maxX : 100;
      const maxY = Number.isFinite(this.bounds.maxY) ? this.bounds.maxY : 100;
      const layerTable = Array.from(this.layers.entries()).map(([name, color]) => ['0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS'].join('\n')).join('\n');
      return ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '6', '9', '$EXTMIN', '10', String(round(minX, 3)), '20', String(round(minY, 3)), '30', '0', '9', '$EXTMAX', '10', String(round(maxX, 3)), '20', String(round(maxY, 3)), '30', '0', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LTYPE', '70', '1', '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0', '0', 'ENDTAB', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size), layerTable, '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', this.entities.join('\n'), '0', 'ENDSEC', '0', 'EOF'].join('\n');
    }
  }

  function firstCoord(feature) {
    if (feature.geometry.type === 'LineString') return feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)];
    const ring = feature.geometry.coordinates[0];
    return ring[Math.floor(ring.length / 2)];
  }

  function buildDxf(features) {
    const writer = new DxfWriter();
    Object.entries({ ...ROAD_LAYERS, ...WATER_LAYERS }).forEach(([name, color]) => writer.ensureLayer(name, color));
    writer.ensureLayer('OSM_TEXTOS', 7);
    for (const feature of features) {
      const layer = feature.properties.layer;
      const color = ROAD_LAYERS[layer] || WATER_LAYERS[layer] || 7;
      if (feature.geometry.type === 'LineString') {
        writer.addPolyline(layer, feature.geometry.coordinates, false, color);
      } else if (feature.geometry.type === 'Polygon') {
        for (const ring of feature.geometry.coordinates) writer.addPolyline(layer, ring, true, color);
      }
      const label = [feature.properties.name, feature.properties.type].filter(Boolean).join(' | ');
      if (label) writer.addText('OSM_TEXTOS', firstCoord(feature), label, 7);
    }
    return writer.toString();
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 700);
  }

  function drawPreview(district, features) {
    layers.clearLayers();
    L.geoJSON(district, { style: { color: '#0f172a', weight: 2, fillOpacity: 0.04 } }).addTo(layers);
    const geographicFeatures = features.map((feature) => feature.properties._preview).filter(Boolean);
    L.geoJSON({ type: 'FeatureCollection', features: geographicFeatures }, {
      style: (feature) => ({
        color: feature.properties.layer.startsWith('OSM_') && WATER_LAYERS[feature.properties.layer] ? '#0284c7' : '#475569',
        weight: feature.geometry.type === 'Polygon' ? 1.5 : 2,
        fillOpacity: feature.geometry.type === 'Polygon' ? 0.28 : 0
      })
    }).addTo(layers);
    if (layers.getLayers().length) map.fitBounds(layers.getBounds(), { padding: [18, 18] });
  }

  function attachPreview(projected, source) {
    projected.properties._preview = JSON.parse(JSON.stringify(source));
    return projected;
  }

  function convertElementsWithPreview(elements, district, zone) {
    const result = convertElements(elements, district, zone);
    for (const feature of result.features) feature.properties._preview = null;

    const projectedByKey = new Map();
    result.features.forEach((feature) => {
      const key = `${feature.properties.osm_id}:${feature.properties.layer}:${feature.geometry.type}:${feature.geometry.coordinates.length}`;
      if (!projectedByKey.has(key)) projectedByKey.set(key, []);
      projectedByKey.get(key).push(feature);
    });

    const preview = convertElements(elements, district, null);
    for (const source of preview.features) {
      const key = `${source.properties.osm_id}:${source.properties.layer}:${source.geometry.type}:${source.geometry.coordinates.length}`;
      const bucket = projectedByKey.get(key);
      if (bucket && bucket.length) attachPreview(bucket.shift(), source);
    }
    return result;
  }

  async function runDownload() {
    const ubigeo = cleanUbigeo(ubigeoInput.value);
    ubigeoInput.value = ubigeo;
    if (ubigeo.length !== 6) {
      setStatus('Ingrese un UBIGEO de distrito con 6 digitos.', 'error');
      return;
    }

    downloadBtn.disabled = true;
    try {
      const includeWater = modeInput.value === 'all';
      setStatus(`Buscando poligono del distrito ${ubigeo}...`);
      const districtInfo = await fetchDistrictPolygon(ubigeo);
      const district = turfFeature(districtInfo.geometry, { ubigeo, name: districtInfo.tags.name || '' });
      const zone = utmZoneForDistrict(ubigeo, districtInfo.geometry);
      const poly = polygonToOverpassPoly(districtInfo.geometry);

      setStatus(`Consultando OpenStreetMap dentro del UBIGEO ${ubigeo}. Esto puede tardar segun el tamano del distrito...`);
      const osmData = await postOverpass(buildOsmQuery(poly, includeWater));
      setStatus(`Procesando ${osmData.elements?.length || 0} elementos OSM y recortando al poligono...`);
      const { features, stats } = convertElementsWithPreview(osmData.elements || [], district, zone);

      const cleanFeatures = features.map((feature) => {
        const copy = JSON.parse(JSON.stringify(feature));
        delete copy.properties._preview;
        return copy;
      });
      const geojson = {
        type: 'FeatureCollection',
        name: `base_osm_${ubigeo}`,
        crs: { type: 'name', properties: { name: `EPSG:${32700 + zone}` } },
        properties: {
          ubigeo,
          distrito: districtInfo.tags.name || '',
          polygon_source: districtInfo.source || '',
          polygon_warning: districtInfo.osmWarning || '',
          utm_zone: `${zone}S`,
          x: 'Easting',
          y: 'Northing',
          generated_at: new Date().toISOString(),
          stats
        },
        features: cleanFeatures
      };

      drawPreview(district, features);
      download(`base_osm_${ubigeo}.geojson`, JSON.stringify(geojson, null, 2), 'application/geo+json;charset=utf-8');
      download(`base_osm_${ubigeo}.dxf`, buildDxf(cleanFeatures), 'application/dxf;charset=utf-8');

      const warnings = [];
      if (!stats.roads) warnings.push('no se encontraron vias');
      if (includeWater && !stats.waterLines && !stats.waterAreas) warnings.push('no se encontro hidrografia');
      if (cleanFeatures.length < 10) warnings.push('hay poca informacion; OpenStreetMap puede estar incompleto');
      if (districtInfo.osmWarning) warnings.push(`limite obtenido de ${districtInfo.source}, no de OSM`);
      const summary = `DXF y GeoJSON generados para ${ubigeo}: vias ${stats.roads}, rios/canales/quebradas ${stats.waterLines}, lagunas/cuerpos ${stats.waterAreas}. UTM ${zone}S.`;
      setStatus(warnings.length ? `${summary} Advertencia: ${warnings.join('; ')}.` : summary, warnings.length ? 'warn' : 'ok');
    } catch (error) {
      console.error(error);
      const detail = /Failed to fetch|Load failed|NetworkError/i.test(error.message)
        ? 'El navegador bloqueo o no pudo conectar con Overpass API. Recargue la pagina e intente otra vez; si persiste, abra esta herramienta desde un servidor local en vez de archivo directo.'
        : error.message;
      setStatus(`Error: ${detail}`, 'error');
    } finally {
      downloadBtn.disabled = false;
    }
  }

  downloadBtn.addEventListener('click', runDownload);
  ubigeoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runDownload();
  });

  const params = new URLSearchParams(window.location.search);
  const initialUbigeo = cleanUbigeo(params.get('ubigeo'));
  if (initialUbigeo) ubigeoInput.value = initialUbigeo;

  window.OsmUbigeoTool = {
    cleanUbigeo,
    setStatus,
    fetchDistrictPolygon,
    turfFeature,
    utmZoneForDistrict,
    polygonToOverpassPoly,
    postOverpass,
    buildOsmQuery,
    convertElements,
    download
  };
})();
