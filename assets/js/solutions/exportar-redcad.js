(function () {
  const TEMPLATE_URL = 'assets/templates/exportado_2red.xls';
  const REQUIRED_SHEETS = ['Estructuras', 'Acometidas'];
  const REDCAD_ZONE = 19;
  const REDCAD_BAND = 'L';
  const DUPLICATE_TOLERANCE_M = 1.0;
  const START_CONNECTION_TOLERANCE_M = 1.0;
  const SED_CONNECTION_TOLERANCE_M = 3.0;
  const POLE_SNAP_TOLERANCE_M = 5.0;
  const FIRST_BT_TO_SED_MAX_DISTANCE_M = 120.0;
  const LONG_BT_SEGMENT_WARNING_M = 120;

  const notify = (message, type = 'info', timeout = 7000) => {
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type, timeout);
    } else {
      console[type === 'error' ? 'error' : 'log'](message);
    }
  };

  const showLoading = (message) => {
    if (typeof window.showLoadingMessage === 'function') window.showLoadingMessage(message);
  };

  const hideLoading = () => {
    if (typeof window.hideLoadingMessage === 'function') window.hideLoadingMessage();
  };

  function text(value) {
    return String(value ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanCode(value, fallback = '') {
    return text(value || fallback)
      .replace(/[^A-Z0-9_-]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 32) || fallback;
  }

  function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function getAttr(attrs, fields, fallback = '') {
    if (typeof window.getValue === 'function') return window.getValue(attrs, fields, fallback);
    for (const field of fields || []) {
      const value = attrs?.[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function pointToLatLng(geometry) {
    if (typeof window.pointToLatLng === 'function') return window.pointToLatLng(geometry);
    const lat = Number(geometry?.y);
    const lon = Number(geometry?.x);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function pathsToLatLngs(geometry) {
    if (typeof window.pathsToLatLngs === 'function') return window.pathsToLatLngs(geometry);
    if (!geometry?.paths) return [];
    return geometry.paths
      .map(path => path
        .map(coord => [Number(coord[1]), Number(coord[0])])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)))
      .filter(path => path.length > 1);
  }

  function wgs84ToUtm19L(lat, lon) {
    if (typeof window.wgs84ToUtm === 'function') {
      const utm = window.wgs84ToUtm(lat, lon, REDCAD_ZONE);
      return { easting: utm.easting, northing: utm.northing };
    }

    const zone = REDCAD_ZONE;
    const deg = Math.PI / 180;
    const latRad = lat * deg;
    const lonRad = lon * deg;
    const lonOrigin = ((zone - 1) * 6 - 180 + 3) * deg;
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
    const easting = k0 * n * (aa + (1 - t + c) * aa ** 3 / 6 +
      (5 - 18 * t + t ** 2 + 72 * c - 58 * eccPrimeSquared) * aa ** 5 / 120) + 500000.0;
    let northing = k0 * (m + n * Math.tan(latRad) * (aa ** 2 / 2 +
      (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 +
      (61 - 58 * t + t ** 2 + 600 * c - 330 * eccPrimeSquared) * aa ** 6 / 720));
    if (lat < 0) northing += 10000000.0;
    return { easting, northing };
  }

  function projectLatLng(latlng) {
    if (!latlng) return null;
    const [lat, lon] = latlng;
    const utm = wgs84ToUtm19L(lat, lon);
    if (!Number.isFinite(utm.easting) || !Number.isFinite(utm.northing)) return null;
    return {
      lat,
      lon,
      x: round(utm.easting, 3),
      y: round(utm.northing, 3),
      zoneBand: `${REDCAD_ZONE}${REDCAD_BAND}`
    };
  }

  function distance(a, b) {
    return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
  }

  function nearest(point, nodes, maxDistance = Number.POSITIVE_INFINITY) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    nodes.forEach(node => {
      const d = distance(point, node.point);
      if (d < bestDistance) {
        best = node;
        bestDistance = d;
      }
    });
    return best && bestDistance <= maxDistance ? best : null;
  }

  async function queryLayer(layerId, where, returnGeometry = true) {
    if (typeof window.consultarArcgisReporte === 'function') {
      return window.consultarArcgisReporte(layerId, where, returnGeometry);
    }
    const arcgisQueryUrl = window.arcgisQueryUrl || (id => `https://gis.electropuno.com.pe/arcgis_server/rest/services/RedElectroPuno/MapServer/${id}/query`);
    const features = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
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
      if (!response.ok) throw new Error(`Error HTTP ${response.status} consultando capa ${layerId}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message || `Error consultando capa ${layerId}`);
      const batch = data.features || [];
      features.push(...batch);
      if (!data.exceededTransferLimit || !batch.length) break;
      offset += batch.length;
    }
    return features;
  }

  async function getRedcadData(code) {
    const whereEquals = window.whereEquals || ((field, value) => `${field} = '${String(value ?? '').replace(/'/g, "''")}'`);
    const [subestaciones, suministros, circuitosBT, postesBT, tramosBT] = await Promise.all([
      queryLayer(96, whereEquals('SED_COD_SED', code), true),
      queryLayer(24, whereEquals('SUM_COD_SED', code), true),
      queryLayer(25, whereEquals('SAL_COD_SED', code), true),
      queryLayer(27, whereEquals('NOD_COD_SED', code), true),
      queryLayer(33, whereEquals('TBT_COD_SED', code), true)
    ]);

    return {
      code,
      subestacion: subestaciones[0] || null,
      suministros,
      circuitosBT,
      postesBT,
      tramosBT
    };
  }

  function supportFrom(attrs, fallback = '') {
    const height = numberValue(getAttr(attrs, ['NOD_ALT_SPT', 'SED_ALT_SPT'], 0));
    const effort = text(getAttr(attrs, ['NOD_ESF_SPT', 'SED_ESF_SPT'], ''));
    if (height && effort) return `${height}/${effort}`;
    if (height) return String(height);
    return text(getAttr(attrs, ['NOD_COD_TIP_SPT', 'NOD_DSC_TIP_SPT'], fallback));
  }

  function armsFrom(attrs, fallback = '') {
    const arms = [];
    for (let i = 1; i <= 4; i += 1) {
      const suffix = String(i).padStart(2, '0');
      const code = text(getAttr(attrs, [`NOD_COD_TIP_ARM_${suffix}`], ''));
      if (code && code !== 'N/A') arms.push(code);
    }
    return arms.join(',') || fallback;
  }

  function conductorFrom(attrs, fallback = '') {
    const parts = [
      text(getAttr(attrs, ['TBT_SP_NRO_CND', 'TBT_AP_NRO_CND', 'TBT_NRO_CND'], '')),
      text(getAttr(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND', 'TBT_COD_MAT_COND'], '')),
      text(getAttr(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], ''))
    ].filter(Boolean);
    return parts.join(' ') || fallback;
  }

  function lineSystemFrom(attrs, fallback = '') {
    const conductors = numberValue(getAttr(attrs, ['TBT_SP_NRO_CND', 'TBT_AP_NRO_CND', 'TBT_NRO_CND'], 0));
    if (conductors) return round(conductors / 100, 2);
    const phase = text(getAttr(attrs, ['TBT_COD_TEC_FAS', 'TBT_COD_FAS', 'SAL_COD_FAS'], ''));
    if (/TRI|3F|3/i.test(phase)) return 0.14;
    if (/BI|2F|2/i.test(phase)) return 0.1;
    if (/MONO|1F|1/i.test(phase)) return 0.06;
    return fallback;
  }

  function buildPoleCandidates(postesBT) {
    return (postesBT || [])
      .map((feature, index) => {
        const point = projectLatLng(pointToLatLng(feature.geometry));
        if (!point) return null;
        return {
          feature,
          index,
          used: false,
          point,
          code: cleanCode(getAttr(feature.attributes || {}, ['NOD_COD_NOD', 'NBT_COD_NBT', 'OBJECTID'], `P${index + 1}`), `P${index + 1}`)
        };
      })
      .filter(Boolean);
  }

  function buildRedcadModel(data, defaults) {
    const sedAttrs = data.subestacion?.attributes || {};
    const sedPoint = projectLatLng(pointToLatLng(data.subestacion?.geometry));
    if (!sedPoint) throw new Error('La subestación no tiene coordenadas válidas.');

    const structures = [];
    const nodes = [];
    const poleCandidates = buildPoleCandidates(data.postesBT);
    let nextId = 1;

    const addStructure = ({ point, parentId = '', attrs = {}, kind = 'POSTE', lineAttrs = {}, code = '' }) => {
      const duplicate = nearest(point, nodes, DUPLICATE_TOLERANCE_M);
      if (duplicate) return duplicate;

      const id = nextId;
      nextId += 1;
      const tipoRed = kind === 'SED' ? 'RP' : kind === 'MT' ? 'LP' : 'RS';
      const row = {
        id,
        parentId,
        code: cleanCode(code || id, String(id)),
        zoneBand: `${REDCAD_ZONE}${REDCAD_BAND}`,
        x: point.x,
        y: point.y,
        tipoRed,
        sedNumber: text(data.code),
        sedName: text(getAttr(sedAttrs, ['SED_NOM_SED', 'SED_NOM_SUB', 'SED_DES_SED'], '')),
        sedType: text(getAttr(sedAttrs, ['SED_TIP_SED', 'SED_TIPO'], '')),
        soporte: supportFrom(attrs, defaults.estructura.Soporte),
        tipoSoporte: text(getAttr(attrs, ['NOD_DSC_TIP_SPT', 'NOD_COD_TIP_SPT'], defaults.estructura['Tipo de soporte'])),
        armadoBT: armsFrom(attrs, defaults.estructura['Armado BT principal'] || defaults.estructura['Armado Primario BT']),
        armadoBT2: defaults.estructura['Armado BT auxiliar'] || defaults.estructura['Armado Secundario BT'],
        conductor: conductorFrom(lineAttrs, defaults.estructura.Conductor),
        sistema: lineSystemFrom(lineAttrs, defaults.estructura.Sistema || defaults.estructura['Tipo de sistema de linea']),
        comentario: kind === 'SED' ? `Subestacion ${text(data.code)}` : text(getAttr(attrs, ['NOD_COD_FNC', 'NOD_DSC_FNC'], ''))
      };
      structures.push(row);
      const node = { id, point, row, kind };
      nodes.push(node);
      return node;
    };

    const sedCode = cleanCode(data.code || getAttr(sedAttrs, ['SED_COD_SED'], 'SED'), 'SED');
    const sedNode = addStructure({
      point: sedPoint,
      parentId: '',
      attrs: sedAttrs,
      kind: 'SED',
      code: sedCode
    });

    (data.circuitosBT || []).forEach((feature, index) => {
      const point = projectLatLng(pointToLatLng(feature.geometry)) || sedPoint;
      const attrs = feature.attributes || {};
      addStructure({
        point,
        parentId: sedNode.id,
        attrs,
        kind: 'BT',
        code: getAttr(attrs, ['SAL_COD_SAL', 'SAL_COD_CBT', 'OBJECTID'], `SAL${index + 1}`)
      });
    });

    (data.tramosBT || []).forEach((feature, featureIndex) => {
      const attrs = feature.attributes || {};
      pathsToLatLngs(feature.geometry).forEach((path, pathIndex) => {
        let parent = nearest(projectLatLng(path[0]), nodes, Number.POSITIVE_INFINITY) || sedNode;
        path.forEach((latlng, vertexIndex) => {
          const point = projectLatLng(latlng);
          if (!point) return;
          const existing = nearest(point, nodes, DUPLICATE_TOLERANCE_M);
          if (existing) {
            parent = existing;
            return;
          }
          const pole = nearest(point, poleCandidates.filter(item => !item.used), DUPLICATE_TOLERANCE_M);
          if (pole) pole.used = true;
          const node = addStructure({
            point,
            parentId: parent?.id || sedNode.id,
            attrs: pole?.feature?.attributes || {},
            lineAttrs: attrs,
            kind: 'BT',
            code: pole?.code || getAttr(attrs, ['TBT_COD_TBT', 'OBJECTID'], `TBT${featureIndex + 1}_${pathIndex + 1}_${vertexIndex + 1}`)
          });
          parent = node;
        });
      });
    });

    poleCandidates
      .filter(pole => !pole.used && !nearest(pole.point, nodes, DUPLICATE_TOLERANCE_M))
      .sort((a, b) => distance(sedPoint, a.point) - distance(sedPoint, b.point))
      .forEach(pole => {
        const parent = nearest(pole.point, nodes, Number.POSITIVE_INFINITY) || sedNode;
        addStructure({
          point: pole.point,
          parentId: parent.id,
          attrs: pole.feature.attributes || {},
          kind: 'BT',
          code: pole.code
        });
      });

    const acometidas = (data.suministros || [])
      .map((feature, index) => {
        const attrs = feature.attributes || {};
        const point = projectLatLng(pointToLatLng(feature.geometry));
        if (!point) return null;
        const parent = nearest(point, nodes, Number.POSITIVE_INFINITY) || sedNode;
        const code = cleanCode(getAttr(attrs, ['SUM_COD_SUM', 'OBJECTID'], `SUM${index + 1}`), `SUM${index + 1}`);
        return {
          parentId: parent.id,
          number: index + 1,
          x: point.x,
          y: point.y,
          tipo: defaults.acometida.Tipo,
          longitudReal: round(distance(parent.point, point), 3),
          longitudSobreescrita: defaults.acometida['Longitud sobreescrita'],
          accesorio: text(getAttr(attrs, ['SUM_ACC_ACO', 'SUM_TIP_ACO'], defaults.acometida['Accesorio de Acometida'])),
          carga: defaults.acometida.Carga,
          nombre: text(getAttr(attrs, ['SUM_NOM_SUM', 'SUM_DIR_SUM'], code)),
          potencia: numberValue(getAttr(attrs, ['SUM_MAX_DEM', 'SUM_POT_CON', 'SUM_POT_EQT'], defaults.acometida['Potencia (kW)'])) || defaults.acometida['Potencia (kW)'],
          factor: numberValue(getAttr(attrs, ['SUM_FAC_SIM', 'SUM_FS'], defaults.acometida['Factor de simultaneidad'])) || defaults.acometida['Factor de simultaneidad']
        };
      })
      .filter(Boolean);

    validateModel(structures, acometidas);
    return { structures, acometidas };
  }

  function normalizeHeader(value) {
    return text(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[°º]/g, 'o')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function findSheetInfo(workbook, sheetName, requiredHeader) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`La plantilla no tiene la hoja "${sheetName}".`);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: '' });
    const headerRowIndex = rows.findIndex(row => row.some(cell => normalizeHeader(cell) === normalizeHeader(requiredHeader)));
    if (headerRowIndex < 0) throw new Error(`No se encontraron encabezados válidos en la hoja "${sheetName}".`);
    const headers = rows[headerRowIndex].map(text);
    const defaultRow = rows[headerRowIndex + 1] || [];
    const defaults = {};
    headers.forEach((header, index) => {
      if (header) defaults[header] = defaultRow[index] ?? '';
    });
    return { sheet, rows, headerRowIndex, headers, defaults };
  }

  function getDefault(defaults, candidates) {
    for (const candidate of candidates) {
      const key = Object.keys(defaults).find(header => normalizeHeader(header) === normalizeHeader(candidate));
      if (key && defaults[key] !== '') return defaults[key];
    }
    return '';
  }

  function buildDefaults(structInfo, dropInfo) {
    return {
      estructura: {
        Soporte: getDefault(structInfo.defaults, ['Soporte']),
        'Tipo de soporte': getDefault(structInfo.defaults, ['Tipo de soporte']),
        'Armado BT principal': getDefault(structInfo.defaults, ['Armado BT principal', 'Armado Primario BT']),
        'Armado Primario BT': getDefault(structInfo.defaults, ['Armado Primario BT']),
        'Armado BT auxiliar': getDefault(structInfo.defaults, ['Armado BT auxiliar', 'Armado Secundario BT']),
        'Armado Secundario BT': getDefault(structInfo.defaults, ['Armado Secundario BT']),
        Conductor: getDefault(structInfo.defaults, ['Conductor']),
        Sistema: getDefault(structInfo.defaults, ['Sistema', 'Tipo de sistema de linea']),
        'Tipo de sistema de linea': getDefault(structInfo.defaults, ['Tipo de sistema de linea']),
        'Tipo Red': getDefault(structInfo.defaults, ['Tipo Red']),
        'Tipo Subestación': getDefault(structInfo.defaults, ['Tipo Subestación', 'Tipo Subestacion']),
        'Soporte SED': '12/200',
        'Soporte BT': '8/200',
        'Armado SED': getDefault(structInfo.defaults, ['Armado Primario BT']) || 'E3',
        'Armado BT simple': 'E1',
        'Conductor BT': getDefault(structInfo.defaults, ['Conductor']) || '1x25/25'
      },
      acometida: {
        Tipo: getDefault(dropInfo.defaults, ['Tipo']) || 'Corta',
        Carga: getDefault(dropInfo.defaults, ['Carga']) || 'Carga 1ø - Tipo 2',
        'Longitud sobreescrita': getDefault(dropInfo.defaults, ['Longitud sobreescrita']),
        'Accesorio de Acometida': getDefault(dropInfo.defaults, ['Accesorio de Acometida']) || 'Murete existente',
        'Potencia (kW)': getDefault(dropInfo.defaults, ['Potencia (kW)']) || 0.8,
        'Factor de simultaneidad': getDefault(dropInfo.defaults, ['Factor de simultaneidad']) || 0.5
      }
    };
  }

  function structureValue(header, row) {
    const h = normalizeHeader(header);
    if (h === 'id estructura') return row.id;
    if (h.includes('id estructura padre')) return row.parentId;
    if (h.includes('codigo de estructura')) return row.code;
    if (h.includes('zona') && h.includes('banda')) return row.zoneBand;
    if (h === 'x' || h === 'x(m)' || h === 'x (m)') return row.x;
    if (h === 'y' || h === 'y(m)' || h === 'y (m)') return row.y;
    if (h.includes('tipo red')) return row.tipoRed;
    if (h.includes('subestacion') && (h.includes('no') || h.includes('n '))) return row.sedNumber;
    if (h.includes('nombre') && h.includes('subestacion')) return row.sedName;
    if (h.includes('tipo') && h.includes('subestacion')) return row.sedType;
    if (h.includes('armado') && h.includes('bt') && (h.includes('principal') || h.includes('primario'))) return row.armadoBT;
    if (h.includes('armado') && h.includes('bt') && (h.includes('auxiliar') || h.includes('secundario'))) return row.armadoBT2;
    if (h === 'soporte') return row.soporte;
    if (h.includes('tipo de soporte')) return row.tipoSoporte;
    if (h.includes('cantidad') && h.includes('soporte')) return row.cantidadSoportes ?? 1;
    if (h.includes('conductor')) return row.conductor;
    if (h === 'sistema' || h.includes('tipo de sistema')) return row.sistema;
    if (h.includes('comentario')) return row.comentario;
    if (h.includes('cimentacion')) return row.cimentacion || '';
    if (h.includes('terreno')) return row.terreno || '';
    if (h.includes('accesibilidad')) return row.accesibilidad || '';
    return undefined;
  }

  function dropValue(header, row) {
    const h = normalizeHeader(header);
    if (h === 'id estructura') return row.parentId;
    if (h.includes('acom')) return row.number;
    if (h === 'x' || h === 'x(m)' || h === 'x (m)') return row.x;
    if (h === 'y' || h === 'y(m)' || h === 'y (m)') return row.y;
    if (h === 'tipo') return row.tipo;
    if (h.includes('longitud real')) return row.longitudReal;
    if (h.includes('longitud sobreescrita')) return row.longitudSobreescrita;
    if (h.includes('accesorio')) return row.accesorio;
    if (h.includes('carga')) return row.carga;
    if (h.includes('nombre')) return row.nombre;
    if (h.includes('potencia')) return row.potencia;
    if (h.includes('simultaneidad')) return row.factor;
    return undefined;
  }

  function cloneStyle(sourceCell) {
    if (!sourceCell) return {};
    const cloned = {};
    if (sourceCell.s) cloned.s = JSON.parse(JSON.stringify(sourceCell.s));
    if (sourceCell.z) cloned.z = sourceCell.z;
    return cloned;
  }

  function replaceSheetRows(info, dataRows, valueGetter) {
    const XLSX = window.XLSX;
    const range = XLSX.utils.decode_range(info.sheet['!ref']);
    const firstDataRow = 2;
    const templateDataRow = firstDataRow;
    const maxRow = Math.max(range.e.r, firstDataRow + dataRows.length + 20);
    const maxCol = Math.max(range.e.c, info.headers.length - 1);
    const templateStyles = info.headers.map((_, c) => {
      const cell = info.sheet[XLSX.utils.encode_cell({ r: templateDataRow, c })];
      return cloneStyle(cell);
    });

    for (let r = firstDataRow; r <= maxRow; r += 1) {
      for (let c = 0; c <= maxCol; c += 1) {
        delete info.sheet[XLSX.utils.encode_cell({ r, c })];
      }
    }

    dataRows.forEach((row, rowOffset) => {
      const r = firstDataRow + rowOffset;
      info.headers.forEach((header, c) => {
        const value = valueGetter(header, row);
        if (value === undefined) return;
        const cell = JSON.parse(JSON.stringify(templateStyles[c] || {}));
        cell.v = value;
        cell.t = typeof value === 'number' ? 'n' : 's';
        info.sheet[XLSX.utils.encode_cell({ r, c })] = cell;
      });
    });

    range.e.r = Math.max(info.headerRowIndex, firstDataRow + dataRows.length - 1);
    range.e.c = info.headers.length - 1;
    info.sheet['!ref'] = XLSX.utils.encode_range(range);
  }

  function validateModel(structures, acometidas) {
    const ids = new Set();
    structures.forEach(row => {
      if (ids.has(row.id)) throw new Error(`ID de estructura duplicado: ${row.id}`);
      ids.add(row.id);
      if (row.zoneBand !== '19L') throw new Error(`Zona/Banda inválida en estructura ${row.id}.`);
      if (!Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y))) {
        throw new Error(`Coordenadas inválidas en estructura ${row.id}.`);
      }
      row.code = row.code ? cleanCode(row.code, '') : '';
    });

    const roots = structures.filter(row => row.parentId === '' || row.parentId === 0 || row.parentId === null);
    if (!roots.length) throw new Error('Debe existir al menos un nodo raíz sin padre.');
    structures.forEach(row => {
      if (row.parentId === '' || row.parentId === 0 || row.parentId === null) return;
      if (!ids.has(Number(row.parentId))) throw new Error(`El ID padre ${row.parentId} no existe.`);
    });

    acometidas.forEach((row, index) => {
      if (!ids.has(Number(row.parentId))) throw new Error(`La acometida ${index + 1} apunta a una estructura inexistente.`);
      if (!Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y))) {
        throw new Error(`Coordenadas inválidas en acometida ${index + 1}.`);
      }
    });
  }

  function validateTemplateRows(workbook) {
    const XLSX = window.XLSX;
    REQUIRED_SHEETS.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const a2 = text(sheet?.[XLSX.utils.encode_cell({ r: 1, c: 0 })]?.v);
      if (normalizeHeader(a2) !== 'id estructura') {
        throw new Error(`La celda A2 de "${sheetName}" fue alterada o no contiene "ID Estructura".`);
      }
    });
  }

  async function loadTemplateWorkbook() {
    if (!window.XLSX) throw new Error('No está cargada la librería XLSX.');
    let workbook = null;

    try {
      const response = await fetch(TEMPLATE_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`No se pudo cargar la plantilla ${TEMPLATE_URL}.`);
      const buffer = await response.arrayBuffer();
      workbook = window.XLSX.read(buffer, { type: 'array', cellStyles: true, cellNF: true });
    } catch (error) {
      if (!window.REDCAD_TEMPLATE_BASE64) throw error;
      workbook = window.XLSX.read(window.REDCAD_TEMPLATE_BASE64, { type: 'base64', cellStyles: true, cellNF: true });
    }

    REQUIRED_SHEETS.forEach(sheetName => {
      if (!workbook.SheetNames.includes(sheetName)) throw new Error(`La plantilla no contiene la hoja "${sheetName}".`);
    });
    validateTemplateRows(workbook);
    return workbook;
  }

  function downloadWorkbook(workbook, filename) {
    const output = window.XLSX.write(workbook, {
      bookType: 'biff8',
      type: 'array',
      cellStyles: true
    });
    const blob = new Blob([output], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function selectedSedCode(code = '') {
    return text(
      code ||
      window.transformadorSeleccionado ||
      document.getElementById('inputID')?.value ||
      ''
    );
  }

  function dateStamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
  }

  function normalizeText(value) {
    return text(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function classifyPlacemark(name, description) {
    const raw = normalizeText(`${name} ${description}`);
    if (raw.includes('subestacion')) return 'subestacion';
    if (/^poste\s+n(bt|mt)?[0-9]/i.test(text(name))) return 'poste';
    if (
      (raw.includes('tramo bt') && raw.includes('aereo')) ||
      (/^tbt[0-9]/i.test(text(name)) && raw.includes('cable') && raw.includes('aereo')) ||
      (/^tbt[0-9]/i.test(text(name)) && raw.includes('tipo red') && raw.includes('aereo'))
    ) return 'tramo_bt';
    if (
      (raw.includes('linea mt') && raw.includes('aereo')) ||
      (/^tmt[0-9]/i.test(text(name)) && raw.includes('aereo'))
    ) return 'linea_mt';
    if (raw.includes('suministro')) return 'suministro';
    return 'otro';
  }

  function isGeneratedCablePlacemark(name, description) {
    const raw = normalizeText(`${name} ${description}`);
    return /^tbt[0-9]/i.test(text(name)) && raw.includes('cable');
  }

  function latLngToKey(latlng) {
    const point = projectLatLng(latlng);
    if (!point) return '';
    return `${Math.round(point.x)},${Math.round(point.y)}`;
  }

  function segmentKey(path) {
    if (!path || path.length < 2) return '';
    const a = latLngToKey(path[0]);
    const b = latLngToKey(path[path.length - 1]);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function poleCodeFromText(value) {
    const match = text(value).match(/N(?:BT|MT)?[0-9]+/i);
    return match ? match[0].toUpperCase() : '';
  }

  function pointToSegmentDistanceMeters(pointLatLng, startLatLng, endLatLng) {
    const p = projectLatLng(pointLatLng);
    const a = projectLatLng(startLatLng);
    const b = projectLatLng(endLatLng);
    if (!p || !a || !b) return 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return distance(p, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function simplifyPath(path, toleranceMeters = 0) {
    if (!toleranceMeters || !Array.isArray(path) || path.length <= 2) return path || [];
    let maxDistance = 0;
    let index = 0;
    for (let i = 1; i < path.length - 1; i += 1) {
      const d = pointToSegmentDistanceMeters(path[i], path[0], path[path.length - 1]);
      if (d > maxDistance) {
        index = i;
        maxDistance = d;
      }
    }
    if (maxDistance <= toleranceMeters) return [path[0], path[path.length - 1]];
    const left = simplifyPath(path.slice(0, index + 1), toleranceMeters);
    const right = simplifyPath(path.slice(index), toleranceMeters);
    return left.slice(0, -1).concat(right);
  }

  function parseCoordinateText(value) {
    return text(value)
      .split(/\s+/)
      .map(part => {
        const pieces = part.split(',').map(Number);
        const lon = pieces[0];
        const lat = pieces[1];
        return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
      })
      .filter(Boolean);
  }

  function getElements(parent, tagName) {
    return Array.from(parent.getElementsByTagNameNS('*', tagName))
      .concat(Array.from(parent.getElementsByTagName(tagName)))
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  function placemarkName(pm) {
    return text(getElements(pm, 'name')[0]?.textContent || '');
  }

  function placemarkDescription(pm) {
    return text(getElements(pm, 'description')[0]?.textContent || '');
  }

  function parseKmlPlacemarks(kmlText) {
    const documentXml = new DOMParser().parseFromString(kmlText, 'application/xml');
    const parserError = documentXml.getElementsByTagName('parsererror')[0];
    if (parserError) throw new Error('El archivo KML no tiene XML válido.');

    const result = {
      subestacion: null,
      postes: [],
      tramosBT: [],
      lineasMT: [],
      suministros: []
    };

    const seenBtSegments = new Set();

    getElements(documentXml, 'Placemark').forEach((pm, index) => {
      const name = placemarkName(pm);
      const description = placemarkDescription(pm);
      const type = classifyPlacemark(name, description);
      const coordinateNodes = getElements(pm, 'coordinates');
      let paths = coordinateNodes
        .map(node => parseCoordinateText(node.textContent || ''))
        .filter(path => path.length > 0);
      if (type === 'tramo_bt' && isGeneratedCablePlacemark(name, description)) {
        paths = paths
          .map(path => path.length > 1 ? [path[0], path[path.length - 1]] : path)
          .filter(path => path.length > 1);
      } else if (type === 'tramo_bt') {
        paths = paths.map(path => simplifyPath(path, 0)).filter(path => path.length > 1);
      }
      const firstPoint = paths.find(path => path.length)?.[0] || null;

      if (type === 'subestacion' && firstPoint && !result.subestacion) {
        result.subestacion = { name, description, latlng: firstPoint };
      } else if (type === 'poste' && firstPoint) {
        const code = poleCodeFromText(`${name} ${description}`) || cleanCode(name, `POSTE_${index + 1}`);
        if (!result.postes.some(poste => poste.code === code)) {
          result.postes.push({ name, description, code, latlng: firstPoint, index });
        }
      } else if (type === 'tramo_bt') {
        paths.filter(path => path.length > 1).forEach(path => {
          const key = segmentKey(path);
          if (key && seenBtSegments.has(key)) return;
          if (key) seenBtSegments.add(key);
          result.tramosBT.push({ name, description, path, index });
        });
      } else if (type === 'linea_mt') {
        paths.filter(path => path.length > 1).forEach(path => {
          result.lineasMT.push({ name, description, path, index });
        });
      } else if (type === 'suministro' && firstPoint) {
        result.suministros.push({ name, description, latlng: firstPoint, index });
      }
    });

    if (!result.subestacion) throw new Error('No se encontró Placemark con descripción Subestacion.');
    if (!result.tramosBT.length) throw new Error('No se encontraron Placemarks con descripción Tramo BT Aéreo.');
    return result;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureJsZip() {
    if (window.JSZip) return window.JSZip;
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    if (!window.JSZip) throw new Error('No se pudo cargar JSZip para leer KMZ.');
    return window.JSZip;
  }

  async function readKmlOrKmz(file) {
    if (!file) throw new Error('Seleccione un archivo KMZ o KML.');
    const name = file.name.toLowerCase();
    if (name.endsWith('.kml')) return file.text();
    if (!name.endsWith('.kmz')) throw new Error('El archivo debe ser .kmz o .kml.');

    const JSZip = await ensureJsZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry = zip.file(/\.kml$/i).sort((a, b) => {
      if (/doc\.kml$/i.test(a.name)) return -1;
      if (/doc\.kml$/i.test(b.name)) return 1;
      return a.name.localeCompare(b.name);
    })[0];
    if (!kmlEntry) throw new Error('El KMZ no contiene archivo KML interno.');
    return kmlEntry.async('text');
  }

  function rowBase({ id, parentId, point, tipoRed, code = '', comentario = '' }) {
    return {
      id,
      parentId,
      code,
      zoneBand: '19L',
      x: point.x,
      y: point.y,
      tipoRed,
      sedNumber: '',
      sedName: '',
      sedType: '',
      armadoBT: '',
      armadoBT2: '',
      soporte: '',
      tipoSoporte: '',
      cantidadSoportes: 1,
      conductor: '',
      sistema: '',
      cimentacion: 'CM',
      terreno: 'I',
      accesibilidad: 'TA',
      comentario
    };
  }

  function substationTypeFromParsed(parsed, fallback) {
    const raw = text(`${parsed?.subestacion?.name || ''} ${parsed?.subestacion?.description || ''}`);
    const powerMatch = raw.match(/potencia\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kva/i) ||
      raw.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*kva\b/i);
    if (!powerMatch) return fallback;
    const power = powerMatch[1].replace('.', ',');
    const voltageMatch = raw.match(/tensi[oó]n\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*kv/i);
    const voltage = voltageMatch ? voltageMatch[1].replace('.', ',') : '22,9';
    return `${power}kVA-2ø-${voltage}kV`;
  }

  function buildRedcadModelFromKml(parsed, defaults) {
    const sedPoint = projectLatLng(parsed.subestacion.latlng);
    if (!sedPoint) throw new Error('La subestación no tiene coordenadas válidas.');

    const structures = [];
    const btNodes = [];
    const nodeByCode = new Map();
    let nextId = 1;
    const knownPoles = (parsed.postes || [])
      .map(poste => ({
        code: cleanCode(poste.code || poste.name, ''),
        point: projectLatLng(poste.latlng),
        source: poste
      }))
      .filter(pole => pole.code && pole.point);

    const sedCode = getSedCodeFromParsed(parsed);
    const sed = rowBase({
      id: nextId++,
      parentId: 0,
      point: sedPoint,
      tipoRed: 'RP',
      comentario: 'Subestacion - poste MT'
    });
    sed.sedNumber = 1;
    sed.sedName = sedCode;
    sed.sedType = substationTypeFromParsed(parsed, defaults.estructura['Tipo Subestación'] || '5kVA-2ø-22,9kV');
    sed.armadoBT = '';
    sed.soporte = defaults.estructura['Soporte SED'] || '12/300';
    sed.cantidadSoportes = 1;
    sed.cimentacion = 'CM12';
    sed.terreno = 'I';
    sed.accesibilidad = 'TA';
    structures.push(sed);

    const createBtNode = (snap, parentId, isFirstInBranch) => {
      const point = snap.point || snap;
      const row = rowBase({
        id: nextId++,
        parentId,
        point,
        tipoRed: 'RS',
        code: snap.code || '',
        comentario: 'BT generado desde Tramo BT Aéreo'
      });
      row.armadoBT = isFirstInBranch ? (defaults.estructura['Armado SED'] || 'E3') : (defaults.estructura['Armado BT simple'] || 'E1');
      row.soporte = defaults.estructura['Soporte BT'] || defaults.estructura.Soporte || '8/200';
      row.cantidadSoportes = 1;
      row.cimentacion = 'CM';
      row.terreno = 'I';
      row.accesibilidad = 'TA';
      row.conductor = defaults.estructura['Conductor BT'] || defaults.estructura.Conductor || '1x25/25';
      row.sistema = defaults.estructura.Sistema || defaults.estructura['Tipo de sistema de linea'] || '1ø-2';
      structures.push(row);
      const node = { id: row.id, point, row, code: row.code || '' };
      btNodes.push(node);
      if (node.code) nodeByCode.set(node.code, node);
      return node;
    };

    const debugSegments = [];
    const writtenEdges = new Set();

    const edgeKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
    const addDebugSegment = (fromNode, toNode, tramoName) => {
      if (!fromNode || !toNode || fromNode.id === toNode.id) return;
      const key = edgeKey(fromNode.id, toNode.id);
      if (writtenEdges.has(key)) return;
      writtenEdges.add(key);
      const length = distance(fromNode.point, toNode.point);
      debugSegments.push({
        from: fromNode.id,
        to: toNode.id,
        length,
        tramo: tramoName,
        warning: length > LONG_BT_SEGMENT_WARNING_M ? 'SEGMENTO_LARGO_BT' : '',
        coordinates: [
          [fromNode.point.lon, fromNode.point.lat],
          [toNode.point.lon, toNode.point.lat]
        ]
      });
    };
    const sedAsNode = { id: sed.id, point: sedPoint, row: sed };
    const snapToKnownPole = point => {
      if (distance(point, sedPoint) <= START_CONNECTION_TOLERANCE_M) {
        return { point: sedPoint, code: '', source: 'subestacion' };
      }
      const pole = nearest(point, knownPoles, POLE_SNAP_TOLERANCE_M);
      if (!pole) return { point, code: '', source: 'line' };
      return {
        point: pole.point,
        code: pole.code,
        source: 'poste',
        originalPoint: point,
        snapDistance: distance(point, pole.point)
      };
    };
    const getExistingNode = snap => {
      const code = cleanCode(snap?.code || '', '');
      if (code && nodeByCode.has(code)) return nodeByCode.get(code);
      return nearest(snap.point || snap, btNodes, DUPLICATE_TOLERANCE_M);
    };
    const getOrCreateNode = (snap, parentId = 0, isFirstInBranch = false) => {
      const existing = getExistingNode(snap);
      if (existing) return existing;
      return createBtNode(snap, parentId, isFirstInBranch);
    };
    const assignParentFromSegment = (parentNode, childNode, tramoName) => {
      if (!parentNode || !childNode || parentNode.id === childNode.id) return;
      const currentParent = Number(childNode.row.parentId || 0);
      if (!currentParent) {
        childNode.row.parentId = parentNode.id;
        addDebugSegment(parentNode, childNode, tramoName);
        return;
      }
      if (currentParent === parentNode.id) {
        addDebugSegment(parentNode, childNode, tramoName);
      }
    };

    parsed.tramosBT.forEach((tramo, tramoIndex) => {
      let projectedPath = (tramo.path || [])
        .map(latlng => projectLatLng(latlng))
        .filter(Boolean)
        .map(point => snapToKnownPole(point));
      if (projectedPath.length < 2) return;

      const startExisting = getExistingNode(projectedPath[0]);
      const endExisting = getExistingNode(projectedPath[projectedPath.length - 1]);
      if (!startExisting && endExisting) {
        projectedPath = projectedPath.slice().reverse();
      }

      let previousNode = null;
      projectedPath.forEach((point, vertexIndex) => {
        let parentId = 0;
        let parentNode = null;

        if (vertexIndex === 0) {
          if (point.source === 'subestacion') {
            previousNode = sedAsNode;
            return;
          }
          const existing = getExistingNode(point);
          if (existing) {
            previousNode = existing;
            return;
          }
          if (!point.code && distance(point.point, sedPoint) <= START_CONNECTION_TOLERANCE_M) {
            previousNode = sedAsNode;
            return;
          }
          if (distance(point.point, sedPoint) <= SED_CONNECTION_TOLERANCE_M) {
            parentId = sed.id;
          }
          previousNode = getOrCreateNode(point, parentId, parentId === sed.id);
          if (parentNode) addDebugSegment(parentNode, previousNode, tramo.name || `Tramo ${tramoIndex + 1}`);
          return;
        }

        const currentNode = getOrCreateNode(point, 0, false);
        assignParentFromSegment(previousNode, currentNode, tramo.name || `Tramo ${tramoIndex + 1}`);
        previousNode = currentNode;
      });
    });

    if (!btNodes.length) throw new Error('No se generó ningún poste desde Tramo BT Aéreo.');
    if (!btNodes.some(node => Number(node.row.parentId || 0) === sed.id)) {
      const firstBtNode = nearest(sedPoint, btNodes, FIRST_BT_TO_SED_MAX_DISTANCE_M);
      if (firstBtNode) {
        firstBtNode.row.parentId = sed.id;
        firstBtNode.row.comentario = 'Primer poste BT real';
        addDebugSegment(sedAsNode, firstBtNode, 'Subestacion -> primer poste BT');
      }
    }

    const countsByPole = new Map();
    const acometidas = parsed.suministros.map((suministro, index) => {
      const point = projectLatLng(suministro.latlng);
      if (!point) return null;
      const parent = nearest(point, btNodes, Number.POSITIVE_INFINITY);
      if (!parent) throw new Error(`El suministro ${index + 1} no tiene poste BT cercano.`);
      const count = (countsByPole.get(parent.id) || 0) + 1;
      countsByPole.set(parent.id, count);
      return {
        parentId: parent.id,
        number: count,
        x: point.x,
        y: point.y,
        tipo: defaults.acometida.Tipo,
        longitudReal: round(distance(parent.point, point), 3),
        longitudSobreescrita: '',
        accesorio: defaults.acometida['Accesorio de Acometida'],
        carga: defaults.acometida.Carga,
        nombre: text(suministro.name || suministro.description || `Suministro ${index + 1}`),
        potencia: defaults.acometida['Potencia (kW)'],
        factor: defaults.acometida['Factor de simultaneidad']
      };
    }).filter(Boolean);

    validateModel(structures, acometidas);
    return { structures, acometidas, debugSegments };
  }

  function defaultRedcadValues() {
    return {
      estructura: {
        'Tipo Subestación': '5kVA-2ø-22,9kV',
        'Soporte SED': '12/300',
        'Soporte BT': '8/200',
        'Armado SED': 'E3',
        'Armado BT simple': 'E1',
        'Conductor BT': '1x25/25',
        Sistema: '1ø-2'
      },
      acometida: {
        Tipo: 'Corta',
        Carga: 'C.E. Inicial',
        'Longitud sobreescrita': '',
        'Accesorio de Acometida': '',
        'Potencia (kW)': 0.8,
        'Factor de simultaneidad': 0.5
      }
    };
  }

  function getSedCodeFromParsed(parsed) {
    const values = [
      parsed?.subestacion?.name,
      parsed?.subestacion?.description,
      selectedSedCode()
    ].map(text);
    for (const value of values) {
      const match = value.match(/SED[0-9]+/i);
      if (match) return match[0].toUpperCase();
    }
    return cleanCode(values.find(Boolean) || 'SED', 'SED');
  }

  function toRedcadDataJson(parsed, model) {
    const sed = getSedCodeFromParsed(parsed);
    return {
      sed,
      zona_banda: '19L',
      estructuras: model.structures.map(row => ({
        id: row.id,
        padre: row.parentId,
        codigo: row.code || '',
        zona_banda: row.zoneBand,
        x: row.x,
        y: row.y,
        tipo_red: row.tipoRed,
        n_subestacion: row.sedNumber,
        nombre_subestacion: row.sedName,
        tipo_subestacion: row.sedType,
        armado_bt: row.armadoBT,
        soporte: row.soporte,
        cantidad_soportes: row.cantidadSoportes ?? 1,
        cimentacion: row.cimentacion,
        terreno: row.terreno,
        accesibilidad: row.accesibilidad,
        conductor: row.conductor,
        sistema_linea: row.sistema,
        comentario: row.comentario || ''
      })),
      acometidas: model.acometidas.map(row => ({
        id_estructura: row.parentId,
        n_acometida: row.number,
        x: row.x,
        y: row.y,
        tipo: row.tipo,
        longitud_real: row.longitudReal,
        longitud_sobreescrita: row.longitudSobreescrita || '',
        accesorio: row.accesorio || '',
        carga: row.carga,
        nombre: row.nombre,
        potencia: row.potencia,
        factor_simultaneidad: row.factor
      })),
      debug_geojson: {
        type: 'FeatureCollection',
        features: (model.debugSegments || []).map(segment => ({
          type: 'Feature',
          properties: {
            from: segment.from,
            to: segment.to,
            length_m: Math.round(segment.length * 1000) / 1000,
            tramo: segment.tramo,
            warning: segment.warning || ''
          },
          geometry: {
            type: 'LineString',
            coordinates: segment.coordinates
          }
        }))
      }
    };
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function prepararRedcadDataDesdeArchivo() {
    const file = selectedRedcadFile();
    if (!file) {
      throw new Error('Seleccione primero un archivo KMZ o KML.');
    }
    const kmlText = await readKmlOrKmz(file);
    const parsed = parseKmlPlacemarks(kmlText);
    const model = buildRedcadModelFromKml(parsed, defaultRedcadValues());
    return toRedcadDataJson(parsed, model);
  }

  function selectedUbigeos() {
    return text(document.getElementById('inputUbigeo')?.value || '')
      .split(',')
      .map(item => text(item))
      .filter(Boolean);
  }

  function whereAny(field, values) {
    const eq = window.whereEquals || ((name, value) => `${name} = '${String(value ?? '').replace(/'/g, "''")}'`);
    return values.map(value => eq(field, value)).join(' OR ');
  }

  async function runInChunks(items, size, worker) {
    const output = [];
    for (let i = 0; i < items.length; i += size) {
      const batch = await Promise.all(items.slice(i, i + size).map(worker));
      output.push(...batch);
    }
    return output;
  }

  async function loadGeneralRedcadByUbigeo(ubigeos) {
    if (!ubigeos.length) throw new Error('Ingrese al menos un ubigeo/BIGEO.');
    const sedWhere = `1=1 AND (${whereAny('SED_COD_UBI', ubigeos)})`;
    const mtWhere = `1=1 AND (${whereAny('TMT_COD_UBI', ubigeos)})`;
    const mtNodeWhere = `1=1 AND (${whereAny('NOD_COD_UBI', ubigeos)})`;
    const [sedes, lineasMT, estructurasMT] = await Promise.all([
      queryLayer(96, sedWhere, true),
      queryLayer(101, mtWhere, true),
      queryLayer(91, mtNodeWhere, true)
    ]);
    const sedesValidas = sedes.filter(feature => text(getAttr(feature.attributes || {}, ['SED_COD_SED'], '')));
    const btData = await runInChunks(sedesValidas, 4, async (sedFeature) => {
      const sedCode = text(getAttr(sedFeature.attributes || {}, ['SED_COD_SED'], ''));
      const [suministros, circuitosBT, postesBT, retenidasBT, puestasTierraBT, tramosBT] = await Promise.all([
        queryLayer(24, whereAny('SUM_COD_SED', [sedCode]), true),
        queryLayer(25, whereAny('SAL_COD_SED', [sedCode]), true),
        queryLayer(27, whereAny('NOD_COD_SED', [sedCode]), true),
        queryLayer(28, whereAny('RET_COD_SED', [sedCode]), true),
        queryLayer(29, whereAny('PAT_COD_SED', [sedCode]), true),
        queryLayer(33, whereAny('TBT_COD_SED', [sedCode]), true)
      ]);
      return { sedFeature, sedCode, suministros, circuitosBT, postesBT, retenidasBT, puestasTierraBT, tramosBT };
    });
    return { ubigeos, sedes: sedesValidas, lineasMT, estructurasMT, btData };
  }

  function kmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function kmlCoordinateFromLatLng(latlng) {
    if (!latlng) return '';
    const [lat, lon] = latlng;
    return `${Number(lon).toFixed(8)},${Number(lat).toFixed(8)},0`;
  }

  function kmlPointPlacemark(name, style, latlng, description = '') {
    if (!latlng) return '';
    return `<Placemark><name>${kmlEscape(name)}</name><description>${kmlEscape(description)}</description><styleUrl>${style}</styleUrl><Point><coordinates>${kmlCoordinateFromLatLng(latlng)}</coordinates></Point></Placemark>`;
  }

  function kmlLinePlacemark(name, style, path, description = '') {
    if (!path || path.length < 2) return '';
    const coords = path.map(kmlCoordinateFromLatLng).filter(Boolean).join(' ');
    return `<Placemark><name>${kmlEscape(name)}</name><description>${kmlEscape(description)}</description><styleUrl>${style}</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
  }

  function buildGeneralKmzKml(data) {
    const sedFolder = data.sedes.map((feature) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['SED_COD_SED'], 'SED'));
      return kmlPointPlacemark(`Subestacion ${code}`, '#sed', pointToLatLng(feature.geometry), `Subestacion\nCodigo: ${code}\nPotencia: ${getAttr(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], '')} kVA`);
    }).join('');
    const mtLineFolder = data.lineasMT.flatMap((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['TMT_COD_TMT', 'OBJECTID'], `MT${index + 1}`));
      return pathsToLatLngs(feature.geometry).map(path => kmlLinePlacemark(`LP MT ${code}`, '#mt', path, 'Linea MT Aereo'));
    }).join('');
    const mtNodeFolder = data.estructurasMT.map((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['NOD_COD_NOD', 'OBJECTID'], `LPMT${index + 1}`));
      return kmlPointPlacemark(`LP MT ${code}`, '#lp', pointToLatLng(feature.geometry), 'Estructura MT');
    }).join('');
    const btLineFolder = data.btData.flatMap(item => item.tramosBT.flatMap((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['TBT_COD_TBT', 'OBJECTID'], `BT${index + 1}`));
      return pathsToLatLngs(feature.geometry).map(path => kmlLinePlacemark(`RS BT ${item.sedCode} ${code}`, '#bt', path, 'Tramo BT Aereo'));
    })).join('');
    const btPoleFolder = data.btData.flatMap(item => item.postesBT.map((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['NOD_COD_NOD', 'OBJECTID'], `NBT${index + 1}`));
      return kmlPointPlacemark(`RS Poste ${code}`, '#poste', pointToLatLng(feature.geometry), `Poste BT\nSED: ${item.sedCode}`);
    })).join('');
    const supplyFolder = data.btData.flatMap(item => item.suministros.map((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['SUM_COD_SUM', 'OBJECTID'], `SUM${index + 1}`));
      return kmlPointPlacemark(`Suministro ${code}`, '#sum', pointToLatLng(feature.geometry), `Suministro\nSED: ${item.sedCode}`);
    })).join('');
    const retPatFolder = data.btData.flatMap(item => [
      ...item.retenidasBT.map((feature, index) => {
        const attrs = feature.attributes || {};
        const code = text(getAttr(attrs, ['RET_COD_RET', 'OBJECTID'], `RET${index + 1}`));
        return kmlPointPlacemark(`Retenida ${code}`, '#ret', pointToLatLng(feature.geometry), `Retenida\nSED: ${item.sedCode}`);
      }),
      ...item.puestasTierraBT.map((feature, index) => {
        const attrs = feature.attributes || {};
        const code = text(getAttr(attrs, ['PAT_COD_PAT', 'OBJECTID'], `PAT${index + 1}`));
        return kmlPointPlacemark(`Puesta a tierra ${code}`, '#pat', pointToLatLng(feature.geometry), `PAT\nSED: ${item.sedCode}`);
      })
    ]).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<name>RedCAD General ${kmlEscape(data.ubigeos.join('_'))}</name>
<Style id="sed"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/electronics.png</href></Icon></IconStyle></Style>
<Style id="lp"><IconStyle><scale>0.75</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="poste"><IconStyle><scale>0.65</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon></IconStyle></Style>
<Style id="sum"><IconStyle><scale>0.55</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/homegardenbusiness.png</href></Icon></IconStyle></Style>
<Style id="ret"><IconStyle><scale>0.55</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>
<Style id="pat"><IconStyle><scale>0.55</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon></IconStyle></Style>
<Style id="mt"><LineStyle><color>ff004ce6</color><width>3</width></LineStyle></Style>
<Style id="bt"><LineStyle><color>ffff9900</color><width>2</width></LineStyle></Style>
<Folder><name>Subestaciones</name>${sedFolder}</Folder>
<Folder><name>LP MT</name>${mtNodeFolder}${mtLineFolder}</Folder>
<Folder><name>RS BT</name>${btPoleFolder}${btLineFolder}</Folder>
<Folder><name>Suministros y acometidas</name>${supplyFolder}</Folder>
<Folder><name>Retenidas y puesta a tierra</name>${retPatFolder}</Folder>
</Document></kml>`;
  }

  async function downloadKmz(filename, kml) {
    const JSZip = await ensureJsZip();
    const zip = new JSZip();
    zip.file('doc.kml', kml);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(filename, blob);
  }

  function structureJsonFromRow(row) {
    return {
      id: row.id,
      padre: row.parentId,
      codigo: row.code || '',
      zona_banda: '19L',
      x: row.x,
      y: row.y,
      tipo_red: row.tipoRed,
      n_subestacion: row.sedNumber || '',
      nombre_subestacion: row.sedName || '',
      tipo_subestacion: row.sedType || '',
      armado_bt: row.armadoBT || '',
      soporte: row.soporte || '',
      cantidad_soportes: row.cantidadSoportes ?? 1,
      pat: row.pat || '',
      retenidas: row.retenidas || '',
      cimentacion: row.cimentacion || 'CM',
      terreno: row.terreno || 'I',
      accesibilidad: row.accesibilidad || 'TA',
      conductor: row.conductor || '',
      sistema_linea: row.sistema || '',
      comentario: row.comentario || ''
    };
  }

  function featurePoint(feature) {
    return projectLatLng(pointToLatLng(feature?.geometry));
  }

  function featurePaths(feature) {
    return pathsToLatLngs(feature?.geometry)
      .map(path => path.map(latlng => projectLatLng(latlng)).filter(Boolean))
      .filter(path => path.length > 1);
  }

  function buildGeneralRedcadPayload(data) {
    const defaults = defaultRedcadValues();
    const structures = [];
    const acometidas = [];
    const debugSegments = [];
    const globalNodes = [];
    let nextId = 1;

    const addDebug = (from, to, name) => {
      if (!from || !to || from.id === to.id) return;
      debugSegments.push({
        from: from.id,
        to: to.id,
        length: distance(from.point, to.point),
        tramo: name,
        warning: '',
        coordinates: [[from.point.lon, from.point.lat], [to.point.lon, to.point.lat]]
      });
    };
    const addNode = ({ point, parentId = 0, tipoRed = 'RS', code = '', sedNumber = '', sedName = '', sedType = '', armadoBT = '', soporte = '', conductor = '', sistema = '', pat = '', retenidas = '', comentario = '' }) => {
      const row = rowBase({
        id: nextId++,
        parentId,
        point,
        tipoRed,
        code: cleanCode(code, ''),
        comentario
      });
      row.sedNumber = sedNumber;
      row.sedName = sedName;
      row.sedType = sedType;
      row.armadoBT = armadoBT;
      row.soporte = soporte;
      row.conductor = conductor;
      row.sistema = sistema;
      row.pat = pat;
      row.retenidas = retenidas;
      row.cantidadSoportes = 1;
      structures.push(row);
      const node = { id: row.id, point, row, code: row.code || '' };
      globalNodes.push(node);
      return node;
    };
    const findNode = (point, nodes = globalNodes, tol = DUPLICATE_TOLERANCE_M) => nearest(point, nodes, tol);
    const sedNodes = new Map();

    data.lineasMT.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const code = text(getAttr(attrs, ['TMT_COD_TMT', 'OBJECTID'], `MT${index + 1}`));
      featurePaths(feature).forEach(path => {
        let prev = findNode(path[0], globalNodes, 1) || addNode({
          point: path[0],
          parentId: 0,
          tipoRed: 'LP',
          code,
          soporte: '12/200',
          comentario: 'LP MT generado por ubigeo'
        });
        for (let i = 1; i < path.length; i += 1) {
          let node = findNode(path[i], globalNodes, 1);
          if (!node) {
            node = addNode({
              point: path[i],
              parentId: prev.id,
              tipoRed: 'LP',
              code: `${code}_${i}`,
              soporte: '12/200',
              comentario: 'LP MT generado por ubigeo'
            });
            addDebug(prev, node, `MT ${code}`);
          }
          prev = node;
        }
      });
    });

    data.btData.forEach(item => {
      const sedAttrs = item.sedFeature.attributes || {};
      const sedCode = item.sedCode;
      const sedPoint = featurePoint(item.sedFeature);
      if (!sedPoint) return;
      const sedType = redcadSubstationTextFromAttrs(sedAttrs) || defaults.estructura['Tipo Subestación'];
      const sedNode = addNode({
        point: sedPoint,
        parentId: 0,
        tipoRed: 'RP',
        code: sedCode,
        sedNumber: 1,
        sedName: sedCode,
        sedType,
        soporte: defaults.estructura['Soporte SED'],
        comentario: `Subestacion ${sedCode}`
      });
      sedNodes.set(sedCode, sedNode);

      const localNodes = [];
      const nodeByCode = new Map();
      const retByPole = new Map();
      const patByPole = new Map();
      item.retenidasBT.forEach(feature => {
        const attrs = feature.attributes || {};
        const pole = cleanCode(getAttr(attrs, ['RET_COD_NOD', 'RET_COD_POSTE'], ''), '');
        if (pole) retByPole.set(pole, [retByPole.get(pole), getAttr(attrs, ['RET_COD_RET', 'OBJECTID'], 'RET')].filter(Boolean).join(','));
      });
      item.puestasTierraBT.forEach(feature => {
        const attrs = feature.attributes || {};
        const pole = cleanCode(getAttr(attrs, ['PAT_COD_NOD', 'PAT_COD_POSTE'], ''), '');
        if (pole) patByPole.set(pole, [patByPole.get(pole), getAttr(attrs, ['PAT_COD_PAT', 'OBJECTID'], 'PAT')].filter(Boolean).join(','));
      });
      const poles = item.postesBT.map((feature, index) => {
        const attrs = feature.attributes || {};
        return {
          point: featurePoint(feature),
          code: cleanCode(getAttr(attrs, ['NOD_COD_NOD', 'OBJECTID'], `NBT${index + 1}`), `NBT${index + 1}`),
          attrs
        };
      }).filter(pole => pole.point);
      const snapPole = point => {
        if (distance(point, sedPoint) <= START_CONNECTION_TOLERANCE_M) return { point: sedPoint, sed: true };
        const pole = nearest(point, poles, POLE_SNAP_TOLERANCE_M);
        return pole ? { point: pole.point, code: pole.code, attrs: pole.attrs } : { point, code: '', attrs: {} };
      };
      const getLocalNode = snap => {
        if (snap.sed) return sedNode;
        const code = cleanCode(snap.code || '', '');
        if (code && nodeByCode.has(code)) return nodeByCode.get(code);
        return findNode(snap.point, localNodes, DUPLICATE_TOLERANCE_M);
      };
      const makeLocalNode = (snap, parent) => {
        const existing = getLocalNode(snap);
        if (existing) return existing;
        const code = cleanCode(snap.code || '', '');
        const node = addNode({
          point: snap.point,
          parentId: parent?.id || 0,
          tipoRed: 'RS',
          code,
          armadoBT: parent?.id === sedNode.id ? (defaults.estructura['Armado SED'] || 'E3') : (defaults.estructura['Armado BT simple'] || 'E1'),
          soporte: supportFrom(snap.attrs || {}, defaults.estructura['Soporte BT']),
          conductor: defaults.estructura['Conductor BT'],
          sistema: defaults.estructura.Sistema,
          pat: code ? patByPole.get(code) || '' : '',
          retenidas: code ? retByPole.get(code) || '' : '',
          comentario: 'RS BT generado por ubigeo'
        });
        localNodes.push(node);
        if (code) nodeByCode.set(code, node);
        if (parent) addDebug(parent, node, `BT ${sedCode}`);
        return node;
      };

      item.tramosBT.forEach(feature => {
        featurePaths(feature).forEach(path => {
          let prev = null;
          path.map(snapPole).forEach((snap, vertexIndex) => {
            if (vertexIndex === 0) {
              prev = getLocalNode(snap) || (snap.sed ? sedNode : makeLocalNode(snap, null));
              return;
            }
            const node = makeLocalNode(snap, prev);
            if (!Number(node.row.parentId || 0) && prev && prev.id !== node.id) {
              node.row.parentId = prev.id;
              addDebug(prev, node, `BT ${sedCode}`);
            }
            prev = node;
          });
        });
      });
      if (localNodes.length && !localNodes.some(node => Number(node.row.parentId || 0) === sedNode.id)) {
        const first = nearest(sedPoint, localNodes, FIRST_BT_TO_SED_MAX_DISTANCE_M);
        if (first) {
          first.row.parentId = sedNode.id;
          first.row.comentario = 'Primer poste BT real';
          addDebug(sedNode, first, `Subestacion ${sedCode} -> primer poste BT`);
        }
      }

      const countsByPole = new Map();
      item.suministros.forEach((feature, index) => {
        const point = featurePoint(feature);
        if (!point) return;
        const parent = nearest(point, localNodes, Number.POSITIVE_INFINITY) || sedNode;
        const count = (countsByPole.get(parent.id) || 0) + 1;
        countsByPole.set(parent.id, count);
        const attrs = feature.attributes || {};
        acometidas.push({
          id_estructura: parent.id,
          n_acometida: count,
          x: point.x,
          y: point.y,
          tipo: defaults.acometida.Tipo,
          longitud_real: round(distance(parent.point, point), 3),
          longitud_sobreescrita: '',
          accesorio: defaults.acometida['Accesorio de Acometida'],
          carga: defaults.acometida.Carga,
          nombre: text(getAttr(attrs, ['SUM_NOM_SUM', 'SUM_DIR_SUM', 'SUM_COD_SUM'], `Suministro ${index + 1}`)),
          potencia: defaults.acometida['Potencia (kW)'],
          factor_simultaneidad: defaults.acometida['Factor de simultaneidad']
        });
      });
    });

    return {
      sed: `GENERAL_${data.ubigeos.join('_')}`,
      zona_banda: '19L',
      estructuras: structures.map(structureJsonFromRow),
      acometidas,
      debug_geojson: {
        type: 'FeatureCollection',
        features: debugSegments.map(segment => ({
          type: 'Feature',
          properties: {
            from: segment.from,
            to: segment.to,
            length_m: round(segment.length, 3),
            tramo: segment.tramo,
            warning: segment.length > LONG_BT_SEGMENT_WARNING_M ? 'SEGMENTO_LARGO' : ''
          },
          geometry: { type: 'LineString', coordinates: segment.coordinates }
        }))
      }
    };
  }

  function redcadSubstationTextFromAttrs(attrs) {
    const power = text(getAttr(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], ''));
    const voltage = text(getAttr(attrs, ['SED_TEN_NOM_PRI', 'SED_TEN_PRI'], '22,9')).replace('.', ',');
    return power ? `${power.replace('.', ',')}kVA-2ø-${voltage}kV` : '';
  }

  function selectedRedcadFile() {
    return document.getElementById('redcadKmlInput')?.files?.[0] || null;
  }

  async function descargarKmzRedcadFuente() {
    if (typeof window.generarReporteKMZ !== 'function') {
      notify('El generador KMZ no está disponible en esta carga de la página.', 'error', 7000);
      return false;
    }

    const code = selectedSedCode();
    if (!code) {
      notify('Seleccione o ingrese primero el código de la subestación para descargar el KMZ.', 'error', 7000);
      return false;
    }

    notify('Se descargará el KMZ de la subestación. Luego selecciónelo en KMZ/KML RedCAD y genere el XLS.', 'info', 9000);
    return window.generarReporteKMZ(code);
  }

  function injectRedcadKmlInput() {
    const actions = document.querySelector('#solutionsExportView .solutions-actions');
    if (!actions || document.getElementById('redcadKmlInput')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'redcad-upload-box';
    wrapper.innerHTML = `
      <button type="button" class="redcad-kmz-source-btn" onclick="descargarKmzRedcadFuente()">
        <i class="fas fa-globe-americas"></i> Descargar KMZ de la subestación
      </button>
      <label for="redcadKmlInput">KMZ/KML RedCAD</label>
      <input id="redcadKmlInput" type="file" accept=".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml">
    `;
    actions.insertBefore(wrapper, actions.firstChild);
    const excelButton = Array.from(actions.querySelectorAll('button'))
      .find(button => /generarRedcadExcel/.test(button.getAttribute('onclick') || ''));
    if (excelButton) {
      excelButton.innerHTML = '<i class="fas fa-file-excel"></i> Generar XLS RedCAD';
      excelButton.title = 'Genera el XLS final usando el generador local con Excel COM';
    }
    if (!document.getElementById('redcadJsonButton')) {
      const jsonButton = document.createElement('button');
      jsonButton.id = 'redcadJsonButton';
      jsonButton.type = 'button';
      jsonButton.className = 'solutions-secondary redcad-json-btn';
      jsonButton.onclick = descargarRedcadJsonIntermedio;
      jsonButton.innerHTML = '<i class="fas fa-file-code"></i> Descargar JSON intermedio';
      actions.insertBefore(jsonButton, excelButton || actions.children[1] || null);
    }
    if (!document.getElementById('redcadGeneralKmzButton')) {
      const generalKmzButton = document.createElement('button');
      generalKmzButton.id = 'redcadGeneralKmzButton';
      generalKmzButton.type = 'button';
      generalKmzButton.className = 'solutions-secondary redcad-general-btn';
      generalKmzButton.onclick = descargarRedcadGeneralKmz;
      generalKmzButton.innerHTML = '<i class="fas fa-map-marked-alt"></i> KMZ general por BIGEO';
      actions.appendChild(generalKmzButton);
    }
    if (!document.getElementById('redcadGeneralXlsButton')) {
      const generalXlsButton = document.createElement('button');
      generalXlsButton.id = 'redcadGeneralXlsButton';
      generalXlsButton.type = 'button';
      generalXlsButton.className = 'solutions-secondary redcad-general-xls-btn';
      generalXlsButton.onclick = generarRedcadGeneralXls;
      generalXlsButton.innerHTML = '<i class="fas fa-file-excel"></i> XLS RedCAD general BIGEO';
      actions.appendChild(generalXlsButton);
    }

    if (!document.querySelector('style[data-redcad-upload-style="true"]')) {
      const style = document.createElement('style');
      style.setAttribute('data-redcad-upload-style', 'true');
      style.textContent = `
        .redcad-upload-box {
          display: grid;
          gap: 6px;
          padding: 10px;
          border: 1px solid #bfd6ea;
          border-radius: 6px;
          background: #f8fbff;
        }
        .redcad-upload-box label {
          font-weight: 700;
          font-size: 13px;
          color: #0f3b5f;
        }
        .redcad-upload-box input {
          width: 100%;
          box-sizing: border-box;
          border-radius: 6px;
          background: #fff;
        }
        .redcad-kmz-source-btn {
          width: 100%;
          border-radius: 6px;
          text-transform: none;
          letter-spacing: 0;
          background: linear-gradient(135deg, #0f766e 0%, #1693a5 100%);
        }
        .redcad-json-btn {
          background: linear-gradient(135deg, #334155 0%, #0f766e 100%);
        }
        .redcad-general-btn {
          background: linear-gradient(135deg, #047857 0%, #0891b2 100%);
        }
        .redcad-general-xls-btn {
          background: linear-gradient(135deg, #1d4ed8 0%, #0f3b5f 100%);
        }
      `;
      document.head.appendChild(style);
    }
  }

  async function prepararRedcadGeneralData() {
    const ubigeos = selectedUbigeos();
    const data = await loadGeneralRedcadByUbigeo(ubigeos);
    return { data, payload: buildGeneralRedcadPayload(data) };
  }

  async function descargarRedcadGeneralKmz() {
    showLoading('Preparando KMZ general por BIGEO...');
    try {
      const ubigeos = selectedUbigeos();
      const data = await loadGeneralRedcadByUbigeo(ubigeos);
      const kml = buildGeneralKmzKml(data);
      await downloadKmz(`redcad_general_${cleanCode(ubigeos.join('_'), 'BIGEO')}.kmz`, kml);
      notify(`KMZ general generado: ${data.sedes.length} subestaciones, ${data.lineasMT.length} lineas MT.`, 'success', 10000);
      return true;
    } catch (error) {
      console.error('Error al generar KMZ general RedCAD:', error);
      notify(`Error al generar KMZ general: ${error.message}`, 'error', 12000);
      return false;
    } finally {
      hideLoading();
    }
  }

  async function generarRedcadGeneralXls() {
    showLoading('Generando XLS RedCAD general por BIGEO...');
    try {
      const { payload } = await prepararRedcadGeneralData();
      const response = await fetch('http://127.0.0.1:8765/redcad/generar-xls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        let message = `Error HTTP ${response.status}`;
        try {
          const body = await response.json();
          message = body.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      const blob = await response.blob();
      downloadBlob(`redcad_general_${cleanCode(payload.sed, 'BIGEO')}.xls`, blob);
      notify(`XLS RedCAD general generado: ${payload.estructuras.length} estructuras y ${payload.acometidas.length} acometidas.`, 'success', 12000);
      return true;
    } catch (error) {
      console.error('Error al generar XLS RedCAD general:', error);
      if (/Failed to fetch|NetworkError|fetch/i.test(error.message)) {
        notify('No se pudo contactar el generador local. Ejecute tools/iniciar_servidor_redcad.bat y vuelva a presionar XLS RedCAD general BIGEO.', 'error', 12000);
      } else {
        notify(`Error al generar XLS RedCAD general: ${error.message}`, 'error', 12000);
      }
      return false;
    } finally {
      hideLoading();
    }
  }

  async function descargarRedcadJsonIntermedio() {
    showLoading('Preparando JSON intermedio RedCAD...');
    try {
      const payload = await prepararRedcadDataDesdeArchivo();
      downloadJson(`redcad_data_${cleanCode(payload.sed, 'SED')}.json`, payload);
      notify('JSON intermedio generado. No es el archivo final de RedCAD; úselo con el generador local Excel COM.', 'success', 10000);
      return true;
    } catch (error) {
      console.error('Error al preparar JSON RedCAD:', error);
      notify(`Error al preparar JSON RedCAD: ${error.message}`, 'error', 9000);
      return false;
    } finally {
      hideLoading();
    }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function generarRedcadExcelDesdePlantilla() {
    try {
      selectedRedcadFile();
    } catch (_) {
      injectRedcadKmlInput();
    }

    showLoading('Generando XLS RedCAD con generador local...');
    try {
      const payload = await prepararRedcadDataDesdeArchivo();
      const response = await fetch('http://127.0.0.1:8765/redcad/generar-xls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = `Error HTTP ${response.status}`;
        try {
          const body = await response.json();
          message = body.error || message;
        } catch (_) {}
        throw new Error(message);
      }

      const blob = await response.blob();
      downloadBlob(`redcad_export_${cleanCode(payload.sed, 'SED')}.xls`, blob);
      notify('XLS RedCAD generado con Excel COM. Ese es el archivo final para importar en RedCAD.', 'success', 10000);
      return true;
    } catch (error) {
      console.error('Error al generar XLS RedCAD:', error);
      if (/Failed to fetch|NetworkError|fetch/i.test(error.message)) {
        notify('No se pudo contactar el generador local. Ejecute tools/iniciar_servidor_redcad.bat y vuelva a presionar Generar XLS RedCAD. También puede descargar el JSON intermedio.', 'error', 12000);
      } else {
        notify(`Error al generar XLS RedCAD: ${error.message}`, 'error', 10000);
      }
      return false;
    } finally {
      hideLoading();
    }
  }

  const abrirVistaSolutionsOriginal = window.abrirVistaExportSolutions;
  if (typeof abrirVistaSolutionsOriginal === 'function') {
    window.abrirVistaExportSolutions = function (...args) {
      const result = abrirVistaSolutionsOriginal.apply(this, args);
      setTimeout(injectRedcadKmlInput, 0);
      return result;
    };
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(injectRedcadKmlInput, 0));
  setTimeout(injectRedcadKmlInput, 0);

  window.generarRedcadExcel = generarRedcadExcelDesdePlantilla;
  window.generarRedcadExcelDesdePlantilla = generarRedcadExcelDesdePlantilla;
  window.descargarRedcadJsonIntermedio = descargarRedcadJsonIntermedio;
  window.descargarKmzRedcadFuente = descargarKmzRedcadFuente;
  window.descargarRedcadGeneralKmz = descargarRedcadGeneralKmz;
  window.generarRedcadGeneralXls = generarRedcadGeneralXls;
})();
