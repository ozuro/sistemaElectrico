(function () {
  const g = (name, fallback) => (typeof window[name] === 'function' ? window[name] : fallback);

  const showNotification = g('showNotification', (message) => console.log(message));
  const showLoadingMessage = g('showLoadingMessage', () => {});
  const hideLoadingMessage = g('hideLoadingMessage', () => {});
  const arcgisQueryUrl = g('arcgisQueryUrl', (layerId) => `https://gis.electropuno.com.pe/arcgis_server/rest/services/RedElectroPuno/MapServer/${layerId}/query`);
  const whereEquals = g('whereEquals', (field, value) => `${field} = '${String(value ?? '').replace(/'/g, "''")}'`);
  const descargarExcelXml = g('descargarExcelXml', null);
  const generarReporteDXF = g('generarReporteDXF', null);
  const consultarArcgisReporte = g('consultarArcgisReporte', null);

  const getValue = g('getValue', function (attrs, fields, fallback = 'N/A') {
    for (const field of fields || []) {
      const value = attrs?.[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  });

  const pointToLatLng = g('pointToLatLng', function (geom) {
    const lat = Number(geom?.y);
    const lon = Number(geom?.x);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  });

  const pathsToLatLngs = g('pathsToLatLngs', function (geom) {
    if (!geom?.paths) return [];
    return geom.paths
      .map((path) => path
        .map((coord) => [Number(coord[1]), Number(coord[0])])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)))
      .filter((path) => path.length > 1);
  });

  const redondear = g('redondear', function (value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) || 0) * factor) / factor;
  });

  const distanciaMetros = g('distanciaMetros', function (a, b) {
    if (!a || !b) return 0;
    const lat1 = Number(a[0]);
    const lon1 = Number(a[1]);
    const lat2 = Number(b[0]);
    const lon2 = Number(b[1]);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const x =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  });

  const getTipoRed = g('getTipoRed', function (codigo) {
    const tipos = { A: 'Aereo', S: 'Subterraneo', C: 'Subacuatico' };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getMaterialConductor = g('getMaterialConductor', function (codigo) {
    const materiales = { AL: 'Aluminio', CU: 'Cobre' };
    return materiales[codigo] || codigo || 'N/A';
  });

  const getTipoServicio = g('getTipoServicio', function (codigo) {
    const tipos = {
      AP: 'Alumbrado Publico',
      SP: 'Servicio Particular',
      'SP+AP': 'Servicio Particular + Alumbrado Publico'
    };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getEstadoConservacion = g('getEstadoConservacion', function (codigo) {
    const estados = { B: 'Bueno', M: 'Malo', 1: 'Regular 1', 2: 'Regular 2' };
    return estados[codigo] || codigo || 'N/A';
  });

  const getFuncionEstructura = g('getFuncionEstructura', function (codigo) {
    const funciones = { ALI: 'Alineamiento', CAD: 'Cambio de Direccion', FDL: 'Fin e Inicio de Linea' };
    return funciones[codigo] || codigo || 'N/A';
  });

  const getTipoSoporte = g('getTipoSoporte', function (codigo) {
    const tipos = { BIP: 'Biposte', EST: 'Estructura', MON: 'Monoposte', NIN: 'Ninguno' };
    return tipos[codigo] || codigo || 'N/A';
  });

  const getMaterialSoporte = g('getMaterialSoporte', function (codigo) {
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

  const cantidadSoportesPoste = g('cantidadSoportesPoste', function (attrs = {}) {
    return [1, 2, 3, 4].reduce((total, numero) => {
      const sufijo = String(numero).padStart(2, '0');
      const cantidad = Number(getValue(attrs, [`NOD_CNT_TIP_ARM_${sufijo}`], 0)) || 0;
      return total + cantidad;
    }, 0) || Number(getValue(attrs, ['NOD_CNT_SPT'], 0)) || 0;
  });

  const describirArmadosPoste = g('describirArmadosPoste', function (attrs = {}) {
    const parts = [];
    [1, 2, 3, 4].forEach((numero) => {
      const sufijo = String(numero).padStart(2, '0');
      const codigo = getValue(attrs, [`NOD_COD_TIP_ARM_${sufijo}`], '');
      const descripcion = getValue(attrs, [`NOD_DSC_TIP_ARM_${sufijo}`], '');
      const cantidad = getValue(attrs, [`NOD_CNT_TIP_ARM_${sufijo}`], '');
      if (codigo && codigo !== 'N/A') parts.push(`${codigo}${descripcion && descripcion !== 'N/A' ? ` ${descripcion}` : ''}${cantidad ? ` (${cantidad})` : ''}`);
    });
    return parts.join(' | ') || 'N/A';
  });

  function sqlValue(value) {
    return String(value ?? '').trim().replace(/'/g, "''");
  }

  function getSelectedCode() {
    return String(
      window.transformadorSeleccionado ||
      document.getElementById('inputID')?.value ||
      ''
    ).trim();
  }

  function setSelectedCode(code) {
    const clean = String(code || '').trim();
    if (!clean) return '';
    window.transformadorSeleccionado = clean;
    const input = document.getElementById('inputID');
    if (input) input.value = clean;
    return clean;
  }

  function getUtmZoneFromLon(lon) {
    return Math.floor((lon + 180) / 6) + 1;
  }

  function wgs84ToUtm(lat, lon, zoneOverride) {
    const zone = zoneOverride || getUtmZoneFromLon(lon);
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

    const easting = k0 * n * (
      aa +
      (1 - t + c) * aa ** 3 / 6 +
      (5 - 18 * t + t ** 2 + 72 * c - 58 * eccPrimeSquared) * aa ** 5 / 120
    ) + 500000.0;

    let northing = k0 * (
      m +
      n * Math.tan(latRad) * (
        aa ** 2 / 2 +
        (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 +
        (61 - 58 * t + t ** 2 + 600 * c - 330 * eccPrimeSquared) * aa ** 6 / 720
      )
    );

    if (lat < 0) northing += 10000000.0;
    return { easting, northing, zone, hemisphere: lat < 0 ? 'S' : 'N' };
  }

  function coordData(latlng, zoneOverride) {
    if (!latlng) return { lat: '', lon: '', easting: '', northing: '', zone: '' };
    const [lat, lon] = latlng;
    const utm = wgs84ToUtm(lat, lon, zoneOverride);
    return {
      lat: redondear(lat, 7),
      lon: redondear(lon, 7),
      easting: redondear(utm.easting, 3),
      northing: redondear(utm.northing, 3),
      zone: `${utm.zone}${utm.hemisphere}`
    };
  }

  function coordDataFromGeometry(geometry, zoneOverride) {
    return coordData(pointToLatLng(geometry), zoneOverride);
  }

  function firstLatLngFromFeatureList(features) {
    for (const feature of features || []) {
      const point = pointToLatLng(feature?.geometry);
      if (point) return point;
      const pathPoint = pathsToLatLngs(feature?.geometry)?.[0]?.[0];
      if (pathPoint) return pathPoint;
    }
    return null;
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadText(filename, text, type = 'text/plain;charset=utf-8;') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function downloadExcel(filename, workbook) {
    if (typeof descargarExcelXml === 'function') {
      descargarExcelXml(workbook, filename);
      return;
    }

    const worksheets = workbook.map((sheet) => {
      const safeName = String(sheet.name || 'Hoja').replace(/[\\/?*:[\]]/g, '_').substring(0, 31) || 'Hoja';
      const rows = (sheet.rows || []).map((row, index) => {
        const values = Array.isArray(row) ? row : [row];
        const style = index === 0 ? (String(values[0] || '').startsWith('REPORTE') ? 'Title' : 'Header') : '';
        const cells = values.map((value) => {
          const isNumber = typeof value === 'number' && Number.isFinite(value);
          const type = isNumber ? 'Number' : 'String';
          const safeValue = isNumber ? String(value) : escapeXml(value ?? '');
          const styleAttr = style ? ` ss:StyleID="${style}"` : '';
          return `<Cell${styleAttr}><Data ss:Type="${type}">${safeValue}</Data></Cell>`;
        }).join('');
        return `<Row>${cells}</Row>`;
      }).join('');
      return `<Worksheet ss:Name="${escapeXml(safeName)}"><Table>${rows}</Table></Worksheet>`;
    }).join('');

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Title"><Font ss:Color="#FFFFFF" ss:Bold="1" ss:Size="14"/><Interior ss:Color="#1F4E78" ss:Pattern="Solid"/></Style>
 </Styles>
 ${worksheets}
</Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (window.XLSX) resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureXlsxLibrary() {
    if (window.XLSX) return window.XLSX;
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    if (!window.XLSX) throw new Error('No se cargo la libreria XLSX para escribir Excel 97-2003.');
    return window.XLSX;
  }

  async function downloadRedcadBinaryExcel(filename, workbook) {
    const XLSX = await ensureXlsxLibrary();
    const book = XLSX.utils.book_new();
    workbook.forEach((sheet) => {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows || []);
      XLSX.utils.book_append_sheet(book, ws, String(sheet.name || 'Hoja').substring(0, 31));
    });
    const output = XLSX.write(book, { bookType: 'biff8', type: 'array' });
    const blob = new Blob([output], { type: 'application/vnd.ms-excel' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function queryFeatures(layerId, where, returnGeometry = true) {
    if (typeof consultarArcgisReporte === 'function') {
      return consultarArcgisReporte(layerId, where, returnGeometry);
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
        outSR: 4326,
        resultRecordCount: String(pageSize),
        resultOffset: String(offset)
      });
      const res = await fetch(`${arcgisQueryUrl(layerId)}?${params}`);
      if (!res.ok) throw new Error(`Error HTTP ${res.status} consultando capa ${layerId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || `Error consultando capa ${layerId}`);
      const batch = data.features || [];
      features.push(...batch);
      keepFetching = data.exceededTransferLimit === true && batch.length > 0;
      offset += batch.length;
      guard += 1;
    }

    return features;
  }

  async function fetchSolutionsData(code) {
    const selected = String(code || '').trim();
    const [subestaciones, suministros, circuitosBT, postesBT, tramosBT] = await Promise.all([
      queryFeatures(96, whereEquals('SED_COD_SED', selected), true),
      queryFeatures(24, whereEquals('SUM_COD_SED', selected), true),
      queryFeatures(25, whereEquals('SAL_COD_SED', selected), true),
      queryFeatures(27, whereEquals('NOD_COD_SED', selected), true),
      queryFeatures(33, whereEquals('TBT_COD_SED', selected), true)
    ]);

    const sed = subestaciones[0] || null;
    const ubigeo = getValue(sed?.attributes || {}, ['SED_COD_UBI'], '');
    const [lineasMT, estructurasMT] = ubigeo ? await Promise.all([
      queryFeatures(101, whereEquals('TMT_COD_UBI', ubigeo), true),
      queryFeatures(91, whereEquals('NOD_COD_UBI', ubigeo), true)
    ]) : [[], []];

    return {
      code: selected,
      sed,
      ubigeo,
      suministros,
      circuitosBT,
      postesBT,
      tramosBT,
      lineasMT,
      estructurasMT
    };
  }

  function buildTopomagicKml(data) {
    const code = data.code || 'SED';
    const sedAttrs = data.sed?.attributes || {};
    const sedPoint = pointToLatLng(data.sed?.geometry);
    const placemarks = [];

    if (sedPoint) {
      placemarks.push(`
      <Placemark>
        <name>${escapeXml(getValue(sedAttrs, ['SED_NOM_SED', 'SED_COD_SED'], code))}</name>
        <description>${escapeXml(`Subestacion ${code}`)}</description>
        <Style><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/electric.png</href></Icon></IconStyle></Style>
        <Point><coordinates>${sedPoint[1]},${sedPoint[0]},0</coordinates></Point>
      </Placemark>`);
    }

    data.lineasMT.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const paths = pathsToLatLngs(feature.geometry);
      const name = `LP_${getValue(attrs, ['TMT_COD_TMT', 'TMT_NOM_CIR', 'OBJECTID'], `MT-${index + 1}`)}`;
      paths.forEach((path) => {
        const coords = path.map(([lat, lon]) => `${lon},${lat},0`).join(' ');
        if (!coords) return;
        placemarks.push(`
      <Placemark>
        <name>${escapeXml(name)}</name>
        <description>${escapeXml(`Linea MT ${getTipoRed(getValue(attrs, ['TMT_COD_TIP_RED'], 'N/A'))}`)}</description>
        <Style><LineStyle><color>ff0055ff</color><width>2.6</width></LineStyle></Style>
        <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString>
      </Placemark>`);
      });
    });

    data.suministros.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const point = pointToLatLng(feature.geometry);
      if (!point) return;
      placemarks.push(`
      <Placemark>
        <name>${escapeXml(getValue(attrs, ['SUM_NOM_SUM', 'SUM_COD_SUM'], `SUM-${index + 1}`))}</name>
        <description>${escapeXml(`Suministro ${getValue(attrs, ['SUM_COD_SUM'], '')}`)}</description>
        <Style><IconStyle><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/homegardenbusiness.png</href></Icon></IconStyle></Style>
        <Point><coordinates>${point[1]},${point[0]},0</coordinates></Point>
      </Placemark>`);
    });

    data.tramosBT.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const paths = pathsToLatLngs(feature.geometry);
      const name = getValue(attrs, ['TBT_COD_TBT', 'OBJECTID'], `BT-${index + 1}`);
      paths.forEach((path) => {
        const coords = path.map(([lat, lon]) => `${lon},${lat},0`).join(' ');
        if (!coords) return;
        placemarks.push(`
      <Placemark>
        <name>${escapeXml(name)}</name>
        <description>${escapeXml(`Tramo BT ${getTipoRed(getValue(attrs, ['TBT_COD_TIP_RED'], 'N/A'))}`)}</description>
        <Style><LineStyle><color>ffff00ff</color><width>2.4</width></LineStyle></Style>
        <LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString>
      </Placemark>`);
      });
    });

    if (!placemarks.length) {
      throw new Error('No se encontraron elementos con geometria para generar el KML.');
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(`Topomagic SED ${code}`)}</name>
    <description>${escapeXml('Topografia para importar en Topomagic.')}</description>
    <Folder>
      <name>${escapeXml('Topografia')}</name>${placemarks.join('')}
    </Folder>
  </Document>
</kml>`;
  }

  function buildTopomagicCsv(data) {
    const rows = [
      ['Nombre Ruta', 'Acumulada', 'Altitud', 'Angulo', 'Vertice', 'Comentario', 'Zona', 'Banda', 'Este', 'Norte']
    ];

    data.lineasMT.forEach((feature, featureIndex) => {
      const attrs = feature.attributes || {};
      const paths = pathsToLatLngs(feature.geometry);
      const routeCode = getValue(attrs, ['TMT_COD_TMT', 'OBJECTID'], `MT-${featureIndex + 1}`);
      const routeName = `LP_${routeCode}`;
      paths.forEach((path) => {
        let acumulada = 0;
        path.forEach((latlng, i) => {
          const prev = path[i - 1];
          if (prev) acumulada += distanciaMetros(prev, latlng);
          const utm = wgs84ToUtm(latlng[0], latlng[1]);
          rows.push([
            i === 0 ? routeName : '',
            redondear(acumulada, 3),
            0,
            0,
            `V${i + 1}`,
            routeCode,
            utm.zone,
            utm.hemisphere,
            redondear(utm.easting, 3),
            redondear(utm.northing, 3)
          ]);
        });
      });
    });

    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function buildRedcadWorkbook(data) {
    const model = buildRedcadImportModel(data);
    return [
      { name: 'Estructuras', rows: model.estructuras },
      { name: 'Acometidas', rows: model.acometidas }
    ];
  }

  function buildRedcadReferenceWorkbook(data) {
    const model = buildRedcadImportModel(data);
    return [{ name: 'Referencia', rows: model.referencia }];
  }

  const REDCAD_STRUCT_HEADER = [
    'ID Estructura', 'ID Estructura Padre', 'Código de Estructura', 'Zona-Banda', 'X', 'Y', 'Tipo Red',
    'N° Subestacion', 'Nombre\nSubestación', 'Tipo\nSubestación', 'Armado Primario MT', 'Armado Secundario MT',
    'Armado Primario BT', 'Armado Secundario BT', 'Soporte', 'Cantidad de soportes', 'PAT', 'Retenidas',
    'CajasDerivacion', 'PuntoIluminación+\nSoporteLuminaria', 'Protecciones', 'Cimentación', 'Terreno',
    'Accesibilidad', 'Conductor', 'Tipo de sistema de linea', '¿Es vano flojo?', 'Comentario'
  ];

  const REDCAD_DROP_HEADER = [
    'ID Estructura', 'N° Acometida', 'X', 'Y', 'Tipo', 'Longitud real', 'Longitud sobreescrita',
    'Accesorio de Acometida', 'Carga', 'Nombre', 'Potencia (kW)', 'Factor de simultaneidad'
  ];

  const REDCAD_LOCAL_OFFSET_X = 3000;
  const REDCAD_LOCAL_OFFSET_Y = 3000;

  function buildRedcadImportModel(data) {
    const zone = getRedcadZone(data);
    const context = createRedcadContext(data, zone);
    const sedAttrs = data.sed?.attributes || {};
    const sedCode = cleanRedcadId(data.code || getValue(sedAttrs, ['SED_COD_SED'], 'SED000000001'));
    const sedName = redcadText(getValue(sedAttrs, ['SED_NOM_SED', 'SED_NOM_SUB', 'SED_DES_SED'], sedCode));
    const sedPower = numericValue(getValue(sedAttrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 0));
    const sedVoltage = redcadText(getValue(sedAttrs, ['SED_TEN_NOM_PRI', 'SED_TEN_PRI'], ''));
    const rows = [['RCE', 0.34], REDCAD_STRUCT_HEADER];
    const nodes = [];
    let nextId = 1;
    const reference = [['Fila REDCAD', 'Hoja', 'ID REDCAD', 'Tipo', 'Codigo GIS', 'Nombre/Detalle', 'X UTM', 'Y UTM']];

    const addReference = (sheetName, rowNumber, id, type, gisCode, detail, point) => {
      reference.push([rowNumber, sheetName, id || '', type || '', gisCode || '', detail || '', point?.utmX ?? point?.x ?? '', point?.utmY ?? point?.y ?? '']);
    };

    const addStructure = (rowData, nodeData = null, refData = {}) => {
      rows.push(redcadStructRow(rowData));
      if (nodeData) nodes.push(nodeData);
      addReference('Estructuras', rows.length, rowData.id, refData.type, refData.gisCode || rowData.code, refData.detail || rowData.comentario, nodeData?.point);
    };

    const sedPoint = redcadPointFromGeometry(data.sed?.geometry, context);
    let sedNumericId = 1;
    if (sedPoint) {
      const id = nextId++;
      sedNumericId = id;
      addStructure({
        id, parentId: 0, code: '', zoneBand: sedPoint.zoneBand, x: sedPoint.x, y: sedPoint.y, tipoRed: 'RP',
        sedNumber: 1, sedName: '', sedType: redcadSubstationType(sedPower, sedVoltage),
        armadoBT: redcadArms(sedAttrs), soporte: redcadSupport(sedAttrs) || '12/300',
        cantidadSoportes: cantidadSoportesPoste(sedAttrs) || 1, cimentacion: redcadFoundation(sedAttrs), comentario: ''
      }, { id, point: sedPoint }, { type: 'Subestacion', gisCode: sedCode, detail: sedName });
    }

    data.circuitosBT.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const point = redcadPointFromGeometry(feature.geometry, context) || sedPoint;
      if (!point) return;
      const id = nextId++;
      const gisCode = redcadText(getValue(attrs, ['SAL_COD_SAL', 'SAL_COD_CBT', 'CBT_COD_CBT', 'OBJECTID'], `CBT${String(index + 1).padStart(9, '0')}`));
      addStructure({
        id, parentId: sedNumericId, code: '', zoneBand: point.zoneBand, x: point.x, y: point.y, tipoRed: 'RP',
        sedNumber: '', sedName: '', protecciones: redcadProtection(getValue(attrs, ['SAL_EQP_TIP'], '')),
        soporte: '12/200', cantidadSoportes: 1, cimentacion: 'CM', terreno: 'I', accesibilidad: 'TA', comentario: ''
      }, { id, point }, { type: 'Circuito BT', gisCode, detail: redcadText(getValue(attrs, ['SAL_NOM_SAL'], gisCode)) });
    });

    const postesOrdenados = [...data.postesBT].sort((a, b) => {
      const pa = redcadPointFromGeometry(a.geometry, context);
      const pb = redcadPointFromGeometry(b.geometry, context);
      return redcadDistance(sedPoint, pa) - redcadDistance(sedPoint, pb);
    });

    postesOrdenados.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const point = redcadPointFromGeometry(feature.geometry, context);
      if (!point) return;
      const id = nextId++;
      const parent = nearestRedcadNode(point, nodes, Number.POSITIVE_INFINITY);
      const gisCode = redcadText(getValue(attrs, ['NOD_COD_NOD', 'NBT_COD_NBT', 'OBJECTID'], `NBT${String(index + 1).padStart(9, '0')}`));
      addStructure({
        id, parentId: parent?.id || sedNumericId, code: '', zoneBand: point.zoneBand, x: point.x, y: point.y, tipoRed: 'RS',
        sedNumber: '', sedName: '', armadoBT: redcadArms(attrs), soporte: redcadSupport(attrs) || '8/200',
        cantidadSoportes: cantidadSoportesPoste(attrs) || 1, pat: redcadYes(attrs, ['NOD_ATER', 'NOD_FLG_ATER', 'NOD_FLAG_ATER']) ? `${id}-PAT` : '',
        cimentacion: redcadFoundation(attrs), terreno: 'I', accesibilidad: 'TA', comentario: ''
      }, { id, point }, { type: 'Poste BT', gisCode, detail: redcadText(getFuncionEstructura(getValue(attrs, ['NOD_COD_FNC'], ''))) });
    });

    const acometidas = [[''], REDCAD_DROP_HEADER];
    data.suministros.forEach((feature, index) => {
      const attrs = feature.attributes || {};
      const point = redcadPointFromGeometry(feature.geometry, context);
      if (!point) return;
      const parent = nearestRedcadNode(point, nodes, Number.POSITIVE_INFINITY);
      const code = redcadText(getValue(attrs, ['SUM_COD_SUM', 'OBJECTID'], `SUM${index + 1}`));
      const name = redcadText(getValue(attrs, ['SUM_NOM_SUM', 'SUM_DIR_SUM'], code));
      const rowNumber = acometidas.length + 1;
      acometidas.push([
        parent?.id || sedNumericId,
        index + 1,
        point.x,
        point.y,
        'Corta',
        parent ? redondear(redcadDistance(parent.point, point), 3) : '',
        '',
        redcadText(getValue(attrs, ['SUM_ACC_ACO', 'SUM_TIP_ACO'], 'Murete existente')),
        redcadSupplyLoad(attrs, code),
        name || code,
        numericValue(getValue(attrs, ['SUM_MAX_DEM', 'SUM_POT_CON', 'SUM_POT_EQT'], 0)) || '',
        numericValue(getValue(attrs, ['SUM_FAC_SIM', 'SUM_FS'], 0)) || ''
      ]);
      addReference('Acometidas', rowNumber, `${parent?.id || sedNumericId}/${index + 1}`, 'Suministro', code, name || code, point);
    });

    return { estructuras: rows, acometidas, referencia: reference };
  }

  function getRedcadZone(data) {
    const first = pointToLatLng(data.sed?.geometry) || firstLatLngFromFeatureList(data.suministros) || firstLatLngFromFeatureList(data.postesBT) || firstLatLngFromFeatureList(data.tramosBT);
    return first ? getUtmZoneFromLon(first[1]) : 19;
  }

  function createRedcadContext(data, zone) {
    const latlngs = [];
    const addPoint = geom => { const point = pointToLatLng(geom); if (point) latlngs.push(point); };
    addPoint(data.sed?.geometry);
    data.suministros.forEach(feature => addPoint(feature.geometry));
    data.circuitosBT.forEach(feature => addPoint(feature.geometry));
    data.postesBT.forEach(feature => addPoint(feature.geometry));
    data.tramosBT.forEach(feature => pathsToLatLngs(feature.geometry).forEach(path => path.forEach(point => latlngs.push(point))));
    const projected = latlngs.map(([lat, lon]) => ({ lat, utm: wgs84ToUtm(lat, lon, zone) }));
    const eastings = projected.map(item => item.utm.easting).filter(Number.isFinite);
    const northings = projected.map(item => item.utm.northing).filter(Number.isFinite);
    return {
      zone,
      originE: eastings.length ? Math.min(...eastings) - 20 : 0,
      originN: northings.length ? Math.min(...northings) - 20 : 0,
      localOffsetX: REDCAD_LOCAL_OFFSET_X,
      localOffsetY: REDCAD_LOCAL_OFFSET_Y
    };
  }

  function redcadPointFromGeometry(geometry, zone) {
    return redcadPointFromLatLng(pointToLatLng(geometry), zone);
  }

  function redcadPointFromLatLng(latlng, context) {
    if (!latlng) return null;
    const [lat, lon] = latlng;
    const zone = typeof context === 'number' ? context : context.zone;
    const utm = wgs84ToUtm(lat, lon, zone);
    const originE = typeof context === 'number' ? 0 : context.originE;
    const originN = typeof context === 'number' ? 0 : context.originN;
    const localOffsetX = typeof context === 'number' ? 0 : context.localOffsetX;
    const localOffsetY = typeof context === 'number' ? 0 : context.localOffsetY;
    return {
      x: redondear(utm.easting - originE + localOffsetX, 6),
      y: redondear(utm.northing - originN + localOffsetY, 6),
      utmX: redondear(utm.easting, 3),
      utmY: redondear(utm.northing, 3),
      zoneBand: `${utm.zone}${getUtmBandFromLat(lat)}`
    };
  }

  function getUtmBandFromLat(lat) {
    const bands = 'CDEFGHJKLMNPQRSTUVWX';
    if (!Number.isFinite(lat)) return lat < 0 ? 'L' : 'M';
    if (lat <= -80) return 'C';
    if (lat >= 84) return 'X';
    return bands[Math.max(0, Math.min(bands.length - 1, Math.floor((lat + 80) / 8)))] || 'L';
  }

  function redcadStructRow(data) {
    return [
      data.id ?? '', data.parentId ?? '', data.code ?? '', data.zoneBand || '', data.x ?? '', data.y ?? '',
      data.tipoRed || '', data.sedNumber ?? '', data.sedName || '', data.sedType || '', data.armadoMT1 || '',
      data.armadoMT2 || '', data.armadoBT || '', data.armadoBT2 || '', data.soporte || '', data.cantidadSoportes ?? '',
      data.pat || '', data.retenidas || '', data.cajasDerivacion || '', data.puntoIluminacion || '', data.protecciones || '',
      data.cimentacion || 'CM', data.terreno || 'I', data.accesibilidad || 'TA', data.conductor || '',
      data.sistemaLinea || '', data.esVanoFlojo || '', data.comentario || ''
    ];
  }

  function uniqueRedcadId(value, used) {
    const base = cleanRedcadId(value || 'ID');
    let id = base;
    let i = 2;
    while (used.has(id)) id = `${base}_${i++}`;
    used.add(id);
    return id;
  }

  function cleanRedcadId(value) {
    return redcadText(value).replace(/[^A-Z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').substring(0, 24) || 'ID';
  }

  function redcadText(value) {
    return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function numericValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function redcadSupport(attrs) {
    const height = numericValue(getValue(attrs, ['NOD_ALT_SPT', 'SED_ALT_SPT'], 0));
    const effort = redcadText(getValue(attrs, ['NOD_ESF_SPT', 'SED_ESF_SPT'], ''));
    if (height && effort) return `${height}/${effort}`;
    return height ? `${height}` : redcadText(getValue(attrs, ['NOD_COD_TIP_SPT', 'NOD_DSC_TIP_SPT'], ''));
  }

  function redcadFoundation(attrs) {
    const height = numericValue(getValue(attrs, ['NOD_ALT_SPT'], 0));
    return height ? `CM${Math.round(height)}` : 'CM';
  }

  function redcadSubstationType(powerKvA, voltage) {
    const power = Math.round(numericValue(powerKvA) || 0);
    const voltageCode = redcadVoltageCode(voltage);
    if (!power) return voltageCode || '';
    return `${power}kVA-2ø-${voltageCode || '13.2'}kV`;
  }

  function redcadVoltageCode(value) {
    return redcadText(value)
      .replace(/\s+/g, '')
      .replace(/KV$/i, '')
      .replace(/,/g, '.');
  }

  function redcadArms(attrs) {
    const codes = [];
    for (let i = 1; i <= 4; i += 1) {
      const suffix = String(i).padStart(2, '0');
      const code = redcadText(getValue(attrs, [`NOD_COD_TIP_ARM_${suffix}`], ''));
      if (code && code !== 'N/A') codes.push(code);
    }
    return codes.join(',');
  }

  function redcadConductor(attrs) {
    return [
      redcadText(getValue(attrs, ['TBT_SP_NRO_CND', 'TBT_AP_NRO_CND', 'TBT_NRO_CND'], '')),
      redcadText(getValue(attrs, ['TBT_SP_MAT_CND', 'TBT_AP_MAT_CND', 'TBT_COD_MAT_COND'], '')),
      redcadText(getValue(attrs, ['TBT_SP_SEC_CND', 'TBT_AP_SEC_CND', 'TBT_SEC_CND'], ''))
    ].filter(Boolean).join(' ');
  }

  function redcadLineSystem(attrs) {
    const conductors = numericValue(getValue(attrs, ['TBT_SP_NRO_CND', 'TBT_AP_NRO_CND', 'TBT_NRO_CND'], 0));
    if (conductors) return redondear(conductors / 100, 2);
    return '';
  }

  function redcadYes(attrs, fields) {
    return fields.some(field => /^(S|SI|1|TRUE)$/i.test(String(attrs[field] ?? '').trim()));
  }

  function redcadProtection(code) {
    const value = redcadText(code);
    const tipos = {
      FU: 'Fusible',
      TM: 'Interruptor Termomagnetico',
      CM: 'Interruptor Automatico Caja Moldeada'
    };
    return tipos[value] || value || '';
  }

  function redcadSupplyLoad(attrs, fallback) {
    const phase = redcadText(getValue(attrs, ['SUM_MED_FAS', 'SUM_COD_FAS'], '1'));
    const type = redcadText(getValue(attrs, ['SUM_TIP_SRV', 'SUM_TAR_SUM'], ''));
    if (/3|TRI/i.test(phase)) return `Carga 3ø${type ? ` - ${type}` : ''}`;
    if (/2|BI/i.test(phase)) return `Carga 2ø${type ? ` - ${type}` : ''}`;
    return `Carga 1ø${type ? ` - ${type}` : fallback ? ` - ${fallback}` : ''}`;
  }

  function nearestRedcadNode(point, nodes, maxDistance) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    nodes.forEach(node => {
      const distance = redcadDistance(point, node.point);
      if (distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    });
    return best && bestDistance <= maxDistance ? best : null;
  }

  function redcadDistance(a, b) {
    return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
  }

  function renderCompactView() {
    const host = document.getElementById('solutionsExportView');
    if (!host) return;

    const css = `
      #solutionsExportView {
        position: fixed;
        inset: 0;
        z-index: 3200;
        display: none;
        background: #f4f7fb;
        color: #1f2937;
        overflow: auto;
      }

      .solutions-shell {
        max-width: 1180px;
        margin: 0 auto;
        padding: 18px;
      }

      .solutions-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        background: #0f3b5f;
        color: #fff;
        padding: 16px 18px;
        border-radius: 8px;
        box-shadow: 0 4px 14px rgba(15, 59, 95, 0.18);
      }

      .solutions-head h2 {
        margin: 0;
        font-size: 20px;
      }

      .solutions-head p {
        margin: 4px 0 0 0;
        font-size: 13px;
        opacity: 0.9;
      }

      .solutions-close {
        border-radius: 6px;
        background: #d7263d;
      }

      .solutions-grid {
        display: grid;
        grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
        gap: 16px;
        margin-top: 16px;
      }

      .solutions-panel {
        background: #fff;
        border: 1px solid #dce6f1;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 14px rgba(15, 59, 95, 0.07);
      }

      .solutions-steps {
        display: grid;
        gap: 12px;
      }

      .solution-step {
        border: 1px solid #dce6f1;
        border-radius: 8px;
        padding: 14px;
        background: #fff;
      }

      .solution-step h3 {
        margin: 0 0 6px 0;
        color: #0f3b5f;
        font-size: 16px;
      }

      .solution-step p,
      .solution-step li,
      .solutions-note {
        font-size: 13px;
        line-height: 1.45;
        color: #4b5563;
      }

      .solution-step ul {
        margin: 8px 0 0 18px;
        padding: 0;
      }

      .solutions-actions {
        display: grid;
        gap: 10px;
      }

      .solutions-actions button {
        width: 100%;
        border-radius: 6px;
        text-transform: none;
        letter-spacing: 0;
      }

      .solutions-primary {
        background: linear-gradient(135deg, #0f766e 0%, #1693a5 100%);
      }

      .solutions-secondary {
        background: linear-gradient(135deg, #2563eb 0%, #0f3b5f 100%);
      }

      .solutions-warning {
        background: linear-gradient(135deg, #f59e0b 0%, #c2410c 100%);
        color: #fff;
      }

      .solutions-note {
        margin-top: 12px;
        padding: 12px;
        border-radius: 8px;
        background: #fff7ed;
        border: 1px solid #fed7aa;
      }

      .solutions-disabled {
        opacity: 0.68;
        cursor: not-allowed;
      }

      .solutions-mini {
        display: grid;
        gap: 10px;
      }

      .solutions-mini .metric {
        background: #eef6fb;
        border-left: 4px solid #1693a5;
        border-radius: 6px;
        padding: 10px 12px;
      }

      .solutions-mini .metric strong {
        display: block;
        color: #0f3b5f;
        font-size: 13px;
        margin-bottom: 4px;
      }

      @media (max-width: 960px) {
        .solutions-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    const markup = `
      <div class="solutions-shell">
        <div class="solutions-topbar">
          <div class="solutions-head">
            <h2>Exportar</h2>
            <p id="solutionsSedCode">Sin seleccionar</p>
          </div>
          <button onclick="cerrarVistaExportSolutions()" class="solutions-close">
            <i class="fas fa-arrow-left"></i> Volver al mapa
          </button>
        </div>

        <div class="solutions-grid">
          <section class="solutions-panel">
            <div class="solutions-steps">
              <article class="solution-step">
                <h3>1. Topomagic</h3>
                <p>Importe la topografía desde <strong>Archivo &gt; Importar &gt; Topografía</strong> usando el KML generado. Ese archivo ya incluye la subestación, las rutas MT y los suministros.</p>
                <ul>
                  <li>Luego guarde el trabajo como <strong>.top</strong>.</li>
                  <li>Si el programa pide texto, use el CSV de respaldo.</li>
                </ul>
              </article>

              <article class="solution-step">
                <h3>2. REDLIN</h3>
                <p>Abra el <strong>.top</strong> guardado en Topomagic desde <strong>Archivo &gt; Importar</strong>. REDLIN trabajará sobre la línea primaria/MT; la BT no se diseña aquí.</p>
                <ul>
                  <li>Revise <strong>Vista Planta</strong> y <strong>Vista Perfil</strong>.</li>
                  <li>Guarde el diseño como <strong>.len</strong> si hace falta.</li>
                </ul>
              </article>

              <article class="solution-step">
                <h3>3. REDCAD</h3>
                <p>Use el DXF para ver el diseño BT y el Excel para la red existente. REDCAD sí trabaja redes MT/BT y admite importación de Excel para remodelaciones y ampliaciones.</p>
                <ul>
                  <li>Importe el DXF con <strong>Archivo &gt; Cargar Catastro</strong>.</li>
                  <li>Use el Excel como base de la red existente si quiere llevar estructuras y suministros.</li>
                </ul>
              </article>
            </div>

            <div class="solutions-note">
              La ruta recomendada es: KML en Topomagic, guardar .top, importar ese .top en REDLIN, y llevar el BT a REDCAD con DXF + Excel.
            </div>
          </section>

          <aside class="solutions-panel">
            <div class="solutions-mini">
              <div class="metric">
                <strong>Topomagic</strong>
                <span>KML con rutas MT y suministros, CSV de respaldo.</span>
              </div>
              <div class="metric">
                <strong>REDLIN</strong>
                <span>La BT no se diseña aquí; solo la línea primaria/MT.</span>
              </div>
              <div class="metric">
                <strong>REDCAD</strong>
                <span>DXF para ver el plano y Excel para la red existente.</span>
              </div>
            </div>

            <div class="solutions-actions" style="margin-top: 14px;">
              <button onclick="generarTopomagicKML()" class="solutions-primary">
                <i class="fas fa-route"></i> Descargar KML Topomagic
              </button>
              <button onclick="generarTopomagicCSV()" class="solutions-secondary">
                <i class="fas fa-file-csv"></i> Descargar CSV Topomagic
              </button>
              <button onclick="generarRedcadExcel()" class="solutions-secondary">
                <i class="fas fa-file-excel"></i> Descargar Excel REDCAD
              </button>
              <button onclick="generarReporteDXF && generarReporteDXF()" class="solutions-warning">
                <i class="fas fa-file-code"></i> Descargar DXF REDCAD
              </button>
            </div>
          </aside>
        </div>
      </div>
    `;

    const finalMarkup = `
      <div class="solutions-shell">
        <div class="solutions-topbar">
          <div class="solutions-head">
            <h2>Exportar</h2>
            <p id="solutionsSedCode">Sin seleccionar</p>
          </div>
          <button onclick="cerrarVistaExportSolutions()" class="solutions-close">
            <i class="fas fa-arrow-left"></i> Volver al mapa
          </button>
        </div>

        <div class="solutions-grid">
          <section class="solutions-panel">
            <div class="solutions-steps">
              <article class="solution-step">
                <h3>Topomagic</h3>
                <p>Exportacion reservada. Por ahora no se generara ningun archivo para Topomagic desde esta pantalla.</p>
              </article>

              <article class="solution-step">
                <h3>REDCAD</h3>
                <p>Genera el formato de red existente para REDCAD con la subestacion, estructuras BT y acometidas de suministros.</p>
                <ul>
                  <li>Excel: hojas <strong>Estructuras</strong> y <strong>Acometidas</strong>.</li>
                  <li>DXF: plano georreferenciado para revisar la red BT.</li>
                </ul>
              </article>
            </div>

            <div class="solutions-note">
              Por ahora esta vista solo descarga REDCAD. Topomagic queda visible como opcion, pero sin generar archivos.
            </div>
          </section>

          <aside class="solutions-panel">
            <div class="solutions-mini">
              <div class="metric">
                <strong>Topomagic</strong>
                <span>Pendiente. No descarga archivos todavia.</span>
              </div>
              <div class="metric">
                <strong>REDCAD</strong>
                <span>Excel de estructuras/acometidas y DXF del plano BT.</span>
              </div>
            </div>

            <div class="solutions-actions" style="margin-top: 14px;">
              <button onclick="notificarTopomagicPendiente()" class="solutions-primary solutions-disabled">
                <i class="fas fa-route"></i> Topomagic pendiente
              </button>
              <button onclick="generarRedcadExcel()" class="solutions-secondary">
                <i class="fas fa-file-excel"></i> Descargar Excel REDCAD
              </button>
              <button onclick="generarReporteDXF && generarReporteDXF()" class="solutions-warning">
                <i class="fas fa-file-code"></i> Descargar DXF REDCAD
              </button>
            </div>
          </aside>
        </div>
      </div>
    `;

    host.innerHTML = finalMarkup;
    let style = document.querySelector('style[data-solutions-style="true"]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-solutions-style', 'true');
      document.head.appendChild(style);
    }
    style.textContent = css;
  }

  async function generarTopomagicKML(codigoSED = '') {
    const code = setSelectedCode(codigoSED || getSelectedCode());
    if (!code) {
      showNotification('Seleccione o ingrese el código de la subestación para generar el KML de Topomagic', 'error', 6000);
      return false;
    }

    showLoadingMessage(`Generando KML Topomagic de la SED ${code}...`);
    try {
      const data = await fetchSolutionsData(code);
      if (!data.sed) throw new Error('No se encontro la subestacion seleccionada.');
      const kml = buildTopomagicKml(data);
      const fecha = new Date().toISOString().split('T')[0];
      downloadText(`topomagic_rutas_${code}_${fecha}.kml`, kml, 'application/vnd.google-earth.kml+xml;charset=utf-8;');
      showNotification('KML Topomagic generado con rutas MT y suministros.', 'success', 8000);
      return true;
    } catch (error) {
      console.error('Error al generar KML Topomagic:', error);
      showNotification(`Error al generar KML Topomagic: ${error.message}`, 'error', 8000);
      return false;
    } finally {
      hideLoadingMessage();
    }
  }

  async function generarTopomagicCSV(codigoSED = '') {
    const code = setSelectedCode(codigoSED || getSelectedCode());
    if (!code) {
      showNotification('Seleccione o ingrese el código de la subestación para generar el CSV de Topomagic', 'error', 6000);
      return false;
    }

    showLoadingMessage(`Generando CSV Topomagic de la SED ${code}...`);
    try {
      const data = await fetchSolutionsData(code);
      if (!data.sed) throw new Error('No se encontro la subestacion seleccionada.');
      const csv = buildTopomagicCsv(data);
      const fecha = new Date().toISOString().split('T')[0];
      downloadText(`topomagic_puntos_${code}_${fecha}.csv`, csv, 'text/csv;charset=utf-8;');
      showNotification('CSV Topomagic generado como respaldo de importación.', 'success', 8000);
      return true;
    } catch (error) {
      console.error('Error al generar CSV Topomagic:', error);
      showNotification(`Error al generar CSV Topomagic: ${error.message}`, 'error', 8000);
      return false;
    } finally {
      hideLoadingMessage();
    }
  }

  function notificarTopomagicPendiente() {
    showNotification('Topomagic queda pendiente. Por ahora solo se exporta REDCAD.', 'info', 6000);
    return false;
  }

  async function generarRedcadExcel(codigoSED = '') {
    const code = setSelectedCode(codigoSED || getSelectedCode());
    if (!code) {
      showNotification('Seleccione o ingrese el código de la subestación para generar el Excel REDCAD', 'error', 6000);
      return false;
    }

    showLoadingMessage(`Generando Excel REDCAD de la SED ${code}...`);
    try {
      const data = await fetchSolutionsData(code);
      if (!data.sed) throw new Error('No se encontro la subestacion seleccionada.');
      const workbook = buildRedcadWorkbook(data);
      const referenceWorkbook = buildRedcadReferenceWorkbook(data);
      const fecha = new Date().toISOString().split('T')[0];
      await downloadRedcadBinaryExcel(`redcad_red_existente_${code}_${fecha}.xls`, workbook);
      downloadExcel(`referencia_redcad_${code}_${fecha}.xls`, referenceWorkbook);
      showNotification('Excel REDCAD generado en formato Excel 97-2003 y referencia descargada aparte.', 'success', 9000);
      return true;
    } catch (error) {
      console.error('Error al generar Excel REDCAD:', error);
      showNotification(`Error al generar Excel REDCAD: ${error.message}`, 'error', 8000);
      return false;
    } finally {
      hideLoadingMessage();
    }
  }

  async function descargarPaqueteSolutions(codigoSED = '') {
    const code = setSelectedCode(codigoSED || getSelectedCode());
    if (!code) {
      showNotification('Seleccione o ingrese el código de la subestación para descargar el paquete', 'error', 6000);
      return;
    }

    await generarRedcadExcel(code);
    if (typeof generarReporteDXF === 'function') {
      await generarReporteDXF(code);
    }
  }

  function abrirVistaExportSolutions(codigoSED = '') {
    const code = setSelectedCode(codigoSED || getSelectedCode());
    if (!code) {
      showNotification('Seleccione una subestación o ingrese un código SED para abrir Solutions', 'error', 6000);
      return;
    }

    const view = document.getElementById('solutionsExportView');
    if (!view) return;
    renderCompactView();
    const label = document.getElementById('solutionsSedCode');
    if (label) label.textContent = code;
    view.style.display = 'block';
    view.setAttribute('aria-hidden', 'false');
  }

  function cerrarVistaExportSolutions() {
    const view = document.getElementById('solutionsExportView');
    if (!view) return;
    view.style.display = 'none';
    view.setAttribute('aria-hidden', 'true');
  }

  async function cargarRedCompletaDesdeSolutions() {
    const code = setSelectedCode(getSelectedCode());
    if (!code) {
      showNotification('Seleccione una subestacion antes de cargar la red BT', 'error', 6000);
      return;
    }
    if (typeof window.cargarRedCompletaBT === 'function') {
      await window.cargarRedCompletaBT(code);
    }
  }

  // Mantener compatibilidad con los onclick ya existentes.
  window.abrirVistaExportSolutions = abrirVistaExportSolutions;
  window.cerrarVistaExportSolutions = cerrarVistaExportSolutions;
  window.cargarRedCompletaDesdeSolutions = cargarRedCompletaDesdeSolutions;
  window.generarTopomagicKML = generarTopomagicKML;
  window.generarTopomagicCSV = generarTopomagicCSV;
  window.notificarTopomagicPendiente = notificarTopomagicPendiente;
  window.generarRedcadExcel = generarRedcadExcel;
  window.descargarPaqueteSolutions = descargarPaqueteSolutions;

  renderCompactView();
})();
