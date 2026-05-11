(function () {
  const ARCGIS_BASE_URL = 'https://gis.electropuno.com.pe/arcgis_server/rest/services/RedElectroPuno/MapServer';
  const DEG = Math.PI / 180;
  const DEFAULT_POLE_HEIGHT = 8.5;
  const DEFAULT_AERIAL_HEIGHT = 6.8;

  function globalFn(name, fallback) {
    return typeof window[name] === 'function' ? window[name] : fallback;
  }

  const showNotification = globalFn('showNotification', (message) => console.log(message));
  const showLoadingMessage = globalFn('showLoadingMessage', () => {});
  const hideLoadingMessage = globalFn('hideLoadingMessage', () => {});

  const getValueSafe = globalFn('getValue', function (attrs, fields, fallback = 'N/A') {
    for (const field of fields || []) {
      const value = attrs?.[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  });

  const whereEqualsSafe = globalFn('whereEquals', function (field, value) {
    return `${field} = '${String(value ?? '').replace(/'/g, "''")}'`;
  });

  const arcgisQueryUrlSafe = globalFn('arcgisQueryUrl', function (layerId) {
    return `${ARCGIS_BASE_URL}/${layerId}/query`;
  });

  const getTipoSoporteSafe = globalFn('getTipoSoporte', function (codigo) {
    const tipos = { BIP: 'Biposte', EST: 'Estructura', MON: 'Monoposte', NIN: 'Ninguno' };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getMaterialSoporteSafe = globalFn('getMaterialSoporte', function (codigo) {
    const materiales = {
      CO: 'Concreto',
      FI: 'Fierro',
      FG: 'Fierro Galvanizado',
      FN: 'Fierro Negro',
      HO: 'Hormigon',
      MA: 'Madera',
      RI: 'Riel',
      NN: 'Ninguno'
    };
    return materiales[codigo] || codigo || 'N/A';
  });

  const getFuncionEstructuraSafe = globalFn('getFuncionEstructura', function (codigo) {
    const funciones = {
      ALI: 'Alineamiento',
      CAD: 'Cambio de Direccion',
      FDL: 'Fin e Inicio de Linea'
    };
    return funciones[codigo] || codigo || 'N/A';
  });

  const getMaterialConductorSafe = globalFn('getMaterialConductor', function (codigo) {
    const materiales = { CU: 'Cobre', AL: 'Aluminio' };
    return materiales[codigo] || codigo || 'N/A';
  });

  const getEstadoConservacionSafe = globalFn('getEstadoConservacion', function (codigo) {
    const estados = { B: 'Bueno', M: 'Malo', 1: 'Regular 1', 2: 'Regular 2' };
    return estados[codigo] || codigo || 'N/A';
  });

  const getTipoServicioSafe = globalFn('getTipoServicio', function (codigo) {
    const tipos = {
      AP: 'Alumbrado Publico',
      SP: 'Servicio Particular',
      'SP+AP': 'Servicio Particular + Alumbrado Publico'
    };
    return tipos[codigo] || codigo || 'N/A';
  });
  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function htmlEscape(value) {
    return xmlEscape(value).replace(/\n/g, '<br/>');
  }

  function shortText(value, maxLength = 56, fallback = 'N/A') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return fallback;
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}...` : text;
  }
  function formatMetric(value, decimals = 1, unit = '') {
    const parsed = toNumber(value, Number.NaN);
    if (!Number.isFinite(parsed)) return 'N/A';
    return `${parsed.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  }

  function compactBalloon(title, rows = [], note = '') {
    const safeRows = rows
      .filter((row) => row && row.value !== undefined && row.value !== null && String(row.value).trim() !== '')
      .slice(0, 6)
      .map((row) => `
        <tr>
          <td style="padding:2px 10px 2px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${htmlEscape(row.label)}</td>
          <td style="padding:2px 0;color:#111827;vertical-align:top;">${htmlEscape(shortText(row.value, row.maxLength || 64, row.fallback || 'N/A'))}</td>
        </tr>`)
      .join('');

    const footer = note
      ? `<div style="margin-top:6px;color:#6b7280;font-size:11px;">${htmlEscape(shortText(note, 120, ''))}</div>`
      : '';

    return `<![CDATA[
      <div style="font-family:Segoe UI, Arial, sans-serif;font-size:12px;line-height:1.35;min-width:260px;max-width:360px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:#111827;">${htmlEscape(title)}</div>
        <table style="border-collapse:collapse;width:100%;">${safeRows || '<tr><td style="color:#6b7280;">Sin datos</td></tr>'}</table>
        ${footer}
      </div>
    ]]>`;
  }

  function buildTransformerBalloon(attrs, code) {
    return compactBalloon(`Subestacion ${code}`, [
      { label: 'Codigo', value: code },
      { label: 'Nombre', value: getValueSafe(attrs, ['SED_NOM_SED', 'SED_NOM_SUB', 'SED_DES_SED'], 'N/A'), maxLength: 52 },
      { label: 'Potencia', value: `${getValueSafe(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 'N/A')} kVA` },
      { label: 'Tension', value: `${getValueSafe(attrs, ['SED_TEN_NOM_PRI', 'SED_TEN_PRI'], 'N/A')} kV` },
      { label: 'Ubigeo', value: getValueSafe(attrs, ['SED_COD_UBI'], 'N/A') },
      { label: 'Sistema', value: getValueSafe(attrs, ['SED_COD_SIE', 'SED_COD_SET'], 'N/A') }
    ]);
  }

  function buildSupplyHolderName(attrs) {
    const base = getValueSafe(attrs, ['SUM_NOM_SUM', 'SUM_NOM_USU', 'SUM_NOM_CLI', 'SUM_NOMBRE'], 'N/A');
    const last1 = getValueSafe(attrs, ['SUM_APE_PAT', 'SUM_APE_PATERNO', 'SUM_APELLIDO_P', 'SUM_APE1'], '');
    const last2 = getValueSafe(attrs, ['SUM_APE_MAT', 'SUM_APE_MATERNO', 'SUM_APELLIDO_M', 'SUM_APE2'], '');
    return [base, last1, last2].map((part) => String(part ?? '').trim()).filter((part) => part && part !== 'N/A').join(' ') || base;
  }

  function buildSupplyBalloon(attrs, code) {
    const demand = getValueSafe(attrs, ['SUM_MAX_DEM'], 'N/A');
    const eq = getValueSafe(attrs, ['SUM_POT_EQT'], 'N/A');
    const phase = getValueSafe(attrs, ['SUM_MED_FAS'], 'N/A');
    return compactBalloon(`Suministro ${code}`, [
      { label: 'Codigo', value: code },
      { label: 'Titular', value: buildSupplyHolderName(attrs), maxLength: 52 },
      { label: 'Direccion', value: getValueSafe(attrs, ['SUM_DIR_SUM'], 'N/A'), maxLength: 52 },
      { label: 'Transformador', value: getValueSafe(attrs, ['SUM_COD_SED'], 'N/A') },
      { label: 'Demanda / Potencia', value: `${demand} kW | ${eq} kVA` },
      { label: 'Tension / Fase', value: `${getValueSafe(attrs, ['SUM_TEN_SUM'], 'N/A')} V | ${phase}` }
    ]);
  }

  function buildPoleBalloon(attrs, code, height) {
    const arm1 = getValueSafe(attrs, ['NOD_COD_TIP_ARM_01'], '');
    const arm2 = getValueSafe(attrs, ['NOD_COD_TIP_ARM_02'], '');
    const arm3 = getValueSafe(attrs, ['NOD_COD_TIP_ARM_03'], '');
    const arm4 = getValueSafe(attrs, ['NOD_COD_TIP_ARM_04'], '');
    const armado = [arm1, arm2, arm3, arm4].filter((item) => item && item !== 'N/A').join(' / ') || 'N/A';
    return compactBalloon(`Poste ${code}`, [
      { label: 'Codigo', value: code },
      { label: 'Funcion', value: getFuncionEstructuraSafe(getValueSafe(attrs, ['NOD_COD_FNC'], 'N/A')) },
      { label: 'Material / Tipo', value: `${getMaterialSoporteSafe(getValueSafe(attrs, ['NOD_COD_MAT_SPT'], 'N/A'))} / ${getTipoSoporteSafe(getValueSafe(attrs, ['NOD_COD_TIP_SPT'], 'N/A'))}` },
      { label: 'Altura', value: formatMetric(height, 1, 'm') },
      { label: 'Soportes', value: getValueSafe(attrs, ['NOD_CNT_SPT'], 'N/A') },
      { label: 'Estado / Armado', value: `${getEstadoConservacionSafe(getValueSafe(attrs, ['NOD_EST_CONS', 'NOD_EST_PST'], 'N/A'))} | ${shortText(armado, 48, 'N/A')}` }
    ]);
  }

  function getTipoRedLabel(codigo) {
    const tipos = { A: 'Aereo', S: 'Subterraneo', C: 'Subacuatico' };
    return tipos[normalizeCode(codigo)] || codigo || 'N/A';
  }

  function getPhaseLabel(attrs) {
    const raw = normalizeCode(getValueSafe(attrs, ['TBT_COD_TEC_FAS', 'TBT_SP_COD_FAS', 'TBT_AP_COD_FAS', 'TBT_COD_FAS'], ''));
    if (!raw) return 'N/A';
    if (/TRI|3F|ABC|RST|3/.test(raw)) return 'Trifasico';
    if (/BI|2F|AB|AC|BC|RS|RT|ST|2/.test(raw)) return 'Bifasico';
    if (/MONO|1F|^[ABC]$|^[RST]$|1/.test(raw)) return 'Monofasico';
    return raw;
  }

  function buildCableBalloon(attrs, tramoCode, a, b, tipoRed, wireIndex, wires, poleA, poleB) {
    const material = getMaterialConductorSafe(getValueSafe(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND'], 'N/A'));
    const section = getValueSafe(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], 'N/A');
    const conductor = `${material}${section !== 'N/A' ? ` | ${section} mm2` : ''}`;
    return compactBalloon(`Cable ${tramoCode} C${wireIndex + 1}`, [
      { label: 'Tramo', value: tramoCode },
      { label: 'Tipo red', value: getTipoRedLabel(tipoRed) },
      { label: 'Longitud', value: formatMetric(distanceMeters(a, b), 1, 'm') },
      { label: 'Fase', value: getPhaseLabel(attrs) },
      { label: 'Conductor', value: conductor },
      { label: 'Entre postes', value: `${poleA ? shortText(poleA.code, 18, 'N/A') : 'N/A'} -> ${poleB ? shortText(poleB.code, 18, 'N/A') : 'N/A'}` }
    ], wires > 1 ? `Circuito con ${wires} conductores` : '');
  }

  function buildRetenidaBalloon(attrs, code) {
    return compactBalloon(`Retenida ${code}`, [
      { label: 'Codigo', value: code },
      { label: 'Tipo', value: getValueSafe(attrs, ['RET_TIP_RET', 'RET_TIP_SUJ'], 'N/A') },
      { label: 'Poste', value: getValueSafe(attrs, ['RET_COD_NOD'], 'N/A') },
      { label: 'Angulo', value: getValueSafe(attrs, ['RET_ANG', 'RET_ANG_INC'], 'N/A') }
    ]);
  }

  function buildPatBalloon(attrs, code) {
    return compactBalloon(`PAT ${code}`, [
      { label: 'Codigo', value: code },
      { label: 'Tipo', value: getValueSafe(attrs, ['PAT_TIP_PAT'], 'N/A') },
      { label: 'Resistencia', value: `${formatMetric(getValueSafe(attrs, ['PAT_RES'], 'N/A'), 2, 'ohm')}` },
      { label: 'Poste', value: getValueSafe(attrs, ['PAT_COD_NOD'], 'N/A') }
    ]);
  }

  function safeFileName(value) {
    return String(value ?? 'SED')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  function normalizeCode(value) {
    return String(value ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '');
  }

  function toNumber(value, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function pointToLatLng(geometry) {
    const lat = Number(geometry?.y);
    const lon = Number(geometry?.x);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function pathsToLatLngs(geometry) {
    if (!geometry?.paths) return [];
    return geometry.paths
      .map((path) =>
        path
          .map((coord) => ({ lat: Number(coord[1]), lon: Number(coord[0]) }))
          .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
      )
      .filter((path) => path.length > 1);
  }

  function metersPerDegreeLat(lat) {
    const latRad = lat * DEG;
    return 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad) - 0.0023 * Math.cos(6 * latRad);
  }

  function metersPerDegreeLon(lat) {
    const latRad = lat * DEG;
    return 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad) + 0.118 * Math.cos(5 * latRad);
  }

  function distanceMeters(a, b) {
    const lat = (a.lat + b.lat) / 2;
    const dx = (b.lon - a.lon) * metersPerDegreeLon(lat);
    const dy = (b.lat - a.lat) * metersPerDegreeLat(lat);
    return Math.hypot(dx, dy);
  }

  function offsetPoint(point, eastMeters, northMeters) {
    return {
      lat: point.lat + northMeters / metersPerDegreeLat(point.lat),
      lon: point.lon + eastMeters / metersPerDegreeLon(point.lat)
    };
  }

  function offsetAlongPerpendicular(point, a, b, offsetMeters) {
    const lat = (a.lat + b.lat) / 2;
    const dx = (b.lon - a.lon) * metersPerDegreeLon(lat);
    const dy = (b.lat - a.lat) * metersPerDegreeLat(lat);
    const length = Math.hypot(dx, dy) || 1;
    return offsetPoint(point, (-dy / length) * offsetMeters, (dx / length) * offsetMeters);
  }

  function coordinate(point, altitude = 0) {
    return `${point.lon.toFixed(8)},${point.lat.toFixed(8)},${Number(altitude).toFixed(3)}`;
  }

  function coordinates(points) {
    return points.map((item) => coordinate(item.point, item.altitude)).join(' ');
  }

  async function queryLayer(layerId, where, returnGeometry = true) {
    if (typeof window.consultarArcgisReporte === 'function') {
      return window.consultarArcgisReporte(layerId, where, returnGeometry);
    }

    const features = [];
    const pageSize = 1000;
    let offset = 0;
    let keepFetching = true;
    let guard = 0;

    while (keepFetching && guard < 20) {
      const params = new URLSearchParams({
        f: 'json',
        where,
        outFields: '*',
        returnGeometry: returnGeometry ? 'true' : 'false',
        outSR: '4326',
        resultRecordCount: String(pageSize),
        resultOffset: String(offset)
      });

      const response = await fetch(`${arcgisQueryUrlSafe(layerId)}?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} consultando capa ${layerId}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || `Error consultando capa ${layerId}`);

      const batch = data.features || [];
      features.push(...batch);
      keepFetching = data.exceededTransferLimit === true && batch.length > 0;
      offset += batch.length;
      guard += 1;
    }

    return features;
  }

  async function loadKmzData(code) {
    const [
      subestaciones,
      suministros,
      circuitosBT,
      postesBT,
      retenidasBT,
      puestasTierraBT,
      tramosBT
    ] = await Promise.all([
      queryLayer(96, whereEqualsSafe('SED_COD_SED', code), true),
      queryLayer(24, whereEqualsSafe('SUM_COD_SED', code), true),
      queryLayer(25, whereEqualsSafe('SAL_COD_SED', code), true),
      queryLayer(27, whereEqualsSafe('NOD_COD_SED', code), true),
      queryLayer(28, whereEqualsSafe('RET_COD_SED', code), true),
      queryLayer(29, whereEqualsSafe('PAT_COD_SED', code), true),
      queryLayer(33, whereEqualsSafe('TBT_COD_SED', code), true)
    ]);

    return {
      subestacion: subestaciones[0] || null,
      suministros,
      circuitosBT,
      postesBT,
      retenidasBT,
      puestasTierraBT,
      tramosBT
    };
  }

  function selectedCode(code = '') {
    return String(
      code ||
      window.transformadorSeleccionado ||
      document.getElementById('inputID')?.value ||
      ''
    ).trim();
  }

  function poleHeight(attrs) {
    return Math.max(5.8, Math.min(13.5, toNumber(getValueSafe(attrs, ['NOD_ALT_SPT'], DEFAULT_POLE_HEIGHT), DEFAULT_POLE_HEIGHT)));
  }

  function buildPoleIndex(postesBT) {
    const items = [];
    const byCode = new Map();
    postesBT.forEach((feature) => {
      const point = pointToLatLng(feature.geometry);
      if (!point) return;
      const attrs = feature.attributes || {};
      const code = getValueSafe(attrs, ['NOD_COD_NOD'], 'POSTE');
      const item = { point, attrs, code };
      items.push(item);
      byCode.set(normalizeCode(code), item);
    });
    return { items, byCode };
  }

  function nearestPole(point, poles, maxDistance = 42) {
    let best = null;
    poles.forEach((pole) => {
      const distance = distanceMeters(point, pole.point);
      if (distance > maxDistance) return;
      if (!best || distance < best.distance) best = { ...pole, distance };
    });
    return best;
  }

  function headingForPoint(point, paths) {
    let best = null;
    paths.forEach((path) => {
      for (let i = 1; i < path.length; i += 1) {
        const a = path[i - 1];
        const b = path[i];
        const lat = (a.lat + b.lat) / 2;
        const ax = a.lon * metersPerDegreeLon(lat);
        const ay = a.lat * metersPerDegreeLat(lat);
        const bx = b.lon * metersPerDegreeLon(lat);
        const by = b.lat * metersPerDegreeLat(lat);
        const px = point.lon * metersPerDegreeLon(lat);
        const py = point.lat * metersPerDegreeLat(lat);
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const qx = ax + dx * t;
        const qy = ay + dy * t;
        const distance = Math.hypot(px - qx, py - qy);
        if (!best || distance < best.distance) {
          best = { distance, angle: Math.atan2(dy, dx) };
        }
      }
    });
    return best?.angle || 0;
  }

  function linePlacemark(name, styleUrl, pointList, options = {}) {
    if (!pointList || pointList.length < 2) return '';
    const altitudeMode = options.altitudeMode || 'relativeToGround';
    const description = options.description ? `\n        <description>${options.description}</description>` : '';
    return `
      <Placemark>
        <name>${xmlEscape(name)}</name>
        ${description}
        <styleUrl>${styleUrl}</styleUrl>
        <LineString>
          <tessellate>0</tessellate>
          <altitudeMode>${altitudeMode}</altitudeMode>
          <coordinates>${coordinates(pointList)}</coordinates>
        </LineString>
      </Placemark>`;
  }

  function polygonPlacemark(name, styleUrl, pointList, options = {}) {
    if (!pointList || pointList.length < 4) return '';
    const description = options.description ? `\n        <description>${options.description}</description>` : '';
    return `
      <Placemark>
        <name>${xmlEscape(name)}</name>
        ${description}
        <styleUrl>${styleUrl}</styleUrl>
        <Polygon>
          <tessellate>0</tessellate>
          <altitudeMode>relativeToGround</altitudeMode>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordinates(pointList)}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>`;
  }

  function pointPlacemark(name, styleUrl, point, altitude = 0, description = '') {
    if (!point) return '';
    const desc = description ? `\n        <description>${description}</description>` : '';
    return `
      <Placemark>
        <name>${xmlEscape(name)}</name>
        ${desc}
        <styleUrl>${styleUrl}</styleUrl>
        <Point>
          <altitudeMode>relativeToGround</altitudeMode>
          <coordinates>${coordinate(point, altitude)}</coordinates>
        </Point>
      </Placemark>`;
  }

  function conductorCount(attrs) {
    const raw = normalizeCode(getValueSafe(attrs, ['TBT_COD_TEC_FAS', 'TBT_SP_COD_FAS', 'TBT_AP_COD_FAS', 'TBT_COD_FAS'], ''));
    if (raw.includes('1') || raw.includes('MONO')) return 2;
    if (raw.includes('2') || raw.includes('BI')) return 2;
    return 3;
  }

  function catenaryPoints(a, b, startAlt, endAlt, offsetMeters, type) {
    const steps = 14;
    const span = distanceMeters(a, b);
    const sag = type === 'S' ? 0 : Math.min(1.8, Math.max(0.22, span / 58));
    const points = [];

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const base = {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t
      };
      const shifted = type === 'S' ? base : offsetAlongPerpendicular(base, a, b, offsetMeters);
      const altitude = startAlt + (endAlt - startAlt) * t - sag * 4 * t * (1 - t);
      points.push({ point: shifted, altitude });
    }

    return points;
  }

  function buildCatenaryFolder(data, poles) {
    const placemarks = [];
    data.tramosBT.forEach((feature, featureIndex) => {
      const attrs = feature.attributes || {};
      const tipoRed = normalizeCode(getValueSafe(attrs, ['TBT_COD_TIP_RED'], 'A')) || 'A';
      const paths = pathsToLatLngs(feature.geometry);
      const wires = tipoRed === 'S' ? 1 : conductorCount(attrs);
      const offsets = wires === 1 ? [0] : wires === 2 ? [-0.32, 0.32] : [-0.42, 0, 0.42];
      const styleUrl = tipoRed === 'S' ? '#msn_subterraneo' : '#msn_cfase1';
      const tramoCode = getValueSafe(attrs, ['TBT_COD_TBT', 'OBJECTID'], `TRAMO-${featureIndex + 1}`);

      paths.forEach((path, pathIndex) => {
        for (let i = 1; i < path.length; i += 1) {
          const a = path[i - 1];
          const b = path[i];
          const poleA = nearestPole(a, poles.items);
          const poleB = nearestPole(b, poles.items);
          const startAlt = tipoRed === 'S'
            ? 0.15
            : poleA ? poleHeight(poleA.attrs) * 0.78 : DEFAULT_AERIAL_HEIGHT;
          const endAlt = tipoRed === 'S'
            ? 0.15
            : poleB ? poleHeight(poleB.attrs) * 0.78 : DEFAULT_AERIAL_HEIGHT;

          offsets.forEach((offset, wireIndex) => {
            const description = buildCableBalloon(attrs, tramoCode, a, b, tipoRed, wireIndex, wires, poleA, poleB);
            placemarks.push(linePlacemark(
              `${tramoCode} C${wireIndex + 1}`,
              styleUrl,
              catenaryPoints(a, b, startAlt, endAlt, offset, tipoRed),
              { description }
            ));
          });
        }
      });
    });

    return `<Folder><name>Catenarias</name>${placemarks.join('')}</Folder>`;
  }

  function buildStructureFolder(data, poles, linePaths) {
    const placemarks = [];

    poles.items.forEach((pole) => {
      const h = poleHeight(pole.attrs);
      const code = getValueSafe(pole.attrs, ['NOD_COD_NOD'], pole.code || 'POSTE');
      const description = buildPoleBalloon(pole.attrs, code, h);
      const heading = headingForPoint(pole.point, linePaths);
      const armAngle = heading + Math.PI / 2;
      const ux = Math.cos(armAngle);
      const uy = Math.sin(armAngle);
      const faceA = offsetPoint(pole.point, ux * 0.11, uy * 0.11);
      const faceB = offsetPoint(pole.point, -ux * 0.11, -uy * 0.11);
      const armA = offsetPoint(pole.point, ux * 1.25, uy * 1.25);
      const armB = offsetPoint(pole.point, -ux * 1.25, -uy * 1.25);
      const crossAlt = Math.max(4.8, h * 0.78);

      placemarks.push(linePlacemark(`Poste ${code}`, '#msn_soporte', [
        { point: pole.point, altitude: 0 },
        { point: pole.point, altitude: h }
      ], { description }));

      placemarks.push(polygonPlacemark(`Cuerpo poste ${code}`, '#msn_soporte', [
        { point: faceA, altitude: 0 },
        { point: faceB, altitude: 0 },
        { point: faceB, altitude: h },
        { point: faceA, altitude: h },
        { point: faceA, altitude: 0 }
      ], { description }));

      placemarks.push(linePlacemark(`Cruceta ${code}`, '#msn_cruceta', [
        { point: armA, altitude: crossAlt },
        { point: armB, altitude: crossAlt }
      ], { description }));
    });

    if (data.subestacion) {
      const point = pointToLatLng(data.subestacion.geometry);
      const attrs = data.subestacion.attributes || {};
      const code = getValueSafe(attrs, ['SED_COD_SED'], '');
      const description = buildTransformerBalloon(attrs, code);
      placemarks.push(pointPlacemark(`SED ${code}`, '#msn_sed', point, 0, description));
      if (point) {
        const p1 = offsetPoint(point, -1.6, -1.0);
        const p2 = offsetPoint(point, 1.6, -1.0);
        const p3 = offsetPoint(point, 1.6, 1.0);
        const p4 = offsetPoint(point, -1.6, 1.0);
        placemarks.push(polygonPlacemark('Base subestacion', '#msn_sed_base', [
          { point: p1, altitude: 0.05 },
          { point: p2, altitude: 0.05 },
          { point: p3, altitude: 0.05 },
          { point: p4, altitude: 0.05 },
          { point: p1, altitude: 0.05 }
        ], { description }));
      }
    }

    return `<Folder><name>Estructuras</name>${placemarks.join('')}</Folder>`;
  }

  function buildSupplyFolder(data) {
    const placemarks = data.suministros
      .map((feature) => {
        const point = pointToLatLng(feature.geometry);
        const attrs = feature.attributes || {};
        const code = getValueSafe(attrs, ['SUM_COD_SUM'], 'SUM');
        const medidor = getValueSafe(attrs, ['SUM_MED_NUM', 'SUM_NUM_MED'], 'N/A');
        return pointPlacemark(`Suministro ${code}`, '#msn_suministro', point, 0, buildSupplyBalloon(attrs, code));
      })
      .join('');
    return `<Folder><name>Suministros</name>${placemarks}</Folder>`;
  }

  function buildRetenidaPatFolder(data, poles) {
    const placemarks = [];

    data.retenidasBT.forEach((feature) => {
      const point = pointToLatLng(feature.geometry);
      if (!point) return;
      const attrs = feature.attributes || {};
      const code = getValueSafe(attrs, ['RET_COD_RET'], 'RET');
      const poleCode = normalizeCode(getValueSafe(attrs, ['RET_COD_NOD'], ''));
      const pole = poles.byCode.get(poleCode) || nearestPole(point, poles.items, 55);
      const top = pole ? { point: pole.point, altitude: poleHeight(pole.attrs) * 0.74 } : { point, altitude: 5.8 };
      placemarks.push(linePlacemark(`Retenida ${code}`, '#msn_retenida', [
        { point, altitude: 0.2 },
        top
      ], { description: buildRetenidaBalloon(attrs, code) }));
    });

    data.puestasTierraBT.forEach((feature) => {
      const point = pointToLatLng(feature.geometry);
      if (!point) return;
      const attrs = feature.attributes || {};
      const code = getValueSafe(attrs, ['PAT_COD_PAT'], 'PAT');
      const a = offsetPoint(point, -0.45, 0);
      const b = offsetPoint(point, 0.45, 0);
      const c = offsetPoint(point, 0, -0.45);
      const d = offsetPoint(point, 0, 0.45);
      const description = buildPatBalloon(attrs, code);
      placemarks.push(linePlacemark(`PAT ${code}`, '#msn_pat', [
        { point: a, altitude: 0.08 },
        { point: b, altitude: 0.08 }
      ], { description }));
      placemarks.push(linePlacemark(`PAT ${code} vertical`, '#msn_pat', [
        { point: c, altitude: 0.08 },
        { point: d, altitude: 0.08 }
      ], { description }));
    });

    return `<Folder><name>Retenidas y PAT</name>${placemarks.join('')}</Folder>`;
  }

  function styleBlock() {
    return `
      <StyleMap id="msn_cfase1"><Pair><key>normal</key><styleUrl>#sn_cfase1</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#sh_cfase1</styleUrl></Pair></StyleMap>
      <StyleMap id="msn_subterraneo"><Pair><key>normal</key><styleUrl>#sn_subterraneo</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#sh_subterraneo</styleUrl></Pair></StyleMap>
      <StyleMap id="msn_cruceta"><Pair><key>normal</key><styleUrl>#sn_cruceta</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#sh_cruceta</styleUrl></Pair></StyleMap>
      <StyleMap id="msn_soporte"><Pair><key>normal</key><styleUrl>#sn_soporte</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#sh_soporte</styleUrl></Pair></StyleMap>
      <Style id="sn_cfase1"><LineStyle><color>ff0000aa</color><width>0.9</width></LineStyle></Style>
      <Style id="sh_cfase1"><LineStyle><color>ff0000aa</color><width>1.4</width></LineStyle></Style>
      <Style id="sn_subterraneo"><LineStyle><color>ffcc6600</color><width>2.2</width></LineStyle></Style>
      <Style id="sh_subterraneo"><LineStyle><color>ffcc6600</color><width>3.0</width></LineStyle></Style>
      <Style id="sn_cruceta"><LineStyle><color>aa000000</color><width>5</width></LineStyle></Style>
      <Style id="sh_cruceta"><LineStyle><color>ff000000</color><width>6</width></LineStyle></Style>
      <Style id="sn_soporte"><LineStyle><color>cc111111</color><width>4</width></LineStyle><PolyStyle><color>bf111111</color></PolyStyle></Style>
      <Style id="sh_soporte"><LineStyle><color>ff111111</color><width>5</width></LineStyle><PolyStyle><color>d8111111</color></PolyStyle></Style>
      <Style id="msn_retenida"><LineStyle><color>ff333333</color><width>2.4</width></LineStyle></Style>
      <Style id="msn_pat"><LineStyle><color>ff2a8f3d</color><width>2.5</width></LineStyle></Style>
      <Style id="msn_sed"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/electronics.png</href></Icon></IconStyle><LabelStyle><scale>0.85</scale></LabelStyle></Style>
      <Style id="msn_sed_base"><LineStyle><color>ff2f3a44</color><width>1.5</width></LineStyle><PolyStyle><color>9944aaff</color></PolyStyle></Style>
      <Style id="msn_suministro"><IconStyle><scale>0.7</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/homegardenbusiness.png</href></Icon></IconStyle><LabelStyle><scale>0.55</scale></LabelStyle></Style>`;
  }

  function createSummaryFolder(code, data) {
    const attrs = data.subestacion?.attributes || {};
    const description = [
      `SED: ${code}`,
      `Nombre: ${getValueSafe(attrs, ['SED_NOM_SED'], 'N/A')}`,
      `Potencia: ${getValueSafe(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 'N/A')} kVA`,
      `Postes: ${data.postesBT.length}`,
      `Tramos BT: ${data.tramosBT.length}`,
      `Suministros: ${data.suministros.length}`,
      `Retenidas: ${data.retenidasBT.length}`,
      `PAT: ${data.puestasTierraBT.length}`
    ].join('\n');
    return `<Folder><name>Resumen</name><Placemark><name>Resumen ${xmlEscape(code)}</name><description>${xmlEscape(description)}</description></Placemark></Folder>`;
  }

  function createKml(code, data) {
    const poles = buildPoleIndex(data.postesBT);
    const linePaths = data.tramosBT.flatMap((feature) => pathsToLatLngs(feature.geometry));
    const sedAttrs = data.subestacion?.attributes || {};
    const sedName = getValueSafe(sedAttrs, ['SED_NOM_SED'], 'Subestacion');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:kml="http://www.opengis.net/kml/2.2">
  <Document>
    <name>KMZ REDLIN SED ${xmlEscape(code)}</name>
    <description>Modelo KML/KMZ generado para Google Earth desde la red BT de la subestacion ${xmlEscape(sedName)}</description>
    ${styleBlock()}
    ${createSummaryFolder(code, data)}
    ${buildCatenaryFolder(data, poles)}
    ${buildStructureFolder(data, poles, linePaths)}
    ${buildSupplyFolder(data)}
    ${buildRetenidaPatFolder(data, poles)}
  </Document>
</kml>`;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let j = 0; j < 8; j += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crc32.table[i] = c >>> 0;
      }
    }

    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dosDate };
  }

  function u16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function kmzBlob(kmlText) {
    const encoder = new TextEncoder();
    const fileName = encoder.encode('doc.kml');
    const fileData = encoder.encode(kmlText);
    const crc = crc32(fileData);
    const stamp = dosDateTime();
    const flags = 0x0800;

    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(flags), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(fileData.length), u32(fileData.length), u16(fileName.length), u16(0), fileName
    ]);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(fileData.length), u32(fileData.length), u16(fileName.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(0), fileName
    ]);

    const centralOffset = localHeader.length + fileData.length;
    const endRecord = concatBytes([
      u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
      u32(centralHeader.length), u32(centralOffset), u16(0)
    ]);

    return new Blob([concatBytes([localHeader, fileData, centralHeader, endRecord])], {
      type: 'application/vnd.google-earth.kmz'
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function generarReporteKMZ(codigoSED = '') {
    const code = selectedCode(codigoSED);
    if (!code) {
      showNotification('Seleccione una subestacion o ingrese un codigo SED para exportar KMZ', 'error');
      return;
    }

    showLoadingMessage(`Generando KMZ Google Earth de la subestacion ${code}...`);

    try {
      const data = await loadKmzData(code);
      if (!data.subestacion) throw new Error('No se encontro la subestacion seleccionada.');

      const kml = createKml(code, data);
      const date = new Date().toISOString().split('T')[0];
      downloadBlob(kmzBlob(kml), `reporte_kmz_redlin_${safeFileName(code)}_${date}.kmz`);
      showNotification(
        `KMZ generado: ${code} | postes ${data.postesBT.length} | tramos ${data.tramosBT.length}`,
        'success',
        7000
      );
    } catch (error) {
      console.error('Error al generar KMZ:', error);
      showNotification(`Error al generar KMZ: ${error.message}`, 'error', 8000);
    } finally {
      hideLoadingMessage();
    }
  }

  window.generarReporteKMZ = generarReporteKMZ;
})();




