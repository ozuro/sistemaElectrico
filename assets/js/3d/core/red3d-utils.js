(function (global) {
  function cleanText(value, fallback = 'N/A', maxLength = 42) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text === 'N/A') return fallback;
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}...` : text;
  }

  function createCylinderBetween(THREE, start, end, radius, material, radialSegments = 8) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (!Number.isFinite(length) || length <= 0.001) return null;

    const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function addMesh(group, mesh) {
    if (mesh) group.add(mesh);
    return mesh;
  }

  function createLabelSprite(THREE, lines, options = {}) {
    const textLines = Array.isArray(lines)
      ? lines.map((line) => String(line))
      : String(lines || '').split('\n');
    const fontSize = options.fontSize || 18;
    const fontFamily = options.fontFamily || 'Segoe UI, Arial, sans-serif';
    const paddingX = options.paddingX || 10;
    const paddingY = options.paddingY || 8;
    const lineHeight = options.lineHeight || Math.round(fontSize * 1.25);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    context.font = `${fontSize}px ${fontFamily}`;
    const widths = textLines.map((line) => context.measureText(line).width);
    canvas.width = Math.max(96, Math.ceil(Math.max(...widths, 0) + paddingX * 2));
    canvas.height = Math.max(32, Math.ceil(textLines.length * lineHeight + paddingY * 2));

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `${fontSize}px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = options.background || 'rgba(18, 26, 32, 0.72)';
    context.strokeStyle = options.border || 'rgba(255,255,255,0.22)';
    context.lineWidth = 2;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    context.fillStyle = options.color || '#ffffff';
    textLines.forEach((line, index) => {
      const y = paddingY + fontSize * 0.7 + index * lineHeight;
      context.fillText(line, canvas.width / 2, y);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    const scale = options.scale || 1;
    sprite.scale.set((canvas.width / 12) * scale, (canvas.height / 12) * scale, 1);
    sprite.userData.kind = 'label';
    sprite.userData.texture = texture;
    return sprite;
  }

  function computeRenderableBounds(THREE, root) {
    const box = new THREE.Box3();
    if (!root) return box;

    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      if (node.userData?.kind === 'label' || node.userData?.excludeFromBounds) return;
      if (!node.isMesh && !node.isLine && !node.isPoints) return;
      if (!node.geometry) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox) return;

      const geometryBox = node.geometry.boundingBox.clone();
      geometryBox.applyMatrix4(node.matrixWorld);
      box.union(geometryBox);
    });

    if (box.isEmpty()) box.setFromObject(root);
    return box;
  }

  global.Red3DUtils = {
    cleanText,
    createCylinderBetween,
    addMesh,
    createLabelSprite,
    computeRenderableBounds
  };
})(window);
