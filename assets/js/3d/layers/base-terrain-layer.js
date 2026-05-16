(function (global) {
  const utils = global.Red3DUtils;
  const WORLD_IMAGERY_EXPORT = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getAttr(attrs, fields, fallback = '') {
    for (const field of fields) {
      const value = attrs?.[field];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return fallback;
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = parseFloat(String(value ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function collectContourSamples(context, latLngToLocal) {
    const features = [
      ...(context?.curvasNivelPrimarias || []),
      ...(context?.curvasNivelSecundarias || [])
    ];
    const samples = [];

    features.forEach((feature) => {
      const elevation = toNumber(getAttr(feature.attributes || {}, ['altitud', 'ALTITUD', 'ELEV', 'COTA'], ''));
      if (!Number.isFinite(elevation) || elevation === 0) return;
      (feature.geometry?.paths || []).forEach((path) => {
        path.forEach((coord, index) => {
          if (index % 3 !== 0) return;
          const lng = Number(coord[0]);
          const lat = Number(coord[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          const local = latLngToLocal(lat, lng);
          samples.push({ x: local.x, z: local.z, elevation });
        });
      });
    });

    return samples;
  }

  function createElevationSampler(samples, options = {}) {
    if (!samples.length || !options.reliefEnabled) {
      return () => 0;
    }

    const minElevation = Math.min(...samples.map((sample) => sample.elevation));
    const verticalScale = 0.55 * (Number(options.elevationScale) || 1);

    return (x, z) => {
      const nearest = samples
        .map((sample) => {
          const distance = Math.hypot(sample.x - x, sample.z - z);
          return { sample, distance };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 12);

      if (!nearest.length) return 0;

      let weighted = 0;
      let totalWeight = 0;
      nearest.forEach(({ sample, distance }) => {
        const weight = 1 / Math.max(18, distance * distance * 0.018);
        weighted += sample.elevation * weight;
        totalWeight += weight;
      });

      const relative = (weighted / totalWeight) - minElevation;
      return clamp(relative * verticalScale, -120, 120);
    };
  }

  function expandBounds(bounds, minSize = 420, padding = 180) {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const width = Math.max(minSize, bounds.maxX - bounds.minX + padding * 2);
    const depth = Math.max(minSize, bounds.maxZ - bounds.minZ + padding * 2);
    return {
      minX: centerX - width / 2,
      maxX: centerX + width / 2,
      minZ: centerZ - depth / 2,
      maxZ: centerZ + depth / 2,
      width,
      depth,
      centerX,
      centerZ
    };
  }

  function smoothTerrainGeometry(geometry, iterations = 2) {
    const position = geometry.attributes.position;
    const grid = Math.round(Math.sqrt(position.count));
    if (grid * grid !== position.count) return;
    for (let pass = 0; pass < iterations; pass += 1) {
      const ys = [];
      for (let i = 0; i < position.count; i += 1) ys.push(position.getY(i));
      for (let z = 1; z < grid - 1; z += 1) {
        for (let x = 1; x < grid - 1; x += 1) {
          const idx = z * grid + x;
          const avg = (
            ys[idx] * 4 +
            ys[idx - 1] +
            ys[idx + 1] +
            ys[idx - grid] +
            ys[idx + grid]
          ) / 8;
          position.setY(idx, avg);
        }
      }
    }
    position.needsUpdate = true;
  }

  function buildImageryUrl(bounds, localToLatLng) {
    const corners = [
      localToLatLng(bounds.minX, bounds.minZ),
      localToLatLng(bounds.maxX, bounds.maxZ)
    ];
    const minLon = Math.min(corners[0].lng, corners[1].lng);
    const minLat = Math.min(corners[0].lat, corners[1].lat);
    const maxLon = Math.max(corners[0].lng, corners[1].lng);
    const maxLat = Math.max(corners[0].lat, corners[1].lat);
    const params = new URLSearchParams({
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
      bboxSR: '4326',
      imageSR: '4326',
      size: '1024,1024',
      dpi: '160',
      format: 'jpg',
      transparent: 'false',
      f: 'image'
    });
    return `${WORLD_IMAGERY_EXPORT}?${params}`;
  }

  function loadImageryTexture(THREE, mesh, bounds, localToLatLng) {
    if (!mesh || mesh.material.map) return;
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(buildImageryUrl(bounds, localToLatLng), (texture) => {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      mesh.material.map = texture;
      mesh.material.color.setHex(0xffffff);
      mesh.material.needsUpdate = true;
    });
  }

  function createTerrainMesh(THREE, bounds, sampler, options, localToLatLng) {
    const geometry = new THREE.PlaneGeometry(bounds.width, bounds.depth, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(bounds.centerX, 0, bounds.centerZ);

    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      positions.setY(i, sampler(x, z));
    }
    positions.needsUpdate = true;
    smoothTerrainGeometry(geometry, 3);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: options.satelliteEnabled ? 0xb6c8a3 : 0x5fae4f,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.excludeFromBounds = true;
    mesh.name = 'Base terreno 3D';

    if (options.satelliteEnabled) loadImageryTexture(THREE, mesh, bounds, localToLatLng);

    return mesh;
  }

  function createContourLines(THREE, context, latLngToLocal, sampler) {
    const group = new THREE.Group();
    group.name = 'Curvas de nivel 3D';
    const material = new THREE.LineBasicMaterial({ color: 0x6b7d69, transparent: true, opacity: 0.32 });

    [...(context?.curvasNivelPrimarias || []), ...(context?.curvasNivelSecundarias || [])].forEach((feature) => {
      (feature.geometry?.paths || []).forEach((path) => {
        const points = path
          .map((coord) => {
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const p = latLngToLocal(lat, lng);
            return new THREE.Vector3(p.x, sampler(p.x, p.z) + 0.08, p.z);
          })
          .filter(Boolean);
        if (points.length < 2) return;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone());
        line.userData.excludeFromBounds = true;
        group.add(line);
      });
    });

    return group;
  }

  function createRoadLayer(THREE, context, latLngToLocal, sampler) {
    const group = new THREE.Group();
    group.name = 'Carreteras 3D';
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4246, roughness: 0.92, metalness: 0.02 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xf1d567, roughness: 0.75, metalness: 0.02 });

    (context?.carreteras || []).forEach((feature) => {
      (feature.geometry?.paths || []).forEach((path) => {
        const points = path
          .map((coord) => {
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            const p = latLngToLocal(lat, lng);
            return new THREE.Vector3(p.x, sampler(p.x, p.z) + 0.12, p.z);
          })
          .filter(Boolean);
        if (points.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(points);
        const road = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), 1.35, 8, false), roadMaterial.clone());
        road.receiveShadow = true;
        road.castShadow = false;
        road.userData.excludeFromBounds = true;
        group.add(road);

        const stripe = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), 0.08, 5, false), edgeMaterial.clone());
        stripe.position.y += 0.05;
        stripe.userData.excludeFromBounds = true;
        group.add(stripe);
      });
    });

    return group;
  }

  function createBaseLayer(options) {
    const {
      THREE,
      localBounds,
      context,
      latLngToLocal,
      localToLatLng,
      layerOptions = {}
    } = options;

    const group = new THREE.Group();
    group.name = 'Base satelital y relieve';

    const expanded = expandBounds(localBounds);
    const samples = collectContourSamples(context, latLngToLocal);
    const sampler = createElevationSampler(samples, layerOptions);
    const terrainMesh = createTerrainMesh(THREE, expanded, sampler, layerOptions, localToLatLng);
    const contourGroup = createContourLines(THREE, context, latLngToLocal, sampler);
    const roadGroup = createRoadLayer(THREE, context, latLngToLocal, sampler);

    contourGroup.visible = Boolean(layerOptions.reliefEnabled);
    roadGroup.visible = Boolean(layerOptions.roadsEnabled);

    group.add(terrainMesh);
    group.add(contourGroup);
    group.add(roadGroup);

    return {
      group,
      sampleHeight: sampler,
      updateVisibility(nextOptions = {}) {
        roadGroup.visible = Boolean(nextOptions.roadsEnabled);
        contourGroup.visible = Boolean(nextOptions.reliefEnabled);
      if (nextOptions.satelliteEnabled) {
        loadImageryTexture(THREE, terrainMesh, expanded, localToLatLng);
      } else if (terrainMesh.material.map) {
        terrainMesh.material.map.dispose();
        terrainMesh.material.map = null;
          terrainMesh.material.color.setHex(0x5fae4f);
          terrainMesh.material.needsUpdate = true;
        } else {
          terrainMesh.material.color.setHex(0x5fae4f);
          terrainMesh.material.needsUpdate = true;
        }
      },
      stats: {
        roads: context?.carreteras?.length || 0,
        contours: (context?.curvasNivelPrimarias?.length || 0) + (context?.curvasNivelSecundarias?.length || 0),
        elevationSamples: samples.length
      }
    };
  }

  global.Red3DTerrain = {
    createBaseLayer
  };
})(window);
