(function () {
  const ARCGIS_BASE_URL = 'https://gis.electropuno.com.pe/arcgis_server/rest/services/RedElectroPuno/MapServer';
  const DEG = Math.PI / 180;
  const PF = 0.9;

  function globalFn(name, fallback) {
    return typeof window[name] === 'function' ? window[name] : fallback;
  }

  function globalValue(name) {
    return window[name];
  }

  const getValueSafe = globalFn('getValue', function (attrs, fields, fallback = 'N/A') {
    for (const field of fields || []) {
      const value = attrs?.[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  });

  const showNotification = globalFn('showNotification', function (message) {
    console.log(message);
  });
  const showLoadingMessage = globalFn('showLoadingMessage', function () {});
  const hideLoadingMessage = globalFn('hideLoadingMessage', function () {});

  const whereEquals = globalFn('whereEquals', function (field, value) {
    return `${field} = '${String(value ?? '').replace(/'/g, "''")}'`;
  });

  const arcgisQueryUrl = globalFn('arcgisQueryUrl', function (layerId) {
    return `${ARCGIS_BASE_URL}/${layerId}/query`;
  });

  const getTipoRedSafe = globalFn('getTipoRed', function (codigo) {
    const tipos = { A: 'Aereo', S: 'Subterraneo', C: 'Subacuatico' };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getMaterialConductorSafe = globalFn('getMaterialConductor', function (codigo) {
    const materiales = { AL: 'Aluminio', CU: 'Cobre' };
    return materiales[codigo] || codigo || 'N/A';
  });

  const getTipoServicioSafe = globalFn('getTipoServicio', function (codigo) {
    const tipos = {
      AP: 'Alumbrado Publico',
      SP: 'Servicio Particular',
      'SP+AP': 'Servicio Particular + Alumbrado Publico'
    };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getEstadoConservacionSafe = globalFn('getEstadoConservacion', function (codigo) {
    const estados = { B: 'Bueno', M: 'Malo', 1: 'Regular 1', 2: 'Regular 2' };
    return estados[codigo] || codigo || 'N/A';
  });

  const getTipoProteccionSafe = globalFn('getTipoProteccion', function (codigo) {
    const tipos = {
      FU: 'Fusible',
      TM: 'Interruptor Termomagnetico',
      CM: 'Interruptor Automatico Caja Moldeada'
    };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getTipoSoporteSafe = globalFn('getTipoSoporte', function (codigo) {
    const tipos = { BIP: 'Biposte', EST: 'Estructura', MON: 'Monoposte', NIN: 'Ninguno' };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getFuncionEstructuraSafe = globalFn('getFuncionEstructura', function (codigo) {
    const funciones = {
      ALI: 'Alineamiento',
      CAD: 'Cambio de Direccion',
      FDL: 'Fin e Inicio de Linea'
    };
    return funciones[codigo] || codigo || 'N/A';
  });

  const evaluateAptitudePosteBTSafe = globalFn('evaluateAptitudePosteBT', function (attrs = {}) {
    const raw = getValueSafe(attrs, ['NOD_EST_PST', 'NOD_ESTADO', 'NOD_EST'], 'N/A');
    const estado = textSafe(raw) || 'N/A';
    return {
      estado,
      apto: /APTO|BUENO|OK/i.test(estado) ? 'Si' : /NO APTO|MALO|DEFECT/i.test(estado) ? 'No' : 'N/A'
    };
  });

  function num(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === undefined || value === null || value === '' || value === 'N/A') return 0;
    let text = String(value).trim();
    if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
    text = text.replace(/,/g, '').replace(/[^\d.-]/g, '');
    const parsed = parseFloat(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function fmt(value, decimals = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toFixed(decimals).replace(/\.?0+$/, '');
  }

  function textSafe(value) {
    return String(value ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      .trim();
  }

  function textLines(value, max = 55) {
    const words = textSafe(value).split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (trial.length > max && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function escapeDxfText(value) {
    return textSafe(value)
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\^/g, ' ');
  }

  function normalize(value) {
    return String(value ?? '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function getSelectedCodigo(codigoSED) {
    const input = document.getElementById('inputID');
    const direct = String(codigoSED || '').trim();
    if (direct) return direct;
    if (input && input.value.trim()) return input.value.trim();
    if (typeof globalValue('transformadorSeleccionado') === 'string' && globalValue('transformadorSeleccionado').trim()) {
      return globalValue('transformadorSeleccionado').trim();
    }
    return '';
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
    const N = a / Math.sqrt(1 - eccSquared * Math.sin(latRad) * Math.sin(latRad));
    const T = Math.tan(latRad) * Math.tan(latRad);
    const C = eccPrimeSquared * Math.cos(latRad) * Math.cos(latRad);
    const A = Math.cos(latRad) * (lonRad - lonOrigin);
    const M =
      a *
      ((1 -
        eccSquared / 4 -
        (3 * eccSquared * eccSquared) / 64 -
        (5 * eccSquared * eccSquared * eccSquared) / 256) * latRad -
        ((3 * eccSquared) / 8 +
          (3 * eccSquared * eccSquared) / 32 +
          (45 * eccSquared * eccSquared * eccSquared) / 1024) * Math.sin(2 * latRad) +
        ((15 * eccSquared * eccSquared) / 256 +
          (45 * eccSquared * eccSquared * eccSquared) / 1024) * Math.sin(4 * latRad) -
        ((35 * eccSquared * eccSquared * eccSquared) / 3072) * Math.sin(6 * latRad));

    let easting =
      k0 *
        N *
        (A +
          ((1 - T + C) * Math.pow(A, 3)) / 6 +
          ((5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * Math.pow(A, 5)) / 120) +
      500000.0;

    let northing =
      k0 *
      (M +
        N *
          Math.tan(latRad) *
          ((A * A) / 2 +
            ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
            ((61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared) * Math.pow(A, 6)) / 720));

    if (lat < 0) northing += 10000000.0;
    return { x: easting, y: northing, zone, hemisphere: lat < 0 ? 'S' : 'N' };
  }

  function pointGeometryToUtm(geometry, zoneOverride) {
    const lat = Number(geometry?.y);
    const lon = Number(geometry?.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return wgs84ToUtm(lat, lon, zoneOverride);
  }

  function pathsToLatLngsSafe(geometry) {
    if (!geometry?.paths) return [];
    return geometry.paths
      .map((path) =>
        path
          .map((coord) => [Number(coord[1]), Number(coord[0])])
          .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
      )
      .filter((path) => path.length > 0);
  }

  function queryArcgis(layerId, where, returnGeometry = true) {
    return new Promise(async (resolve, reject) => {
      try {
        const features = [];
        let offset = 0;
        let guard = 0;
        let more = true;

        while (more && guard < 20) {
          const params = new URLSearchParams({
            f: 'json',
            where,
            outFields: '*',
            returnGeometry: returnGeometry ? 'true' : 'false',
            outSR: 4326,
            resultRecordCount: '1000',
            resultOffset: String(offset)
          });

          const response = await fetch(`${arcgisQueryUrl(layerId)}?${params}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} consultando capa ${layerId}`);
          }

          const data = await response.json();
          if (data.error) {
            throw new Error(data.error.message || `Error consultando capa ${layerId}`);
          }

          const batch = data.features || [];
          features.push(...batch);
          more = data.exceededTransferLimit === true && batch.length > 0;
          offset += batch.length;
          guard += 1;
        }

        resolve(features);
      } catch (error) {
        reject(error);
      }
    });
  }

  function distMeters(a, b) {
    const r = 6371000;
    const lat1 = a[0] * DEG;
    const lat2 = b[0] * DEG;
    const dLat = (b[0] - a[0]) * DEG;
    const dLon = (b[1] - a[1]) * DEG;
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function polylineLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
  }

  function midpoint(points) {
    if (!points.length) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    if (total === 0) return { x: points[0].x, y: points[0].y };
    const half = total / 2;
    let acc = 0;
    for (let i = 1; i < points.length; i += 1) {
      const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (acc + seg >= half) {
        const t = (half - acc) / seg;
        return {
          x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
          y: points[i - 1].y + (points[i].y - points[i - 1].y) * t
        };
      }
      acc += seg;
    }
    return { x: points[points.length - 1].x, y: points[points.length - 1].y };
  }

  function pathAngleDegrees(points) {
    if (!points || points.length < 2) return 0;
    let bestLength = -1;
    let bestAngle = 0;
    for (let i = 1; i < points.length; i += 1) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      const length = Math.hypot(dx, dy);
      if (length > bestLength) {
        bestLength = length;
        bestAngle = Math.atan2(dy, dx) * 180 / Math.PI;
      }
    }
    return bestAngle;
  }

  function readableTextAngle(angle) {
    let value = angle;
    if (value > 90 && value < 270) value += 180;
    value %= 360;
    if (value < 0) value += 360;
    return value;
  }

  function offsetPoint(p, dx, dy) {
    return { x: p.x + dx, y: p.y + dy };
  }

  function resistanceOhmPerM(materialCode, sectionMm2) {
    const section = Math.max(num(sectionMm2), 1);
    const material = normalize(materialCode);
    const rho =
      material === 'CU' ? 0.017241 : material === 'AL' ? 0.028264 : 0.03;
    return rho / section;
  }

  function faseFromAttrs(attrs) {
    const raw = normalize(
      getValueSafe(attrs, ['TBT_COD_TEC_FAS', 'TBT_SP_COD_FAS', 'TBT_AP_COD_FAS', 'TBT_COD_FAS'], '')
    );
    if (/TRI|3F|ABC|RST|R S T|3/.test(raw)) return 'Trifasico';
    if (/BI|2F|AB|AC|BC|RS|RT|ST|R-S|R-T|S-T|2/.test(raw)) return 'Bifasico';
    if (/MONO|1F|^[ABC]$|^[RST]$|1/.test(raw)) return 'Monofasico';
    const conductores = num(getValueSafe(attrs, ['TBT_SP_NRO_CND', 'TBT_AP_NRO_CND', 'TBT_NRO_CND'], 0));
    if (conductores >= 4) return 'Trifasico';
    if (conductores >= 2) return 'Bifasico';
    if (conductores > 0) return 'Monofasico';
    return 'No especificado';
  }

  function phaseFactor(phase) {
    return phase === 'Trifasico' ? Math.sqrt(3) : 1;
  }

  function loopFactor(phase) {
    return phase === 'Trifasico' ? Math.sqrt(3) : 2;
  }

  function formatDate(value) {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('es-PE');
  }

  function extractYear(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear();
  }

  function toPowerKw(value) {
    const n = num(value);
    return n > 0 ? n : 0;
  }

  function enabledValue(attrs) {
    const value = attrs?.Enabled;
    if (value === undefined || value === null || value === '') return 'N/A';
    return value === 1 || value === '1' || value === true ? 'Si' : 'No';
  }

  function countPoleUnits(attrs) {
    const count = num(getValueSafe(attrs, ['NOD_CNT_SPT'], 0));
    return count > 0 ? count : 1;
  }

  function armadosText(attrs) {
    const items = [];
    for (let i = 1; i <= 4; i += 1) {
      const suf = String(i).padStart(2, '0');
      const cod = getValueSafe(attrs, [`NOD_COD_TIP_ARM_${suf}`], '');
      if (!cod || cod === 'N/A') continue;
      const cnt = getValueSafe(attrs, [`NOD_CNT_TIP_ARM_${suf}`], 1);
      const dsc = getValueSafe(attrs, [`NOD_DSC_TIP_ARM_${suf}`], '');
      items.push(`${cod}(${cnt})${dsc && dsc !== 'N/A' ? ` ${dsc}` : ''}`);
    }
    return items.length ? items.join('; ') : 'N/A';
  }

  function buildGeometryBounds(projectedPoints, bounds) {
    for (const p of projectedPoints) {
      bounds.minX = Math.min(bounds.minX, p.x);
      bounds.minY = Math.min(bounds.minY, p.y);
      bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.maxY = Math.max(bounds.maxY, p.y);
    }
  }

  function subtractPoint(point, origin) {
    return {
      x: point.x - origin.x,
      y: point.y - origin.y
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rectIntersects(a, b, pad = 0) {
    return !(
      a.x2 + pad < b.x1 ||
      a.x1 - pad > b.x2 ||
      a.y2 + pad < b.y1 ||
      a.y1 - pad > b.y2
    );
  }

  function centerRect(rect) {
    return {
      x: (rect.x1 + rect.x2) / 2,
      y: (rect.y1 + rect.y2) / 2
    };
  }

  function buildBox(anchor, width, height, sx, sy, gap) {
    const x1 = sx > 0 ? anchor.x + gap : anchor.x - gap - width;
    const y1 = sy > 0 ? anchor.y + gap : anchor.y - gap - height;
    return {
      x1,
      y1,
      x2: x1 + width,
      y2: y1 + height
    };
  }

  function getBoxLeaderPoint(anchor, box) {
    const x = clamp(anchor.x, box.x1, box.x2);
    const y = clamp(anchor.y, box.y1, box.y2);
    const midX = (box.x1 + box.x2) / 2;
    const midY = (box.y1 + box.y2) / 2;
    if (x === anchor.x && y === anchor.y) {
      const candidates = [
        { x: midX, y: box.y2 },
        { x: midX, y: box.y1 },
        { x: box.x1, y: midY },
        { x: box.x2, y: midY }
      ];
      return candidates.sort((a, b) =>
        Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y)
      )[0];
    }
    if (x === box.x1 || x === box.x2 || y === box.y1 || y === box.y2) {
      return { x, y };
    }
    const distances = [
      { x: x, y: box.y1, d: Math.abs(anchor.y - box.y1) },
      { x: x, y: box.y2, d: Math.abs(anchor.y - box.y2) },
      { x: box.x1, y: y, d: Math.abs(anchor.x - box.x1) },
      { x: box.x2, y: y, d: Math.abs(anchor.x - box.x2) }
    ];
    distances.sort((a, b) => a.d - b.d);
    return { x: distances[0].x, y: distances[0].y };
  }

  function pickBoxPlacement(anchor, width, height, state, options = {}) {
    const gap = options.gap ?? 8;
    const rings = options.rings ?? [8, 14, 20, 28, 36];
    const preference = options.preference ?? ['ur', 'dr', 'ul', 'dl', 'e', 'w', 'n', 's'];
    const center = state.center ?? anchor;
    const horizontal = anchor.x >= center.x ? 1 : -1;
    const vertical = anchor.y >= center.y ? 1 : -1;
    const sequence = [];

    for (const ring of rings) {
      const localized = [];
      preference.forEach(key => {
        let sx = 0;
        let sy = 0;
        switch (key) {
          case 'ur':
            sx = 1; sy = 1; break;
          case 'dr':
            sx = 1; sy = -1; break;
          case 'ul':
            sx = -1; sy = 1; break;
          case 'dl':
            sx = -1; sy = -1; break;
          case 'e':
            sx = 1; sy = vertical; break;
          case 'w':
            sx = -1; sy = vertical; break;
          case 'n':
            sx = horizontal; sy = 1; break;
          case 's':
            sx = horizontal; sy = -1; break;
          default:
            sx = horizontal;
            sy = vertical;
        }
        localized.push(buildBox(anchor, width, height, sx, sy, ring));
      });
      sequence.push(...localized);
    }

    let best = sequence[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of sequence) {
      const score = state.boxes.reduce((sum, existing) => sum + (rectIntersects(candidate, existing, 2) ? 1 : 0), 0);
      if (score === 0) {
        return candidate;
      }
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  function addFieldBox(writer, state, anchor, rows, options = {}) {
    const layer = options.layer || 'BT_PANEL';
    const borderColor = options.borderColor ?? 7;
    const textLayer = options.textLayer || 'BT_TEXTOS';
    const labelColor = options.labelColor ?? 7;
    const valueColor = options.valueColor ?? 7;
    const leftWidth = options.leftWidth ?? 14;
    const rowHeight = options.rowHeight ?? 4.2;
    const pad = options.pad ?? 1.4;
    const width = options.width ?? 36;
    const height = options.height ?? (rows.length * rowHeight + pad * 2);
    const box = pickBoxPlacement(anchor, width, height, state, options);
    state.boxes.push(box);

    writer.addRectangle(layer, box.x1, box.y1, box.x2, box.y2, borderColor);

    for (let i = 1; i < rows.length; i += 1) {
      const y = box.y2 - pad - i * rowHeight + rowHeight / 2;
      writer.addLine(layer, box.x1, y, box.x2, y, borderColor);
    }
    writer.addLine(layer, box.x1 + leftWidth, box.y1, box.x1 + leftWidth, box.y2, borderColor);

    rows.forEach((row, index) => {
      const cy = box.y2 - pad - index * rowHeight - rowHeight / 2 + 0.25;
      const label = textSafe(row.label || '');
      const value = textSafe(row.value || '');
      writer.addText(textLayer, box.x1 + 1.3, cy, label, options.textHeightLabel ?? 1.4, 0, row.labelColor ?? labelColor);
      writer.addText(textLayer, box.x1 + leftWidth + 1.2, cy, value, options.textHeightValue ?? 1.5, 0, row.valueColor ?? valueColor);
    });

    const leader = getBoxLeaderPoint(anchor, box);
    writer.addLine(options.leaderLayer || layer, anchor.x, anchor.y, leader.x, leader.y, options.leaderColor ?? borderColor);
    return box;
  }

  function addLabelBox(writer, state, anchor, lines, options = {}) {
    const width = options.width ?? Math.max(34, Math.min(64, 10 + Math.max(...lines.map(l => textSafe(l).length)) * 1.8));
    const rowHeight = options.rowHeight ?? 2.8;
    const pad = options.pad ?? 1.2;
    const height = options.height ?? (lines.length * rowHeight + pad * 2);
    const box = pickBoxPlacement(anchor, width, height, state, options);
    state.boxes.push(box);

    writer.addRectangle(options.layer || 'BT_PANEL', box.x1, box.y1, box.x2, box.y2, options.borderColor ?? 7);
    lines.forEach((line, index) => {
      const cy = box.y2 - pad - index * rowHeight - rowHeight / 2 + 0.2;
      writer.addText(options.textLayer || 'BT_TEXTOS', box.x1 + 1.2, cy, line, options.textHeight ?? 1.4, 0, options.textColor ?? 7);
    });

    const leader = getBoxLeaderPoint(anchor, box);
    writer.addLine(options.leaderLayer || (options.layer || 'BT_PANEL'), anchor.x, anchor.y, leader.x, leader.y, options.leaderColor ?? options.borderColor ?? 7);
    return box;
  }

  function addNorthArrow(writer, x, y, size = 10, layer = 'BT_PANEL', color = 7) {
    writer.addLine(layer, x, y, x, y + size, color);
    writer.addLine(layer, x, y + size, x - size * 0.2, y + size * 0.72, color);
    writer.addLine(layer, x, y + size, x + size * 0.2, y + size * 0.72, color);
    writer.addText(layer, x - size * 0.18, y + size + 2, 'N', 2.5, 0, color);
  }

  function addScaleBar(writer, x, y, length = 50, segments = 5, layer = 'BT_PANEL', color = 7) {
    const seg = length / segments;
    for (let i = 0; i < segments; i += 1) {
      const x1 = x + i * seg;
      const x2 = x + (i + 1) * seg;
      writer.addLine(layer, x1, y, x2, y, color);
      writer.addLine(layer, x1, y, x1, y + (i % 2 === 0 ? 2 : 1.2), color);
    }
    writer.addLine(layer, x + length, y, x + length, y + 2, color);
    writer.addText(layer, x, y - 3, '0', 1.4, 0, color);
    writer.addText(layer, x + seg, y - 3, `${seg}`, 1.4, 0, color);
    writer.addText(layer, x + length, y - 3, `${length} m`, 1.4, 0, color);
  }

  function drawGrid(writer, bounds, step = 50, layer = 'BT_PANEL', color = 8) {
    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
      return;
    }
    const minX = Math.floor(bounds.minX / step) * step;
    const maxX = Math.ceil(bounds.maxX / step) * step;
    const minY = Math.floor(bounds.minY / step) * step;
    const maxY = Math.ceil(bounds.maxY / step) * step;
    for (let x = minX; x <= maxX; x += step) {
      writer.addLine(layer, x, minY, x, maxY, color);
    }
    for (let y = minY; y <= maxY; y += step) {
      writer.addLine(layer, minX, y, maxX, y, color);
    }
  }

  function createBounds() {
    return {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    };
  }

  class DxfWriter {
    constructor() {
      this.layers = new Map();
      this.entities = [];
      this.bounds = createBounds();
    }

    ensureLayer(name, color = 7) {
      if (!this.layers.has(name)) {
        this.layers.set(name, { name, color });
      }
    }

    updateBoundsPoint(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this.bounds.minX = Math.min(this.bounds.minX, x);
      this.bounds.minY = Math.min(this.bounds.minY, y);
      this.bounds.maxX = Math.max(this.bounds.maxX, x);
      this.bounds.maxY = Math.max(this.bounds.maxY, y);
    }

    addLine(layer, x1, y1, x2, y2, color = null) {
      this.ensureLayer(layer);
      this.updateBoundsPoint(x1, y1);
      this.updateBoundsPoint(x2, y2);
      const entity = [
        '0',
        'LINE',
        '8',
        layer,
        '10',
        fmt(x1),
        '20',
        fmt(y1),
        '30',
        '0',
        '11',
        fmt(x2),
        '21',
        fmt(y2),
        '31',
        '0'
      ];
      if (color !== null && color !== undefined) {
        entity.splice(4, 0, '62', String(color));
      }
      this.entities.push(entity.join('\n'));
    }

    addRectangle(layer, x1, y1, x2, y2, color = null) {
      this.addLine(layer, x1, y1, x2, y1, color);
      this.addLine(layer, x2, y1, x2, y2, color);
      this.addLine(layer, x2, y2, x1, y2, color);
      this.addLine(layer, x1, y2, x1, y1, color);
    }

    addCircle(layer, x, y, radius, color = null) {
      this.ensureLayer(layer);
      this.updateBoundsPoint(x - radius, y - radius);
      this.updateBoundsPoint(x + radius, y + radius);
      const entity = [
        '0',
        'CIRCLE',
        '8',
        layer,
        '10',
        fmt(x),
        '20',
        fmt(y),
        '30',
        '0',
        '40',
        fmt(radius)
      ];
      if (color !== null && color !== undefined) {
        entity.splice(4, 0, '62', String(color));
      }
      this.entities.push(entity.join('\n'));
    }

    addPolyline(layer, points, closed = false, color = null) {
      if (!points || points.length < 2) return;
      this.ensureLayer(layer);
      buildGeometryBounds(points, this.bounds);
      const lines = [
        '0',
        'POLYLINE',
        '8',
        layer,
        '66',
        '1',
        '70',
        closed ? '1' : '0',
        '10',
        '0',
        '20',
        '0',
        '30',
        '0'
      ];
      if (color !== null && color !== undefined) {
        lines.splice(4, 0, '62', String(color));
      }
      for (const p of points) {
        lines.push(
          '0',
          'VERTEX',
          '8',
          layer,
          '10',
          fmt(p.x),
          '20',
          fmt(p.y),
          '30',
          '0'
        );
      }
      lines.push('0', 'SEQEND', '8', layer);
      this.entities.push(lines.join('\n'));
    }

    addPathSegments(layer, points, color = null) {
      if (!points || points.length < 2) return;
      this.ensureLayer(layer);
      buildGeometryBounds(points, this.bounds);
      for (let i = 1; i < points.length; i += 1) {
        this.addLine(layer, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, color);
      }
    }

    addText(layer, x, y, value, height = 2.5, rotation = 0, color = null) {
      this.ensureLayer(layer);
      this.updateBoundsPoint(x, y);
      const text = escapeDxfText(value);
      const entity = [
        '0',
        'TEXT',
        '8',
        layer,
        '10',
        fmt(x),
        '20',
        fmt(y),
        '30',
        '0',
        '40',
        fmt(height),
        '1',
        text,
        '50',
        fmt(rotation)
      ];
      if (color !== null && color !== undefined) {
        entity.splice(4, 0, '62', String(color));
      }
      this.entities.push(entity.join('\n'));
    }

    addMultilineText(layer, x, y, values, height = 2.2, spacing = 3.1, color = null) {
      values.forEach((line, index) => {
        this.addText(layer, x, y - index * spacing, line, height, 0, color);
      });
    }

    addLegendItem(layerLine, x, y, label, colorLayer, labelColor = null) {
      this.addLine(colorLayer, x, y, x + 4, y, colorLayer);
      this.addCircle(colorLayer, x + 2, y, 0.45, colorLayer);
      this.addText(layerLine, x + 6, y - 0.8, label, 1.8, 0, labelColor ?? colorLayer);
    }

    toString() {
      const minX = Number.isFinite(this.bounds.minX) ? this.bounds.minX : 0;
      const minY = Number.isFinite(this.bounds.minY) ? this.bounds.minY : 0;
      const maxX = Number.isFinite(this.bounds.maxX) ? this.bounds.maxX : 100;
      const maxY = Number.isFinite(this.bounds.maxY) ? this.bounds.maxY : 100;
      const layerTable = Array.from(this.layers.values())
        .map((layer) =>
          [
            '0',
            'LAYER',
            '2',
            layer.name,
            '70',
            '0',
            '62',
            String(layer.color),
            '6',
            'CONTINUOUS'
          ].join('\n')
        )
        .join('\n');
      const styleTable = [
        '0',
        'STYLE',
        '2',
        'STANDARD',
        '70',
        '0',
        '40',
        '0',
        '41',
        '1',
        '50',
        '0',
        '71',
        '0',
        '42',
        '0',
        '3',
        'txt',
        '4',
        ''
      ].join('\n');
      const blockRecordTable = [
        '0',
        'BLOCK_RECORD',
        '2',
        '*Model_Space',
        '70',
        '0',
        '0',
        'BLOCK_RECORD',
        '2',
        '*Paper_Space',
        '70',
        '0'
      ].join('\n');
      const blocksSection = [
        '0',
        'BLOCK',
        '8',
        '0',
        '2',
        '*Model_Space',
        '70',
        '0',
        '10',
        '0',
        '20',
        '0',
        '30',
        '0',
        '3',
        '*Model_Space',
        '1',
        '',
        '0',
        'ENDBLK',
        '0',
        'BLOCK',
        '8',
        '0',
        '2',
        '*Paper_Space',
        '70',
        '0',
        '10',
        '0',
        '20',
        '0',
        '30',
        '0',
        '3',
        '*Paper_Space',
        '1',
        '',
        '0',
        'ENDBLK'
      ].join('\n');

      return [
        '0',
        'SECTION',
        '2',
        'HEADER',
        '9',
        '$ACADVER',
        '1',
        'AC1009',
        '9',
        '$INSUNITS',
        '70',
        '6',
        '9',
        '$MEASUREMENT',
        '70',
        '1',
        '9',
        '$EXTMIN',
        '10',
        fmt(minX, 3),
        '20',
        fmt(minY, 3),
        '30',
        '0',
        '9',
        '$EXTMAX',
        '10',
        fmt(maxX, 3),
        '20',
        fmt(maxY, 3),
        '30',
        '0',
        '0',
        'ENDSEC',
        '0',
        'SECTION',
        '2',
        'TABLES',
        '0',
        'TABLE',
        '2',
        'STYLE',
        '70',
        '1',
        styleTable,
        '0',
        'ENDTAB',
        '0',
        'TABLE',
        '2',
        'BLOCK_RECORD',
        '70',
        '2',
        blockRecordTable,
        '0',
        'ENDTAB',
        '0',
        'TABLE',
        '2',
        'LTYPE',
        '70',
        '1',
        '0',
        'LTYPE',
        '2',
        'CONTINUOUS',
        '70',
        '0',
        '3',
        'Solid line',
        '72',
        '65',
        '73',
        '0',
        '40',
        '0.0',
        '0',
        'ENDTAB',
        '0',
        'TABLE',
        '2',
        'LAYER',
        '70',
        String(this.layers.size),
        layerTable,
        '0',
        'ENDTAB',
        '0',
        'ENDSEC',
        '0',
        'SECTION',
        '2',
        'BLOCKS',
        blocksSection,
        '0',
        'ENDSEC',
        '0',
        'SECTION',
        '2',
        'ENTITIES',
        this.entities.join('\n'),
        '0',
        'ENDSEC',
        '0',
        'EOF'
      ].join('\n');
    }
  }

  function getValueByField(attrs, fields, fallback = 'N/A') {
    return getValueSafe(attrs, fields, fallback);
  }

  function classifyLineType(attrs) {
    const code = normalize(getValueByField(attrs, ['TBT_COD_TIP_RED'], ''));
    if (code === 'S') return 'SUBTERRANEA';
    if (code === 'C') return 'SUBACUATICA';
    return 'AEREA';
  }

  function lineLayerName(type) {
    if (type === 'SUBTERRANEA') return 'BT_LINEAS_SUBT';
    if (type === 'SUBACUATICA') return 'BT_LINEAS_SUBAC';
    return 'BT_LINEAS_AEREAS';
  }

  function lineLayerColor(type) {
    if (type === 'SUBTERRANEA') return 3;
    if (type === 'SUBACUATICA') return 4;
    return 5;
  }

  function buildSupplySummary(features) {
    return features.reduce(
      (acc, feature) => {
        const attrs = feature.attributes || {};
        const dem = toPowerKw(getValueByField(attrs, ['SUM_MAX_DEM'], 0));
        const eq = toPowerKw(getValueByField(attrs, ['SUM_POT_EQT'], 0));
        acc.demandaKw += dem;
        acc.potenciaKw += eq;
        return acc;
      },
      { demandaKw: 0, potenciaKw: 0 }
    );
  }

  function estimateVoltage(features) {
    for (const feature of features) {
      const attrs = feature.attributes || {};
      const raw = getValueByField(attrs, ['SAL_TEN_NOM'], '');
      const n = num(raw);
      if (n > 0) return n;
    }
    return 220;
  }

  function estimatePhase(features) {
    const weights = { Monofasico: 0, Bifasico: 0, Trifasico: 0, 'No especificado': 0 };
    for (const feature of features) {
      const attrs = feature.attributes || {};
      const phase = faseFromAttrs(attrs);
      const paths = pathsToLatLngsSafe(feature.geometry);
      let length = 0;
      for (const path of paths) {
        for (let i = 1; i < path.length; i += 1) {
          length += distMeters(path[i - 1], path[i]);
        }
      }
      weights[phase] = (weights[phase] || 0) + length;
    }
    return Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'No especificado';
  }

  function estimateCableResistance(features) {
    let totalLength = 0;
    let totalResistance = 0;
    const byPhase = { Monofasico: 0, Bifasico: 0, Trifasico: 0, 'No especificado': 0 };

    for (const feature of features) {
      const attrs = feature.attributes || {};
      const phase = faseFromAttrs(attrs);
      const material = getValueByField(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND', 'TBT_COD_MAT_COND'], '');
      const section = getValueByField(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], 0);
      const paths = pathsToLatLngsSafe(feature.geometry);
      let length = 0;
      for (const path of paths) {
        for (let i = 1; i < path.length; i += 1) {
          length += distMeters(path[i - 1], path[i]);
        }
      }
      const r = resistanceOhmPerM(material, section);
      totalLength += length;
      totalResistance += r * length;
      byPhase[phase] = (byPhase[phase] || 0) + length;
    }

    return {
      totalLength,
      meanResistance: totalLength > 0 ? totalResistance / totalLength : 0,
      byPhase
    };
  }

  function estimateCurrent(totalKw, voltage, phase, fallbackAmp = 0) {
    if (totalKw > 0 && voltage > 0) {
      return (totalKw * 1000) / (voltage * phaseFactor(phase) * PF);
    }
    return fallbackAmp > 0 ? fallbackAmp : 0;
  }

  function estimateVoltageDrop(totalKw, voltage, phase, meanResistanceOhmPerM, lengthM, fallbackAmp = 0) {
    const current = estimateCurrent(totalKw, voltage, phase, fallbackAmp);
    const dropV = current * meanResistanceOhmPerM * lengthM * loopFactor(phase);
    const dropPct = voltage > 0 ? (dropV / voltage) * 100 : 0;
    let status = 'Apto referencial';
    if (dropPct > 7) status = 'No apto referencial';
    else if (dropPct > 5) status = 'Por verificar';
    return { current, dropV, dropPct, status };
  }

  function assessAptitudeGeneral(stats) {
    if (stats.dropPct > 7) return 'No apto referencial';
    if (stats.dropPct > 5) return 'Por verificar';
    return 'Apto referencial';
  }

  function lineGroupLabel(attrs, lengthM) {
    const phase = faseFromAttrs(attrs);
    const material = getMaterialConductorSafe(
      getValueByField(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND', 'TBT_COD_MAT_COND'], '')
    );
    const section = getValueByField(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], 'N/A');
    const code = getValueByField(attrs, ['TBT_COD_TBT'], 'N/A');
    return `${code} | ${phase} | ${material} ${section} | L=${fmt(lengthM, 1)} m`;
  }

  function poleGroupLabel(attrs) {
    const code = getValueByField(attrs, ['NOD_COD_NOD'], 'N/A');
    const mat = getMaterialConductorSafe(getValueByField(attrs, ['NOD_COD_MAT_SPT'], ''));
    const h = getValueByField(attrs, ['NOD_ALT_SPT'], 'N/A');
    return `${code} | ${mat} | H=${h}m`;
  }

  function supplyGroupLabel(attrs) {
    const code = getValueByField(attrs, ['SUM_COD_SUM'], 'N/A');
    const name = getValueByField(attrs, ['SUM_NOM_SUM'], 'N/A');
    const dem = getValueByField(attrs, ['SUM_MAX_DEM'], 'N/A');
    const phase = getValueByField(attrs, ['SUM_MED_FAS'], 'N/A');
    return `${code} | ${name} | Dem=${dem} kW | Fas=${phase}`;
  }

  function circuitGroupLabel(attrs) {
    const code = getValueByField(attrs, ['SAL_COD_SAL'], 'N/A');
    const name = getValueByField(attrs, ['SAL_NOM_SAL'], 'N/A');
    const typ = getTipoProteccionSafe(getValueByField(attrs, ['SAL_EQP_TIP'], ''));
    return `${code} | ${name} | ${typ}`;
  }

  function transformerLabel(attrs) {
    const code = getValueByField(attrs, ['SED_COD_SED'], 'N/A');
    const name = getValueByField(attrs, ['SED_NOM_SED'], 'N/A');
    const pot = getValueByField(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 'N/A');
    return `${code} | ${name} | ${pot} kVA`;
  }

  function formatStatusText(stats) {
    return `${stats.status} | Caida=${fmt(stats.dropPct, 2)}% | ${fmt(stats.dropV, 1)} V`;
  }

  function chooseZoneFromData(data) {
    const source = data.subestacion[0] || data.suministros[0] || data.circuitosBT[0] || data.postesBT[0] || data.tramosBT[0];
    if (!source?.geometry) return 19;
    const point = pointGeometryToUtm(source.geometry);
    if (point) return point.zone || 19;
    const paths = pathsToLatLngsSafe(source.geometry);
    if (paths.length && paths[0].length) {
      return getUtmZone(paths[0][0][1]);
    }
    return 19;
  }

  function projectPointsFromPath(path, zone) {
    return path
      .map((coord) => {
        const lat = Number(coord[0]);
        const lon = Number(coord[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return wgs84ToUtm(lat, lon, zone);
      })
      .filter(Boolean);
  }

  function flattenMultiLinePaths(feature, zone) {
    const paths = pathsToLatLngsSafe(feature.geometry);
    return paths.map((path) => projectPointsFromPath(path, zone)).filter((path) => path.length > 1);
  }

  function createReportModel(code, data) {
    const zone = chooseZoneFromData(data);
    const hemisphere = 'S';
    const writer = new DxfWriter();

    writer.ensureLayer('BT_TRAFO', 1);
    writer.ensureLayer('BT_CIRCUITOS', 6);
    writer.ensureLayer('BT_POSTES', 3);
    writer.ensureLayer('BT_SUMINISTROS', 4);
    writer.ensureLayer('BT_TEXTOS', 7);
    writer.ensureLayer('BT_PANEL', 8);
    writer.ensureLayer('BT_CAIDA_TENSION', 30);
    writer.ensureLayer('BT_FERRETERIA', 2);
    writer.ensureLayer('BT_LINEAS_AEREAS', 5);
    writer.ensureLayer('BT_LINEAS_SUBT', 3);
    writer.ensureLayer('BT_LINEAS_SUBAC', 4);

    const sed = data.subestacion[0]?.attributes || {};
    const center = pointGeometryToUtm(data.subestacion[0]?.geometry, zone);
    if (!center) {
      throw new Error('No se encontro geometria de la subestacion seleccionada.');
    }
    const origin = center;
    const localize = (point) => subtractPoint(point, origin);

    const summary = {
      code,
      name: getValueByField(sed, ['SED_NOM_SED'], 'N/A'),
      powerKvA: num(getValueByField(sed, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 0)),
      primaryVoltage: getValueByField(sed, ['SED_TEN_NOM_PRI', 'SED_TEN_PRI'], 'N/A'),
      ubigeo: getValueByField(sed, ['SED_COD_UBI'], 'N/A'),
      zone,
      hemisphere,
      totalSupplyCount: data.suministros.length,
      totalCircuitCount: data.circuitosBT.length,
      totalPoleCount: data.postesBT.length,
      totalLineCount: data.tramosBT.length,
      totalPoleUnits: data.postesBT.reduce((acc, feature) => acc + countPoleUnits(feature.attributes || {}), 0)
    };

    const cableSummary = estimateCableResistance(data.tramosBT);
    const totalSupply = buildSupplySummary(data.suministros);
    const voltage = estimateVoltage(data.circuitosBT);
    const phase = estimatePhase(data.tramosBT);
    const fallbackAmp = Math.max(
      0,
      ...data.circuitosBT.map((feature) => num(getValueByField(feature.attributes || {}, ['SAL_CAP_AMP', 'SAL_COR_NOM'], 0)))
    );
    const drop = estimateVoltageDrop(
      totalSupply.demandaKw || totalSupply.potenciaKw,
      voltage,
      phase,
      cableSummary.meanResistance,
      cableSummary.totalLength,
      fallbackAmp
    );

    summary.cableMeters = cableSummary.totalLength;
    summary.cableKm = cableSummary.totalLength / 1000;
    summary.phase = phase;
    summary.voltage = voltage;
    summary.totalDemandKw = totalSupply.demandaKw;
    summary.totalPowerKw = totalSupply.potenciaKw;
    summary.currentAmp = drop.current;
    summary.dropV = drop.dropV;
    summary.dropPct = drop.dropPct;
    summary.status = assessAptitudeGeneral(drop);
    summary.note = drop.current > 0 ? 'Caida de tension estimada referencial' : 'Caida estimada con capacidad nominal por falta de demanda';
    const centerLocal = localize(center);
    const networkBounds = createBounds();
    const trackPoint = (point) => {
      if (!point) return;
      networkBounds.minX = Math.min(networkBounds.minX, point.x);
      networkBounds.minY = Math.min(networkBounds.minY, point.y);
      networkBounds.maxX = Math.max(networkBounds.maxX, point.x);
      networkBounds.maxY = Math.max(networkBounds.maxY, point.y);
    };
    const trackPath = (points) => points.forEach(trackPoint);
    const labelState = { boxes: [], center: centerLocal };
    const circuitItems = [];
    const supplyItems = [];
    const poleItems = [];
    const lineItems = [];

    trackPoint(centerLocal);

    data.circuitosBT.forEach((feature) => {
      const attrs = feature.attributes || {};
      const p = pointGeometryToUtm(feature.geometry, zone);
      if (!p) return;
      const pl = localize(p);
      trackPoint(pl);
      circuitItems.push({
        attrs,
        point: pl,
        label: [
          `CIR ${getValueByField(attrs, ['SAL_COD_SAL'], 'N/A')}`,
          `${getTipoServicioSafe(getValueByField(attrs, ['SAL_TIP_SRV'], 'N/A'))}`,
          `${getValueByField(attrs, ['SAL_CAP_AMP'], 'N/A')} A | ${getEstadoConservacionSafe(getValueByField(attrs, ['SAL_EQP_EST'], 'N/A'))}`
        ]
      });
    });

    data.suministros.forEach((feature) => {
      const attrs = feature.attributes || {};
      const p = pointGeometryToUtm(feature.geometry, zone);
      if (!p) return;
      const pl = localize(p);
      trackPoint(pl);
      supplyItems.push({
        attrs,
        point: pl,
        label: [
          `${getValueByField(attrs, ['SUM_COD_SUM'], 'N/A')} | ${getValueByField(attrs, ['SUM_NOM_SUM'], 'N/A')}`,
          `Dem ${getValueByField(attrs, ['SUM_MAX_DEM'], 'N/A')} kW | Fase ${getValueByField(attrs, ['SUM_MED_FAS'], 'N/A')}`,
          `Estado ${getValueByField(attrs, ['SUM_EST_SUM'], 'N/A')}`
        ]
      });
    });

    data.postesBT.forEach((feature) => {
      const attrs = feature.attributes || {};
      const p = pointGeometryToUtm(feature.geometry, zone);
      if (!p) return;
      const pl = localize(p);
      trackPoint(pl);
      const posteCode = getValueByField(attrs, ['NOD_COD_NOD'], 'N/A');
      const armado = [
        getValueByField(attrs, ['NOD_COD_TIP_ARM_01'], ''),
        getValueByField(attrs, ['NOD_COD_TIP_ARM_02'], ''),
        getValueByField(attrs, ['NOD_COD_TIP_ARM_03'], ''),
        getValueByField(attrs, ['NOD_COD_TIP_ARM_04'], '')
      ].filter(v => v && v !== 'N/A').join(' / ') || 'N/A';
      const carga = getValueByField(attrs, ['NOD_ESF_SPT'], 'N/A');
      const longitud = getValueByField(attrs, ['NOD_ALT_SPT'], 'N/A');
      const status = evaluateAptitudePosteBTSafe(attrs);
      poleItems.push({
        attrs,
        point: pl,
        label: [
          `NRO ${posteCode}`,
          `ARMADO ${armado}`,
          `CARGA ${carga}`,
          `LONGITUD ${longitud} m`,
          `ESTADO ${status.estado}`
        ]
      });
    });

    data.tramosBT.forEach((feature) => {
      const attrs = feature.attributes || {};
      const type = classifyLineType(attrs);
      const layer = lineLayerName(type);
      const color = lineLayerColor(type);
      const paths = flattenMultiLinePaths(feature, zone);
      if (!paths.length) return;

      paths.forEach((path) => {
        const localPath = path.map((p) => localize(p));
        trackPath(localPath);
        const mid = midpoint(localPath);
        const lengthM = polylineLength(localPath);
        lineItems.push({
          attrs,
          point: mid,
          path: localPath,
          angle: pathAngleDegrees(localPath),
          layer,
          color,
          label: [
            `${getValueByField(attrs, ['TBT_COD_TBT'], 'TRAMO')}`,
            `${getTipoRedSafe(getValueByField(attrs, ['TBT_COD_TIP_RED'], 'N/A'))} | ${getMaterialConductorSafe(getValueByField(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND', 'TBT_COD_MAT_COND'], 'N/A'))} ${getValueByField(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], 'N/A')}`,
            `L=${fmt(lengthM, 1)} m`
          ]
        });
      });
    });

    drawGrid(writer, networkBounds, 50, 'BT_GRID', 8);

    // Transformer
    writer.addCircle('BT_TRAFO', centerLocal.x, centerLocal.y, 2.2, 1);
    writer.addLine('BT_TRAFO', centerLocal.x - 1.4, centerLocal.y, centerLocal.x + 1.4, centerLocal.y, 1);
    writer.addLine('BT_TRAFO', centerLocal.x, centerLocal.y - 1.4, centerLocal.x, centerLocal.y + 1.4, 1);
    writer.addText('BT_TRAFO', centerLocal.x - 3.0, centerLocal.y + 3.8, 'SUBESTACION', 2.0, 0, 1);
    addFieldBox(writer, labelState, { x: centerLocal.x, y: centerLocal.y }, [
      { label: 'SED', value: summary.code, labelColor: 4, valueColor: 7 },
      { label: 'NOMBRE', value: summary.name, labelColor: 4, valueColor: 7 },
      { label: 'POT', value: `${fmt(summary.powerKvA, 1)} kVA`, labelColor: 4, valueColor: 7 },
      { label: 'TENSION', value: `${summary.primaryVoltage}`, labelColor: 4, valueColor: 7 }
    ], {
      width: 48,
      height: 18,
      rowHeight: 4.1,
      leftWidth: 15,
      borderColor: 4,
      leaderColor: 4,
      labelColor: 4,
      valueColor: 7,
      textHeightLabel: 1.5,
      textHeightValue: 1.5
    });

    circuitItems.forEach((item) => {
      writer.addCircle('BT_CIRCUITOS', item.point.x, item.point.y, 1.0, 6);
      addLabelBox(writer, labelState, item.point, item.label, {
        width: 46,
        rowHeight: 2.8,
        borderColor: 6,
        leaderColor: 6,
        textColor: 7,
        textHeight: 1.4,
        preference: ['ur', 'dr', 'ul', 'dl']
      });
    });

    supplyItems.forEach((item) => {
      writer.addCircle('BT_SUMINISTROS', item.point.x, item.point.y, 0.85, 4);
      addLabelBox(writer, labelState, item.point, item.label, {
        width: 52,
        rowHeight: 2.8,
        borderColor: 4,
        leaderColor: 4,
        textColor: 7,
        textHeight: 1.35,
        preference: ['ul', 'ur', 'dl', 'dr']
      });
    });

    poleItems.forEach((item) => {
      writer.addCircle('BT_POSTES', item.point.x, item.point.y, 0.9, 30);
      addFieldBox(writer, labelState, item.point, [
        { label: 'NRO', value: item.label[0].replace('NRO ', ''), labelColor: 6, valueColor: 7 },
        { label: 'ARMADO', value: item.label[1].replace('ARMADO ', ''), labelColor: 6, valueColor: 7 },
        { label: 'CARGA', value: item.label[2].replace('CARGA ', ''), labelColor: 6, valueColor: 7 },
        { label: 'LONGITUD', value: item.label[3].replace('LONGITUD ', ''), labelColor: 6, valueColor: 7 },
        { label: 'ESTADO', value: item.label[4].replace('ESTADO ', ''), labelColor: 6, valueColor: 7 }
      ], {
        width: 40,
        height: 22,
        rowHeight: 4.2,
        leftWidth: 14,
        borderColor: 30,
        leaderColor: 30,
        labelColor: 6,
        valueColor: 7,
        textHeightLabel: 1.4,
        textHeightValue: 1.4
      });
      writer.addText('BT_FERRETERIA', item.point.x + 1.0, item.point.y - 1.8, `ATERR. ${getValueByField(item.attrs, ['NOD_ATER', 'NOD_FLG_ATER', 'NOD_FLAG_ATER'], 'N/A')}`, 1.1, 0, 3);
    });

    lineItems.forEach((item) => {
      writer.addPathSegments(item.layer, item.path, item.color);
      const rad = item.angle * DEG;
      const normalA = { x: -Math.sin(rad), y: Math.cos(rad) };
      const normalB = { x: Math.sin(rad), y: -Math.cos(rad) };
      const toCenter = { x: centerLocal.x - item.point.x, y: centerLocal.y - item.point.y };
      const useA = normalA.x * toCenter.x + normalA.y * toCenter.y < normalB.x * toCenter.x + normalB.y * toCenter.y;
      const normal = useA ? normalA : normalB;
      const labelPos = offsetPoint(item.point, normal.x * 3.5, normal.y * 3.5);
      writer.addText('BT_TEXTOS', labelPos.x, labelPos.y, item.label[0], 1.25, readableTextAngle(item.angle), item.color);
      addLabelBox(writer, labelState, item.point, item.label, {
        width: 54,
        rowHeight: 2.5,
        borderColor: item.color,
        leaderColor: item.color,
        textColor: item.color,
        textHeight: 1.2,
        preference: ['ur', 'dr', 'ul', 'dl']
      });
    });

    const dropBoxAnchor = {
      x: networkBounds.maxX,
      y: networkBounds.minY
    };
    addFieldBox(writer, labelState, dropBoxAnchor, [
      { label: 'FASE', value: summary.phase, labelColor: 2, valueColor: 7 },
      { label: 'I EST.', value: `${fmt(summary.currentAmp, 2)} A`, labelColor: 2, valueColor: 7 },
      { label: 'CAIDA', value: `${fmt(summary.dropV, 2)} V`, labelColor: 2, valueColor: 7 },
      { label: 'CAIDA %', value: `${fmt(summary.dropPct, 2)}%`, labelColor: 2, valueColor: 7 },
      { label: 'ESTADO', value: summary.status, labelColor: 2, valueColor: 7 }
    ], {
      width: 42,
      height: 22,
      rowHeight: 4.2,
      leftWidth: 14,
      borderColor: 2,
      leaderColor: 2,
      labelColor: 2,
      valueColor: 7,
      textHeightLabel: 1.4,
      textHeightValue: 1.4
    });

    const titleX1 = writer.bounds.maxX + 18;
    const titleY2 = writer.bounds.maxY + 10;
    const titleW = 140;
    const titleH = 110;
    const titleX2 = titleX1 + titleW;
    const titleY1 = titleY2 - titleH;

    writer.addRectangle('BT_FRAME', titleX1, titleY1, titleX2, titleY2, 7);
    writer.addLine('BT_FRAME', titleX1, titleY2 - 16, titleX2, titleY2 - 16, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 5, 'PLANO DE METRADO Y CAIDA DE TENSION', 2.8, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 11, 'DXF GEORREFERENCIADO - BT', 1.8, 0, 8);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 21, `SED: ${summary.code}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 26, `NOMBRE: ${textSafe(summary.name).substring(0, 30)}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 31, `UBIGEO: ${summary.ubigeo}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 72, titleY2 - 21, `POT: ${fmt(summary.powerKvA, 1)} kVA`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 72, titleY2 - 26, `TENSION: ${summary.primaryVoltage}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 72, titleY2 - 31, `FASE: ${summary.phase}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 39, `CABLE: ${fmt(summary.cableKm, 3)} km`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 44, `CAIDA: ${fmt(summary.dropPct, 2)}%`, 1.6, 0, 2);
    writer.addText('BT_FRAME', titleX1 + 72, titleY2 - 39, `ESTADO: ${summary.status}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 72, titleY2 - 44, `FECHA: ${new Date().toLocaleDateString('es-PE')}`, 1.6, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 53, 'ORIGEN UTM', 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 28, titleY2 - 53, `E ${fmt(origin.x, 2)} / N ${fmt(origin.y, 2)} / Z ${zone}${hemisphere}`, 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 59, 'NOTA', 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 18, titleY2 - 59, 'PLANO TRASLADADO AL ORIGEN LOCAL', 1.4, 0, 8);

    writer.addLine('BT_FRAME', titleX1, titleY2 - 66, titleX2, titleY2 - 66, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 71, 'RESUMEN TECNICO', 1.7, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 76, `TRAMOS: ${summary.totalLineCount} | POSTES: ${summary.totalPoleCount}`, 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 81, `UNIDADES POSTE: ${summary.totalPoleUnits} | SUMINISTROS: ${summary.totalSupplyCount}`, 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 86, `CIRCUITOS: ${summary.totalCircuitCount} | CABLE: ${fmt(summary.cableKm, 3)} km`, 1.4, 0, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY2 - 91, `CAIDA: ${fmt(summary.dropPct, 2)}% | ESTADO: ${summary.status}`, 1.4, 0, summary.status === 'APTO' ? 3 : 2);

    writer.addLine('BT_FRAME', titleX1, titleY1 + 16, titleX2, titleY1 + 16, 7);
    writer.addText('BT_FRAME', titleX1 + 4, titleY1 + 11, 'LEYENDA', 1.8, 0, 7);
    writer.addLegendItem('BT_FRAME', titleX1 + 4, titleY1 + 6, 'Transformador', 'BT_TRAFO', 1);
    writer.addLegendItem('BT_FRAME', titleX1 + 4, titleY1 + 1, 'Lineas BT', 'BT_LINEAS_AEREAS', 5);
    writer.addLegendItem('BT_FRAME', titleX1 + 62, titleY1 + 6, 'Postes BT', 'BT_POSTES', 30);
    writer.addLegendItem('BT_FRAME', titleX1 + 62, titleY1 + 1, 'Suministros', 'BT_SUMINISTROS', 4);
    addNorthArrow(writer, titleX2 - 14, titleY1 + 5, 10, 'BT_FRAME', 7);
    addScaleBar(writer, titleX1 + 4, titleY1 - 4, 60, 6, 'BT_FRAME', 7);

    const outerMinX = Math.min(writer.bounds.minX, titleX1) - 12;
    const outerMinY = Math.min(writer.bounds.minY, titleY1 - 12) - 12;
    const outerMaxX = Math.max(writer.bounds.maxX, titleX2) + 12;
    const outerMaxY = Math.max(writer.bounds.maxY, titleY2) + 12;
    writer.addRectangle('BT_FRAME', outerMinX, outerMinY, outerMaxX, outerMaxY, 7);

    return {
      writer,
      summary
    };
  }

  async function loadData(codigoSED) {
    const queries = await Promise.all([
      queryArcgis(96, whereEquals('SED_COD_SED', codigoSED), true),
      queryArcgis(24, whereEquals('SUM_COD_SED', codigoSED), true),
      queryArcgis(25, whereEquals('SAL_COD_SED', codigoSED), true),
      queryArcgis(27, whereEquals('NOD_COD_SED', codigoSED), true),
      queryArcgis(33, whereEquals('TBT_COD_SED', codigoSED), true)
    ]);

    return {
      subestacion: queries[0] || [],
      suministros: queries[1] || [],
      circuitosBT: queries[2] || [],
      postesBT: queries[3] || [],
      tramosBT: queries[4] || []
    };
  }

  function downloadFile(filename, text) {
    const blob = new Blob([text], { type: 'application/dxf;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function generarReporteDXF(codigoSED = '') {
    const code = getSelectedCodigo(codigoSED);
    if (!code) {
      showNotification('Seleccione una subestacion o ingrese un codigo SED para exportar DXF', 'error');
      return;
    }

    showLoadingMessage(`Generando DXF del transformador ${code}...`);

    try {
      const data = await loadData(code);
      if (!data.subestacion.length) {
        throw new Error('No se encontro la subestacion seleccionada.');
      }

      const model = createReportModel(code, data);
      const dxf = model.writer.toString();
      const date = new Date().toISOString().split('T')[0];
      const fileName = `reporte_dxf_${code}_${date}.dxf`;
      downloadFile(fileName, dxf);
      showNotification(
        `DXF generado: ${code} | ${fmt(model.summary.dropPct, 2)}% de caida estimada`,
        'success',
        6000
      );
    } catch (error) {
      console.error('Error al generar DXF:', error);
      showNotification(`Error al generar DXF: ${error.message}`, 'error', 7000);
    } finally {
      hideLoadingMessage();
    }
  }

  window.generarReporteDXF = generarReporteDXF;
})();
