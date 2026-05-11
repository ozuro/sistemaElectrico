(function (global) {
  const CARTO_BASE_URL = 'https://geocatminnube.ingemmet.gob.pe/arcgis/rest/services/SERV_CARTOGRAFIA_BASE_WGS84/MapServer';
  const CONTEXT_BUFFER_METERS = 180;
  const DEG = Math.PI / 180;

  function emptyContext() {
    return {
      carreteras: [],
      curvasNivelPrimarias: [],
      curvasNivelSecundarias: []
    };
  }

  function isValidLatLonBounds(bounds) {
    return (
      bounds &&
      Number.isFinite(bounds.minLat) &&
      Number.isFinite(bounds.minLon) &&
      Number.isFinite(bounds.maxLat) &&
      Number.isFinite(bounds.maxLon)
    );
  }

  function createLatLonBounds() {
    return {
      minLat: Number.POSITIVE_INFINITY,
      minLon: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY
    };
  }

  function trackLatLon(bounds, lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.minLon = Math.min(bounds.minLon, lon);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
    bounds.maxLon = Math.max(bounds.maxLon, lon);
  }

  function pathsToLatLngs(geometry) {
    if (!geometry?.paths) return [];
    return geometry.paths
      .map((path) =>
        path
          .map((coord) => [Number(coord[1]), Number(coord[0])])
          .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
      )
      .filter((path) => path.length > 0);
  }

  function trackFeatureLatLon(bounds, feature) {
    const lat = Number(feature?.geometry?.y);
    const lon = Number(feature?.geometry?.x);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      trackLatLon(bounds, lat, lon);
      return;
    }

    pathsToLatLngs(feature?.geometry).forEach((path) => {
      path.forEach(([pointLat, pointLon]) => trackLatLon(bounds, pointLat, pointLon));
    });
  }

  function collectNetworkLatLonBounds(data) {
    const bounds = createLatLonBounds();
    const entries = [
      ...(data?.subestacion ? [data.subestacion] : []),
      ...(data?.suministros || []),
      ...(data?.circuitosBT || []),
      ...(data?.postesBT || []),
      ...(data?.tramosBT || []),
      ...(data?.retenidasBT || []),
      ...(data?.puestasTierraBT || [])
    ];

    entries.forEach((feature) => trackFeatureLatLon(bounds, feature));
    return isValidLatLonBounds(bounds) ? bounds : null;
  }

  function expandLatLonBounds(bounds, meters = CONTEXT_BUFFER_METERS) {
    if (!isValidLatLonBounds(bounds)) return null;
    const centerLat = (bounds.minLat + bounds.maxLat) / 2;
    const latPad = meters / 111320;
    const lonPad = meters / (111320 * Math.max(Math.cos(centerLat * DEG), 0.2));
    return {
      minLat: bounds.minLat - latPad,
      minLon: bounds.minLon - lonPad,
      maxLat: bounds.maxLat + latPad,
      maxLon: bounds.maxLon + lonPad
    };
  }

  function envelopeFromLatLonBounds(bounds) {
    if (!isValidLatLonBounds(bounds)) return null;
    return {
      xmin: bounds.minLon,
      ymin: bounds.minLat,
      xmax: bounds.maxLon,
      ymax: bounds.maxLat,
      spatialReference: { wkid: 4326 }
    };
  }

  async function queryCartoLayer(layerId, geometry, options = {}) {
    const features = [];
    let offset = 0;
    let guard = 0;
    let more = true;
    const maxFeatures = options.maxFeatures || 450;
    const pageSize = 1000;

    while (more && guard < 12 && features.length < maxFeatures) {
      const params = new URLSearchParams({
        f: 'json',
        where: '1=1',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        geometry: JSON.stringify(geometry),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        resultRecordCount: String(Math.min(pageSize, maxFeatures - features.length)),
        resultOffset: String(offset)
      });

      const response = await fetch(`${CARTO_BASE_URL}/${layerId}/query?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} consultando capa base ${layerId}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || `Error consultando capa base ${layerId}`);
      }

      const batch = data.features || [];
      features.push(...batch);
      more = data.exceededTransferLimit === true && batch.length > 0;
      offset += batch.length;
      guard += 1;
    }

    return features;
  }

  function settledFeatures(result) {
    return result.status === 'fulfilled' ? result.value || [] : [];
  }

  async function loadBaseContext(data) {
    const bounds = expandLatLonBounds(collectNetworkLatLonBounds(data));
    const geometry = envelopeFromLatLonBounds(bounds);
    if (!geometry) return emptyContext();

    const [roadNac, roadDep, roadVec, contourPri, contourSec] = await Promise.allSettled([
      queryCartoLayer(4, geometry),
      queryCartoLayer(5, geometry),
      queryCartoLayer(6, geometry),
      queryCartoLayer(9, geometry),
      queryCartoLayer(10, geometry)
    ]);

    return {
      carreteras: [
        ...settledFeatures(roadNac).map((feature) => ({ ...feature, __tipoContexto: 'Nacional' })),
        ...settledFeatures(roadDep).map((feature) => ({ ...feature, __tipoContexto: 'Departamental' })),
        ...settledFeatures(roadVec).map((feature) => ({ ...feature, __tipoContexto: 'Vecinal' }))
      ],
      curvasNivelPrimarias: settledFeatures(contourPri).map((feature) => ({ ...feature, __tipoContexto: 'Primaria' })),
      curvasNivelSecundarias: settledFeatures(contourSec).map((feature) => ({ ...feature, __tipoContexto: 'Secundaria' }))
    };
  }

  global.Red3DContext = {
    emptyContext,
    loadBaseContext
  };
})(window);
