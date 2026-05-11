(function (global) {
  const utils = global.Red3DUtils;

  function createMtSubstation(options) {
    const {
      THREE,
      point,
      attrs = {},
      code = 'SED',
      getValue = () => 'N/A',
      cleanText = utils.cleanText,
      createLabelSprite = (lines, labelOptions) => utils.createLabelSprite(THREE, lines, labelOptions)
    } = options;

    const group = new THREE.Group();
    group.position.set(point.x, point.y || 0, point.z);
    group.userData = { type: 'mt-substation', name: code };

    const concrete = new THREE.MeshStandardMaterial({ color: 0xbfc5c2, roughness: 0.9, metalness: 0.02 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x333a42, roughness: 0.62, metalness: 0.28 });
    const galvanized = new THREE.MeshStandardMaterial({ color: 0x8b969f, roughness: 0.5, metalness: 0.34 });
    const transformerBody = new THREE.MeshStandardMaterial({ color: 0x636b73, roughness: 0.58, metalness: 0.22 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf0c84a, roughness: 0.45, metalness: 0.08 });
    const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x27303a, roughness: 0.82, metalness: 0.08 });
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.36, metalness: 0.04 });

    const pad = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 3.9), concrete);
    pad.position.y = 0.11;
    pad.receiveShadow = true;
    group.add(pad);

    const poleHeight = 11.2;
    [-0.72, 0.72].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, poleHeight, 14), concrete);
      pole.position.set(x, poleHeight / 2, -0.55);
      pole.castShadow = true;
      pole.receiveShadow = true;
      group.add(pole);

      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.72, 14), concrete);
      base.position.set(x, 0.36, -0.55);
      base.castShadow = true;
      group.add(base);
    });

    [7.7, 9.35, 10.55].forEach((y, index) => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(index === 2 ? 3.8 : 3.2, 0.18, 0.22), galvanized);
      beam.position.set(0, y, -0.55);
      beam.castShadow = true;
      group.add(beam);
    });

    [-1.35, 0, 1.35].forEach((x) => {
      const cutout = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.95, 10), porcelain);
      cutout.position.set(x, 9.9, -0.2);
      cutout.rotation.z = Math.PI / 2;
      cutout.castShadow = true;
      group.add(cutout);

      const arrester = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.85, 10), yellow);
      arrester.position.set(x, 8.65, -0.18);
      arrester.castShadow = true;
      group.add(arrester);
    });

    const tank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.65, 1.75), transformerBody);
    tank.position.set(0, 6.05, 0.35);
    tank.castShadow = true;
    group.add(tank);

    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 1.25), darkSteel);
    lid.position.set(0, 7.02, 0.35);
    lid.castShadow = true;
    group.add(lid);

    for (let i = -1; i <= 1; i += 1) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.45), darkSteel);
      fin.position.set(1.42, 6.05, 0.35 + i * 0.45);
      fin.castShadow = true;
      group.add(fin);
    }

    const platform = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 1.95), galvanized);
    platform.position.set(0, 5.0, 0.35);
    platform.castShadow = true;
    group.add(platform);

    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.35, 0.42), cabinetMat);
    cabinet.position.set(-1.95, 2.45, 0.72);
    cabinet.castShadow = true;
    group.add(cabinet);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.04, 0.045), yellow);
    door.position.set(-1.95, 2.45, 0.955);
    group.add(door);

    [
      [new THREE.Vector3(-1.35, 9.9, -0.2), new THREE.Vector3(-0.65, 7.08, 0.35)],
      [new THREE.Vector3(0, 9.9, -0.2), new THREE.Vector3(0, 7.08, 0.35)],
      [new THREE.Vector3(1.35, 9.9, -0.2), new THREE.Vector3(0.65, 7.08, 0.35)],
      [new THREE.Vector3(-0.8, 5.4, 0.35), new THREE.Vector3(-1.95, 3.15, 0.72)]
    ].forEach(([start, end]) => {
      utils.addMesh(group, utils.createCylinderBetween(THREE, start, end, 0.025, darkSteel, 6));
    });

    const power = cleanText(getValue(attrs, ['SED_POT_INST', 'SED_POT_SED', 'SED_POT_NOM'], 'N/A'), 'N/A', 18);
    const voltage = cleanText(getValue(attrs, ['SED_TEN_NOM_PRI', 'SED_TEN_PRI'], 'N/A'), 'N/A', 18);
    const label = createLabelSprite([
      `${code}`,
      cleanText(getValue(attrs, ['SED_NOM_SED'], 'Subestacion'), 'Subestacion', 30),
      `${power} kVA | ${voltage} kV`
    ], {
      fontSize: 15,
      scale: 0.78,
      background: 'rgba(30, 41, 52, 0.80)'
    });
    label.position.set(0, 12.45, -0.2);
    group.add(label);

    return group;
  }

  global.Red3DObjects = {
    createMtSubstation
  };
})(window);
