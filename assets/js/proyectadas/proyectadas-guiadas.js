(function () {
  const state = {
    active: false,
    parentSedId: '',
    project: null,
    childSeds: [],
    lpConnections: [],
    lpReferences: [],
    lpNetworks: [],
    btRoutes: [],
    assignments: {},
    design: {
      poles: [],
      btLines: [],
      serviceDrops: [],
      pat: [],
      retenidas: [],
      warnings: []
    },
    mechanical: {
      spans: [],
      structures: []
    },
    catalogs: {
      configuracion: null,
      suministros: null
    },
    lpProject: {
      name: '',
      code: '',
      startedAt: '',
      updatedAt: ''
    },
    startedAt: '',
    updatedAt: '',
    mode: null,
    selectedChildId: null,
    selectedClientIds: new Set(),
    editingDropId: null,
    movingPointRef: null,
    tempLpStart: null,
    tempLpKind: 'LP',
    tempLpSpan: 140,
    tempBtPoints: []
  };

  let projectedLayer = null;
  let traceToolbar = null;
  injectProjectedStyles();

  function ensureLayer() {
    if (projectedLayer) return projectedLayer;
    projectedLayer = L.featureGroup().addTo(map);
    projectedLayer.__proyectadasGuiadas = true;
    try {
      if (typeof capaExcel !== 'undefined' && capaExcel?.addLayer) {
        capaExcel.addLayer(projectedLayer);
      }
    } catch (error) {
      console.warn('No se pudo anidar la capa de proyectadas guiadas:', error);
    }
    return projectedLayer;
  }

  async function iniciarProyectadasGuiadas(codigoSED = '') {
    const codigo = String(
      codigoSED ||
      window.transformadorSeleccionado ||
      document.getElementById('inputID')?.value ||
      ''
    ).trim();

    if (!codigo) {
      notify('Seleccione una subestacion/transformador antes de hacer proyectadas.', 'error');
      return;
    }

    try {
      const saved = loadSavedProject(codigo);
      if (saved && await confirmContinueSaved(codigo, saved)) {
        restoreProject(saved);
      } else {
        showLoadingMessage(`Preparando proyectadas para la SED ${codigo}...`);
        state.project = await construirProyectoRedcadDesignerDesdeArcgis(codigo);
        state.parentSedId = state.project.parentSubstationId || codigo;
        state.active = true;
        resetDesign();
        state.startedAt = new Date().toISOString();
        state.updatedAt = state.startedAt;
        saveProject();
      }
      ensureLatestLpRpProjectLoaded();
      renderProjected();
      await showMainMenu();
    } catch (error) {
      console.error(error);
      notify(`No se pudo iniciar proyectadas: ${error.message}`, 'error');
    } finally {
      hideLoadingMessage();
    }
  }

  async function iniciarProyeccionLpMtGeneral() {
    state.active = true;
    if (!state.parentSedId) state.parentSedId = 'LP_RP_GENERAL';
    if (!state.project) {
      state.project = {
        parentSubstationId: state.parentSedId,
        existingNetwork: { clients: [], substations: [], poles: [], btLines: [], mtLpLines: [] }
      };
    }

    await chooseOrCreateLpRpProject();
    if (!state.lpProject?.code) return;
    return showLpRpProjectMenu();
  }

  async function chooseOrCreateLpRpProject() {
    const savedProjects = loadLpRpProjects();
    if (state.lpProject?.code) return;

    if (savedProjects.length) {
      const options = { __new__: 'Crear nuevo proyecto LP/RP' };
      savedProjects.forEach((project, index) => {
        options[project.code] = `Continuar diseno ${index + 1}: ${project.name || project.code} (${project.lpNetworks?.length || 0} trazo/s)`;
      });
      const choose = await modal({
        title: 'Disenos LP/RP guardados',
        html: '<div class="pg-card" style="text-align:left">La red LP/RP es global: se vera para todas las SED proyectadas y servira para alimentar transformadores hijos.</div>',
        input: 'select',
        inputOptions: options,
        inputValue: savedProjects[0]?.code || '__new__',
        showCancelButton: true,
        confirmButtonText: 'Continuar'
      });
      if (!choose.isConfirmed) return;
      if (choose.value !== '__new__') {
        restoreLpRpProject(savedProjects.find((project) => project.code === choose.value));
        renderProjected();
        notify(`Diseno LP/RP cargado: ${state.lpProject.name}`, 'success', 6000);
        return;
      }
    }

    const created = await modal({
      title: 'Crear nuevo proyecto LP/RP',
      html: `
        <div style="text-align:left">
          <div class="pg-card">Este proyecto guardara trazos, nodos fijos, postes intermedios y derivaciones LP/RP.</div>
          <input id="pgLpProjectName" class="swal2-input" value="PROYECTO_LP_RP_${new Date().toISOString().slice(0, 10)}" placeholder="Nombre del proyecto">
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear proyecto',
      preConfirm: () => ({
        name: document.getElementById('pgLpProjectName')?.value.trim() || `PROYECTO_LP_RP_${Date.now()}`
      })
    });
    if (!created.isConfirmed) return;
    state.lpReferences = [];
    state.lpNetworks = [];
    state.lpConnections = [];
    state.lpProject = {
      name: created.value.name,
      code: `${cleanFile(created.value.name)}_${Date.now().toString(36)}`,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveLpRpProject();
    saveProject();
  }

  async function showLpRpProjectMenu() {
    const result = await modal({
      title: `Proyectar LP/RP - ${escapeHtml(state.lpProject?.name || 'sin nombre')}`,
      html: `
        <div style="text-align:left">
          <div class="pg-card">
            <p>Esta opcion es solo para <b>LP/RP</b>. La red queda global y visible para cualquier SED proyectada.</p>
          </div>
          <p><b>Trazos guardados:</b> ${state.lpNetworks.length}</p>
          <p><b>Ultima actualizacion:</b> ${escapeHtml(state.lpProject?.updatedAt || 'N/A')}</p>
          <p style="font-size:12px;color:#64748b">Luego podra conectar una SED hija a uno de estos postes/trazos LP/RP.</p>
        </div>
      `,
      input: 'select',
      inputOptions: {
        manual: 'Trazar LP/RP manual',
        file: 'Subir KMZ/KML LP/RP',
        deleteRoute: 'Eliminar una ruta LP/RP completa',
        deleteAll: 'Eliminar TODO el proyecto LP/RP'
      },
      inputValue: 'manual',
      showCancelButton: true,
      confirmButtonText: 'Continuar',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    if (result.value === 'file') return askLpReference();
    if (result.value === 'manual') return startManualLpReference();
    if (result.value === 'deleteRoute') return deleteLpRpRoute();
    if (result.value === 'deleteAll') return deleteAllLpRpProject();
  }

  async function deleteLpRpRoute() {
    if (!state.lpNetworks.length) {
      notify('No hay rutas LP/RP guardadas para eliminar.', 'info', 6000);
      return showLpRpProjectMenu();
    }
    const options = {};
    state.lpNetworks.forEach((network, index) => {
      const kind = network.kind || 'LP';
      const poles = validPointList(network.poles).length + validPointList(network.fixedNodes).length;
      options[network.id] = `${index + 1}. ${kind} - ${Math.round(lineLength(network.route || []))} m - ${poles} poste(s)`;
    });
    const result = await modal({
      title: 'Eliminar ruta LP/RP',
      html: '<div class="pg-card" style="text-align:left">Se eliminara el conductor/trazo, sus postes/nodos y las conexiones de SED hija que dependan de esa ruta.</div>',
      input: 'select',
      inputOptions: options,
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'Eliminar ruta',
      denyButtonText: 'Volver'
    });
    if (result.isDenied) return showLpRpProjectMenu();
    if (!result.isConfirmed || !result.value) return;
    const network = state.lpNetworks.find((item) => item.id === result.value);
    if (!network) return;
    const confirm = await modal({
      title: 'Confirmar eliminacion',
      text: `Eliminar ${network.kind || 'LP'} completa con sus postes y conductor?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Si, eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!confirm.isConfirmed) return;

    const removedConnections = removeLpConnectionsForNetwork(network);
    state.lpNetworks = state.lpNetworks.filter((item) => item.id !== network.id);
    state.lpReferences = state.lpReferences.filter((item) => item.id !== network.id);
    state.lpProject.updatedAt = new Date().toISOString();
    saveLpRpProject();
    saveProject();
    renderProjected();
    notify(`Ruta ${network.kind || 'LP'} eliminada. Conexiones afectadas: ${removedConnections}.`, 'success', 8000);
  }

  async function deleteAllLpRpProject() {
    if (!state.lpNetworks.length && !state.lpReferences.length) {
      notify('No hay proyecto LP/RP activo para eliminar.', 'info', 6000);
      return;
    }
    const result = await modal({
      title: 'Eliminar TODO LP/RP',
      html: '<div class="pg-card" style="text-align:left">Esto borra todas las rutas LP/RP globales, postes, conductores y alimentaciones a SED hijas. La BT de las SED no se borra, pero quedara sin alimentacion hasta reconectar.</div>',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar todo LP/RP',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    state.lpNetworks = [];
    state.lpReferences = [];
    state.lpConnections = [];
    state.childSeds.forEach((sed) => { sed.connected = false; });
    state.lpProject.updatedAt = new Date().toISOString();
    saveLpRpProject();
    saveProject();
    renderProjected();
    notify('Proyecto LP/RP eliminado completo.', 'success', 7000);
  }

  function removeLpConnectionsForNetwork(network) {
    const networkPoints = [
      ...validPointList(network.fixedNodes),
      ...validPointList(network.poles),
      ...validPointList(network.route)
    ];
    const before = state.lpConnections.length;
    state.lpConnections = state.lpConnections.filter((connection) => {
      const origin = validPointList(connection.points)[0];
      return !origin || !networkPoints.some((point) => distance(origin, point) <= 3);
    });
    const connectedIds = new Set(state.lpConnections.map((connection) => connection.childSedId));
    state.childSeds.forEach((sed) => { sed.connected = connectedIds.has(sed.id); });
    return before - state.lpConnections.length;
  }

  async function deleteLpRpNetworkById(networkId) {
    const network = state.lpNetworks.find((item) => item.id === networkId);
    if (!network) return;
    const result = await modal({
      title: 'Eliminar ruta completa',
      html: `
        <div style="text-align:left">
          <p>Se eliminara esta ruta <b>${escapeHtml(network.kind || 'LP')}</b> completa.</p>
          <p><b>Longitud:</b> ${Math.round(lineLength(network.route || []))} m</p>
          <p><b>Postes/nodos:</b> ${validPointList(network.fixedNodes).length + validPointList(network.poles).length}</p>
          <div class="pg-card">Tambien se quitaran las conexiones de SED hija que dependan de esta ruta.</div>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar directamente',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    const removedConnections = removeLpConnectionsForNetwork(network);
    state.lpNetworks = state.lpNetworks.filter((item) => item.id !== network.id);
    state.lpReferences = state.lpReferences.filter((item) => item.id !== network.id);
    state.lpProject.updatedAt = new Date().toISOString();
    saveLpRpProject();
    saveProject();
    renderProjected();
    notify(`Ruta ${network.kind || 'LP'} eliminada completa. Conexiones afectadas: ${removedConnections}.`, 'success', 8000);
  }

  function normalizeProjectState() {
    state.childSeds = Array.isArray(state.childSeds) ? state.childSeds : [];
    state.lpConnections = Array.isArray(state.lpConnections) ? state.lpConnections : [];
    state.lpReferences = Array.isArray(state.lpReferences) ? state.lpReferences : [];
    state.lpNetworks = Array.isArray(state.lpNetworks) ? state.lpNetworks : [];
    state.btRoutes = Array.isArray(state.btRoutes) ? state.btRoutes : [];
    state.assignments = state.assignments && typeof state.assignments === 'object' ? state.assignments : {};
    state.design = state.design || {};
    state.design.poles = Array.isArray(state.design.poles) ? state.design.poles : [];
    state.design.btLines = Array.isArray(state.design.btLines) ? state.design.btLines : [];
    state.design.serviceDrops = Array.isArray(state.design.serviceDrops) ? state.design.serviceDrops : [];
    state.design.pat = Array.isArray(state.design.pat) ? state.design.pat : [];
    state.design.retenidas = Array.isArray(state.design.retenidas) ? state.design.retenidas : [];
    state.design.warnings = Array.isArray(state.design.warnings) ? state.design.warnings : [];
    state.mechanical = state.mechanical || { spans: [], structures: [] };
    state.mechanical.spans = Array.isArray(state.mechanical.spans) ? state.mechanical.spans : [];
    state.mechanical.structures = Array.isArray(state.mechanical.structures) ? state.mechanical.structures : [];
  }

  function sanitizeProjectGeometry() {
    state.childSeds = state.childSeds.filter(isValidPoint);
    state.lpConnections = state.lpConnections
      .map((line) => ({ ...line, points: validPointList(line.points) }))
      .filter((line) => line.points.length > 1);
    state.lpReferences = state.lpReferences
      .map((line) => ({ ...line, points: validPointList(line.points) }))
      .filter((line) => line.points.length > 1);
    state.lpNetworks = state.lpNetworks.map((network) => {
      const fixedNodes = validPointList(network.fixedNodes);
      const poles = validPointList(network.poles);
      const route = validPointList(network.route);
      return { ...network, fixedNodes, poles, route };
    }).filter((network) => network.route.length > 1 || network.fixedNodes.length > 1);
    state.btRoutes = state.btRoutes
      .map((line) => ({ ...line, points: validPointList(line.points) }))
      .filter((line) => line.points.length > 1);
    state.design.btLines = state.design.btLines
      .map((line) => ({ ...line, points: validPointList(line.points) }))
      .filter((line) => line.points.length > 1);
    state.design.serviceDrops = state.design.serviceDrops
      .map((line) => ({ ...line, points: validPointList(line.points) }))
      .filter((line) => line.points.length > 1);
    state.design.poles = validPointList(state.design.poles);
    state.design.pat = state.design.pat.filter((pat) => isValidPoint(pat.point));
    state.mechanical.spans = state.mechanical.spans.filter((span) => isValidPoint(span.a) && isValidPoint(span.b));
    state.mechanical.structures = state.mechanical.structures.filter((item) => isValidPoint(item.point));
  }

  function isValidPoint(point) {
    return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon));
  }

  function validPointList(points) {
    return (Array.isArray(points) ? points : []).filter(isValidPoint);
  }

  function isRpKind(kind) {
    return String(kind || '').toUpperCase() === 'RP' || String(kind || '').toUpperCase() === 'MT';
  }

  async function showMainMenu() {
    const clientsCount = getClients().length;
    const connected = state.childSeds.filter((sed) => isChildConnected(sed.id)).length;
    const html = `
      <div style="text-align:left">
        <p><b>SED padre:</b> ${escapeHtml(state.parentSedId)}</p>
        <p><b>SED proyectadas:</b> ${state.childSeds.length} | <b>alimentadas por LP/RP:</b> ${connected}</p>
        <p><b>Clientes disponibles:</b> ${clientsCount} | <b>clientes asignados:</b> ${Object.keys(state.assignments).length}</p>
        <p style="font-size:12px;color:#64748b">Flujo BT: crear SED hija -> conectarla a LP/RP global -> seleccionar clientes -> trazar BT -> calcular.</p>
      </div>
    `;
    const result = await modal({
      title: 'Proyectar BT desde SED padre',
      html,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Crear SED hija',
      denyButtonText: 'Asignar clientes',
      cancelButtonText: 'Mas opciones'
    });

    if (result.isConfirmed) return startCreateChildSed();
    if (result.isDenied) return chooseChildForClients();
    if (result.dismiss) return showMoreOptions();
  }

  async function showMoreOptions() {
    const result = await modal({
      title: 'Opciones de proyectadas',
      input: 'select',
      inputOptions: {
        connect: 'Conectar SED hija a LP/RP global',
        clients: 'BT: seleccionar clientes para SED hija',
        bt: 'BT: trazar red principal',
        branch: 'BT: nueva derivacion desde poste',
        finishbt: 'BT: terminar trazo actual',
        catalogs: 'Cargar catalogos RedCAD opcional',
        calc: 'Generar calculo preliminar',
        kmz: 'Descargar KMZ proyectado',
        json: 'Descargar JSON proyectado',
        clean: 'Limpiar SED/BT proyectadas'
      },
      inputPlaceholder: 'Elija una opcion',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || !result.value) return;
    if (result.value === 'connect') return chooseChildForLp();
    if (result.value === 'clients') return chooseChildForClients();
    if (result.value === 'bt') return chooseChildForBt();
    if (result.value === 'branch') return chooseChildForBtBranch();
    if (result.value === 'finishbt') return finishBtRoute();
    if (result.value === 'catalogs') return askOptionalCatalogs();
    if (result.value === 'calc') return askCalculationRules();
    if (result.value === 'kmz') return exportKmz();
    if (result.value === 'json') return exportJson();
    if (result.value === 'clean') {
      resetDesign();
      saveProject();
      renderProjected();
      notify('SED/BT proyectadas limpiadas. La red LP/RP global se mantiene.', 'success');
    }
  }

  async function askOptionalCatalogs() {
    const result = await modal({
      title: 'Catalogos RedCAD opcionales',
      html: `
        <div style="text-align:left">
          <p>Puede cargar estos archivos ahora o despues. No son obligatorios para dibujar proyectadas.</p>
          <label style="display:block;margin:8px 0">Configuracion.xls
            <input id="pgConfigXls" type="file" accept=".xls,.xlsx" class="swal2-file">
          </label>
          <label style="display:block;margin:8px 0">Suministros.XLS
            <input id="pgSuministrosXls" type="file" accept=".xls,.xlsx" class="swal2-file">
          </label>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Cargar',
      preConfirm: async () => {
        const configFile = document.getElementById('pgConfigXls')?.files?.[0] || null;
        const suministrosFile = document.getElementById('pgSuministrosXls')?.files?.[0] || null;
        return {
          configuracion: configFile ? await readWorkbookInfo(configFile) : state.catalogs.configuracion,
          suministros: suministrosFile ? await readWorkbookInfo(suministrosFile) : state.catalogs.suministros
        };
      }
    });
    if (!result.isConfirmed) return;
    state.catalogs = result.value;
    saveProject();
    const names = [state.catalogs.configuracion?.name, state.catalogs.suministros?.name].filter(Boolean).join(' + ');
    notify(names ? `Catalogos registrados: ${names}` : 'No se cargo ningun catalogo.', names ? 'success' : 'info', 7000);
  }

  async function readWorkbookInfo(file) {
    if (!window.XLSX) return { name: file.name, sheets: [], warning: 'XLSX no esta disponible para leer hojas.' };
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const textValues = [];
    const sheetRows = {};
    workbook.SheetNames.forEach((sheetName) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
      sheetRows[sheetName] = rows.slice(0, 300);
      rows.forEach((row) => row.forEach((cell) => {
        const value = String(cell || '').trim();
        if (value) textValues.push(value);
      }));
    });
    return {
      name: file.name,
      sheets: workbook.SheetNames,
      substationTypes: extractSubstationTypes(textValues),
      conductors: extractConductors(textValues),
      sampleRows: sheetRows,
      loadedAt: new Date().toISOString()
    };
  }

  function extractSubstationTypes(values) {
    const found = new Set();
    values.forEach((value) => {
      if (/\d+\s*kVA/i.test(value) && /-\s*[123]\s*[ΦF]/i.test(value)) {
        found.add(value.replace(/\s+/g, ' ').trim());
      }
    });
    const fallback = [
      '5kVA-1Φ-13,2kV/0,22kV',
      '10kVA-1Φ-13,2kV/0,22kV',
      '15kVA-2Φ-10kV-1000',
      '25kVA-2Φ-10kV-1000',
      '40kVA-3Φ-22,9kV-1000',
      '75kVA-3Φ-22,9kV-1000',
      '100kVA-3Φ-22,9kV-1000'
    ];
    return Array.from(found).slice(0, 150).concat(Array.from(found).length ? [] : fallback);
  }

  function extractSubstationTypes(values) {
    const found = new Set();
    values.forEach((value) => {
      const normalized = normalizePhaseText(value);
      if (/\d+\s*kVA/i.test(normalized) && /-\s*[123]\s*(?:F|FASE|FASES|Φ|Ø|O|º)/i.test(normalized)) {
        found.add(normalized);
      }
    });
    return Array.from(found).slice(0, 300).concat(found.size ? [] : defaultSubstationTypes());
  }

  function normalizePhaseText(value) {
    return String(value || '')
      .replace(/Î¦|φ|ϕ|ø|Ø|º/g, 'Φ')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function defaultSubstationTypes() {
    return [
      '5kVA-1Φ-13,2kV/0,22kV',
      '10kVA-1Φ-13,2kV/0,22kV',
      '15kVA-1Φ-13,2kV/0,22kV',
      '25kVA-1Φ-13,2kV/0,22kV',
      '5kVA-2Φ-7,62kV-1000',
      '10kVA-2Φ-7,62kV-1000',
      '15kVA-2Φ-7,62kV-1000',
      '25kVA-2Φ-7,62kV-1000',
      '5kVA-2Φ-10kV-1000',
      '10kVA-2Φ-10kV-1000',
      '15kVA-2Φ-10kV-1000',
      '25kVA-2Φ-10kV-1000',
      '5kVA-2Φ-13,2kV-1000',
      '10kVA-2Φ-13,2kV-1000',
      '15kVA-2Φ-13,2kV-1000',
      '25kVA-2Φ-13,2kV-1000',
      '5kVA-2Φ-22,9kV-1000',
      '10kVA-2Φ-22,9kV-1000',
      '15kVA-2Φ-22,9kV-1000',
      '25kVA-2Φ-22,9kV-1000',
      '10kVA-3Φ-13,2kV-1000',
      '15kVA-3Φ-13,2kV-1000',
      '25kVA-3Φ-13,2kV-1000',
      '40kVA-3Φ-22,9kV-1000',
      '50kVA-3Φ-22,9kV-1000',
      '75kVA-3Φ-22,9kV-1000',
      '100kVA-3Φ-22,9kV-1000'
    ];
  }

  function extractConductors(values) {
    const found = new Set();
    values.forEach((value) => {
      if (/(conductor|cable|aluminio|aaac|caa|mm2|mm²|2x|3x|4x)/i.test(value) && value.length < 120) {
        found.add(value.replace(/\s+/g, ' ').trim());
      }
    });
    return Array.from(found).slice(0, 200);
  }

  async function askLpReference() {
    const result = await modal({
      title: 'LP/RP de referencia',
      html: `
        <div style="text-align:left">
          <p>Puede subir un KMZ/KML de LP/RP o trazarla manualmente en el mapa.</p>
          <input id="pgLpKml" type="file" accept=".kml,.kmz" class="swal2-file">
          <p style="font-size:12px;color:#64748b">Si no sube archivo, se activara el trazo manual.</p>
        </div>
      `,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Cargar archivo',
      denyButtonText: 'Trazar manual'
    });
    if (result.isDenied) return startManualLpReference();
    if (!result.isConfirmed) return;
    const file = document.getElementById('pgLpKml')?.files?.[0] || null;
    if (!file) return startManualLpReference();
    try {
      const refs = await readKmlKmzLines(file);
      state.lpReferences.push(...refs.map((points, index) => ({
        id: `LPREF_${Date.now().toString(36)}_${index + 1}`,
        source: file.name,
        points,
        type: 'lp_reference'
      })));
      saveProject();
      renderProjected();
      state.lpProject.updatedAt = new Date().toISOString();
      saveLpRpProject();
      notify(`LP/RP de referencia cargada: ${refs.length} trazo(s).`, 'success', 7000);
    } catch (error) {
      console.error(error);
      notify(`No se pudo cargar LP/RP: ${error.message}`, 'error', 8000);
    }
  }

  async function startManualLpReference() {
    const result = await modal({
      title: 'Tipo de trazo',
      html: '<div class="pg-card" style="text-align:left">Indique si la referencia que trazara es LP o RP.</div>',
      input: 'select',
      inputOptions: {
        LP: 'LP - Linea primaria',
        RP: 'RP - Red primaria'
      },
      inputValue: state.tempLpKind || 'LP',
      showCancelButton: true,
      confirmButtonText: 'Iniciar trazo'
    });
    if (!result.isConfirmed) return;
    state.tempLpKind = result.value || 'LP';
    state.tempLpSpan = state.tempLpKind === 'RP' ? 140 : 140;
    state.mode = 'draw-lp-reference';
    state.tempBtPoints = [];
    showTraceToolbar(`${state.tempLpKind}: click agrega punto, arrastre puntos para corregir`, {
      undo: undoLpReferencePoint,
      save: () => finishLpReference(),
      cancel: cancelLpReference
    });
    notify(`Trace ${state.tempLpKind}: haga clicks, arrastre puntos si se equivoca, y use Guardar/Cancelar.`, 'info', 12000);
    map.on('click', onLpReferenceClick);
  }

  function onLpReferenceClick(event) {
    if (state.mode !== 'draw-lp-reference') return;
    state.tempBtPoints.push(latLngToPoint(event.latlng));
    renderProjected();
  }

  function cancelLpReference() {
    map.off('click', onLpReferenceClick);
    state.tempBtPoints = [];
    state.mode = null;
    hideTraceToolbar();
    renderProjected();
    notify('Trazo LP/RP cancelado.', 'info', 5000);
  }

  function undoLpReferencePoint() {
    if (state.mode !== 'draw-lp-reference') return;
    state.tempBtPoints.pop();
    renderProjected();
  }

  function injectProjectedStyles() {
    if (document.getElementById('proyectadasGuiadasStyles')) return;
    const style = document.createElement('style');
    style.id = 'proyectadasGuiadasStyles';
    style.textContent = `
      .pg-modal {
        border-radius: 14px !important;
        padding: 0 0 18px !important;
        box-shadow: 0 22px 70px rgba(15, 23, 42, 0.28) !important;
      }
      .pg-title {
        color: #0f172a !important;
        font-size: 24px !important;
        font-weight: 800 !important;
      }
      .pg-html {
        color: #334155 !important;
        font-size: 14px !important;
      }
      .pg-confirm {
        border-radius: 8px !important;
        background: #2563eb !important;
        font-weight: 800 !important;
      }
      .pg-deny {
        border-radius: 8px !important;
        background: #0f766e !important;
        font-weight: 800 !important;
      }
      .pg-cancel {
        border-radius: 8px !important;
        background: #64748b !important;
        font-weight: 800 !important;
      }
      .pg-card {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px;
        background: #f8fafc;
        margin: 8px 0;
      }
      .pg-trace-toolbar {
        position: fixed;
        left: 50%;
        bottom: 20px;
        transform: translateX(-50%);
        z-index: 1600;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        align-items: center;
        padding: 10px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.94);
        color: #fff;
        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.28);
      }
      .pg-trace-toolbar button {
        border: 0;
        border-radius: 8px;
        padding: 8px 10px;
        color: #fff;
        background: #2563eb;
        font-weight: 800;
        cursor: pointer;
      }
      .pg-trace-toolbar button.pg-danger {
        background: #dc2626;
      }
      .pg-trace-toolbar button.pg-muted {
        background: #64748b;
      }
    `;
    document.head.appendChild(style);
  }

  function finishLpReference(event) {
    if (event?.originalEvent) L.DomEvent.stop(event);
    map.off('click', onLpReferenceClick);
    if (state.tempBtPoints.length > 1) return saveLpReferenceWithNodes();
    state.tempBtPoints = [];
    state.mode = null;
    hideTraceToolbar();
    renderProjected();
  }

  async function saveLpReferenceWithNodes() {
    const kind = state.tempLpKind || 'LP';
    const result = await modal({
      title: `Guardar trazo ${kind}`,
      html: `
        <div class="pg-card" style="text-align:left">
          <p>Los puntos que marcaste seran <b>nodos fijos</b> del trazo.</p>
          <p>Si entre dos nodos hay mucha distancia, el programa insertara postes intermedios segun la distancia promedio.</p>
        </div>
        <input id="pgLpSpan" class="swal2-input" type="number" min="30" value="${state.tempLpSpan || 140}" placeholder="Distancia promedio entre postes (m)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar con postes',
      preConfirm: () => ({
        span: numberFromInput('pgLpSpan', kind === 'RP' ? 120 : 140)
      })
    });
    if (!result.isConfirmed) return;
    const fixedNodes = state.tempBtPoints.map((point, index) => ({
      ...point,
      id: `${kind}_NODO_${Date.now().toString(36)}_${index + 1}`,
      fixed: true,
      role: 'nodo_fijo'
    }));
    const network = buildLpNetworkFromNodes(fixedNodes, result.value.span, kind);
    state.lpReferences.push({
      id: network.id,
      source: 'trazo_manual',
      kind,
      spanMeters: result.value.span,
      points: fixedNodes,
      type: 'lp_reference'
    });
    state.lpNetworks.push(network);
    state.lpProject.updatedAt = new Date().toISOString();
    saveLpRpProject();
    saveProject();
    state.tempBtPoints = [];
    state.mode = null;
    hideTraceToolbar();
    renderProjected();
    notify(`${kind} guardada: ${fixedNodes.length} nodos fijos y ${network.poles.length} postes intermedios/listos para derivaciones.`, 'success', 9000);
  }

  async function startCreateChildSed() {
    state.mode = 'create-child';
    map.getContainer().style.cursor = 'crosshair';
    notify('Haga click en el mapa donde ubicara la subestacion proyectada hija.', 'info', 9000);
    map.once('click', async (event) => {
      map.getContainer().style.cursor = '';
      const info = await modal({
        title: 'Datos de SED proyectada',
        html: `
          <div style="text-align:left;margin-bottom:8px">
            <p><b>SED padre existente:</b> ${escapeHtml(parentSedLabel())}</p>
            <p style="font-size:12px;color:#64748b">La SED que esta creando sera hija/proyectada de esta subestacion padre.</p>
          </div>
          <input id="pgSedName" class="swal2-input" placeholder="Nombre SED hija proyectada" value="HIJA_${state.parentSedId}_${state.childSeds.length + 1}">
          <input id="pgSedKva" class="swal2-input" placeholder="Capacidad kVA (opcional)" type="number" min="0">
        `,
        focusConfirm: false,
        showCancelButton: true,
        preConfirm: () => ({
          name: document.getElementById('pgSedName').value.trim() || `SED_PROY_${state.childSeds.length + 1}`,
          capacityKva: Number(document.getElementById('pgSedKva').value || 0)
        })
      });
      if (!info.isConfirmed) return;
      const point = latLngToPoint(event.latlng);
      state.childSeds.push({
        id: `SEDP_${Date.now().toString(36)}_${state.childSeds.length + 1}`,
        parentId: state.parentSedId,
        name: info.value.name,
        capacityKva: info.value.capacityKva,
        connected: false,
        ...point
      });
      saveProject();
      renderProjected();
      notify('SED hija creada. Ahora puede conectarla a una LP/RP global o configurar sus clientes.', 'success', 7000);
      showMainMenu();
    });
  }

  async function chooseChildForLp() {
    const child = await chooseChildSed('Seleccione la SED hija que recibira LP/RP', 'La alimentacion debe venir de un poste/trazo LP/RP global.');
    if (!child) return;
    return connectSpecificChildLp(child);
  }

  function connectSpecificChildLp(child) {
    state.selectedChildId = child.id;
    state.mode = 'lp-start';
    notify('Seleccione con click el poste o punto de LP/RP de origen.', 'info', 9000);
    map.once('click', (event) => {
      state.tempLpStart = latLngToPoint(event.latlng);
      state.mode = 'lp-end';
      notify('Ahora haga click sobre la SED proyectada o punto final de llegada LP/RP.', 'info', 9000);
      map.once('click', () => {
        const target = state.childSeds.find((sed) => sed.id === state.selectedChildId);
        if (!target) return;
        state.lpConnections.push({
          id: `LPRP_${Date.now().toString(36)}`,
          childSedId: target.id,
          points: [state.tempLpStart, target],
          type: 'lp_rp_connection'
        });
        target.connected = true;
        state.tempLpStart = null;
        saveProject();
        renderProjected();
        notify('Llegada LP/RP conectada. La SED proyectada queda habilitada para BT.', 'success', 8000);
        chooseChildForClients();
      });
    });
  }

  async function deleteChildLpRpConnection(child) {
    const nearbyNetworks = state.lpNetworks.filter((network) => routeTouchesPoint(network, child, 8));
    const result = await modal({
      title: 'Eliminar llegada LP/RP',
      html: `
        <div style="text-align:left">
          <p><b>SED hija:</b> ${escapeHtml(child.name)}</p>
          <div class="pg-card">
            Puede quitar solo la alimentacion de esta SED, o tambien borrar el trazo LP/RP que nace junto a ella.
          </div>
          <p><b>Rutas LP/RP cerca de esta SED:</b> ${nearbyNetworks.length}</p>
        </div>
      `,
      showDenyButton: nearbyNetworks.length > 0,
      showCancelButton: true,
      confirmButtonText: 'Solo desconectar SED',
      denyButtonText: 'Desconectar y borrar trazo cercano',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed && !result.isDenied) return;

    const removedConnections = removeConnectionsByChild(child.id);
    let removedNetworks = 0;
    if (result.isDenied) {
      const ids = new Set(nearbyNetworks.map((network) => network.id));
      state.lpNetworks = state.lpNetworks.filter((network) => !ids.has(network.id));
      state.lpReferences = state.lpReferences.filter((line) => !ids.has(line.id));
      removedNetworks = ids.size;
    }
    child.connected = false;
    state.lpProject.updatedAt = new Date().toISOString();
    saveLpRpProject();
    saveProject();
    renderProjected();
    notify(`Llegada LP/RP eliminada. Conexiones: ${removedConnections}. Rutas borradas: ${removedNetworks}.`, 'success', 8000);
  }

  function removeConnectionsByChild(childSedId) {
    const before = state.lpConnections.length;
    state.lpConnections = state.lpConnections.filter((connection) => connection.childSedId !== childSedId);
    return before - state.lpConnections.length;
  }

  function routeTouchesPoint(network, point, toleranceMeters = 8) {
    return [
      ...validPointList(network.fixedNodes),
      ...validPointList(network.poles),
      ...validPointList(network.route)
    ].some((item) => distance(item, point) <= toleranceMeters);
  }

  async function chooseChildForClients() {
    const child = await chooseChildSed('Seleccione SED hija para asignar clientes', 'Los clientes seleccionados pasaran de la SED padre a esta SED hija/proyectada.');
    if (!child) return;
    return chooseChildForClientsFixed(child);
  }

  async function chooseChildForClientsFixed(child) {
    if (!isChildConnected(child.id)) {
      notify('Primero conecte la SED hija con LP/RP. Sin llegada de energia no se habilita BT.', 'error', 9000);
      return chooseChildForLp();
    }
    const clients = getClients();
    if (!clients.length) {
      notify('No hay suministros cargados. Puede cargar red completa ArcGIS o agregar clientes despues.', 'error');
      return;
    }

    const result = await modal({
      title: 'Asignar clientes',
      html: `
        <div style="text-align:left">
          <p>SED: <b>${escapeHtml(child.name)}</b></p>
          <p>Puede asignar automatico por cercania o seleccionar manualmente en mapa.</p>
        </div>
      `,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Automatico cercano',
      denyButtonText: 'Manual en mapa',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      assignNearestClients(child);
      refreshServiceDrops({ dropMax: currentDropMax() });
      saveProject();
      renderProjected();
      notify('Clientes cercanos asignados a la SED hija.', 'success');
      return chooseChildForBt();
    }
    if (result.isDenied) return startManualClientSelection(child);
  }

  function excludeClientsFromChild(child) {
    const assigned = assignedClients(child.id);
    if (!assigned.length) {
      notify('Esta SED hija no tiene clientes asignados.', 'info');
      return;
    }
    state.selectedChildId = child.id;
    state.mode = 'manual-clients';
    state.selectedClientIds = new Set(assigned.map((client) => client.id));
    renderProjected();
    notify('Modo exclusion: haga click en los clientes verdes para quitarlos de esta SED.', 'info', 12000);
  }

  function assignNearestClients(child) {
    const clients = getClients();
    clients.forEach((client) => {
      const nearestChild = nearestPoint(client, state.childSeds);
      if (nearestChild?.id === child.id) {
        state.assignments[client.id] = child.id;
      }
    });
  }

  function startManualClientSelection(child) {
    state.selectedChildId = child.id;
    state.mode = 'manual-clients';
    state.selectedClientIds = new Set(Object.entries(state.assignments).filter(([, sedId]) => sedId === child.id).map(([clientId]) => clientId));
    renderProjected();
    notify('Modo manual: haga click en suministros para agregarlos/quitar. Luego vuelva a Hacer proyecciones > Trazar ruta BT.', 'info', 12000);
  }

  async function chooseChildForBt() {
    const child = await chooseChildSed('Seleccione SED hija para trazar BT', 'Solo se puede trazar BT si la SED hija ya tiene llegada LP/RP.');
    if (!child) return;
    return chooseChildForBtFixed(child);
  }

  function chooseChildForBtFixed(child) {
    if (!isChildConnected(child.id)) {
      notify('Debe conectar primero la llegada LP/RP antes de trazar BT.', 'error', 9000);
      return chooseChildForLp();
    }
    const assigned = assignedClients(child.id);
    if (!assigned.length) {
      notify('Primero asigne clientes a esta SED hija.', 'error', 9000);
      return chooseChildForClients();
    }
    state.selectedChildId = child.id;
    state.tempBtPoints = [child];
    state.mode = 'draw-bt';
    showBtTraceToolbar();
    renderProjected();
    notify('Trace BT: cada click crea un poste por defecto. Use la barra inferior para guardar, cancelar o iniciar otra derivacion.', 'info', 14000);
    map.on('click', onBtClick);
    map.once('dblclick', finishBtRoute);
  }

  async function chooseChildForBtBranch() {
    const child = await chooseChildSed('Seleccione SED hija para derivacion BT', 'Luego haga click en un poste/punto azul de una BT ya trazada.');
    if (!child) return;
    if (!isChildConnected(child.id)) {
      notify('Debe conectar primero la llegada LP/RP antes de derivar BT.', 'error', 9000);
      return chooseChildForLp();
    }
    state.selectedChildId = child.id;
    state.mode = 'select-bt-branch-start';
    renderProjected();
    notify('Seleccione el poste intermedio o punto BT desde donde saldra la derivacion.', 'info', 12000);
  }

  function startBtBranchFromPoint(point) {
    point.hasDerivation = true;
    point.armado = point.manualArmado || 'DERIVACION';
    state.tempBtPoints = [point];
    state.mode = 'draw-bt';
    showBtTraceToolbar();
    renderProjected();
    notify('Derivacion BT iniciada. Cada click agrega un poste. Use la barra inferior para guardar o cancelar.', 'info', 12000);
    map.on('click', onBtClick);
    map.once('dblclick', finishBtRoute);
  }

  function onBtClick(event) {
    if (state.mode !== 'draw-bt') return;
    state.tempBtPoints.push(latLngToPoint(event.latlng));
    saveProject();
    renderProjected();
  }

  async function finishBtRoute(event = null, options = {}) {
    if (event?.originalEvent) L.DomEvent.stop(event);
    map.off('click', onBtClick);
    map.off('dblclick', finishBtRoute);
    const points = validPointList(state.tempBtPoints);
    if (points.length < 2) {
      notify('Ruta BT cancelada: necesita al menos dos puntos.', 'error');
      state.tempBtPoints = [];
      state.mode = null;
      hideTraceToolbar();
      renderProjected();
      return false;
    }
    const spanResult = await modal({
      title: 'Guardar red BT',
      html: `
        <div class="pg-card" style="text-align:left">
          <p>Indique el <b>vano promedio BT</b>. Si entre dos puntos marcados hay mas distancia, el programa colocara postes intermedios automaticamente.</p>
        </div>
        <input id="pgBtSaveSpan" class="swal2-input" type="number" min="20" value="70" placeholder="Vano promedio BT (m)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar BT',
      cancelButtonText: 'Volver al trazo',
      preConfirm: () => ({
        span: numberFromInput('pgBtSaveSpan', 70)
      })
    });
    if (!spanResult.isConfirmed) {
      map.on('click', onBtClick);
      map.once('dblclick', finishBtRoute);
      showBtTraceToolbar();
      return false;
    }
    const spanMeters = spanResult.value.span || 70;
    const densifiedPoints = densifyFullRoute(points, spanMeters).map((point, index) => ({
      ...point,
      id: point.id || `PBT_REF_${Date.now().toString(36)}_${index}`,
      role: index === 0 ? 'origen_sed' : 'poste_bt',
      spanMeters
    }));
    state.btRoutes.push({
      id: `BTREF_${Date.now().toString(36)}`,
      childSedId: state.selectedChildId,
      points: densifiedPoints,
      spanMeters,
      phaseMode: state.childSeds.find((sed) => sed.id === state.selectedChildId)?.phaseMode || '',
      conductor: state.childSeds.find((sed) => sed.id === state.selectedChildId)?.conductor || null,
      type: 'bt_reference'
    });
    state.tempBtPoints = [];
    state.mode = null;
    hideTraceToolbar();
    refreshServiceDrops({ dropMax: 25 });
    saveProject();
    renderProjected();
    notify('Referencia BT guardada. Ahora puede generar calculo preliminar o iniciar otra derivacion.', 'success', 9000);
    if (options.nextBranch) setTimeout(() => chooseChildForBtBranch(), 250);
    return true;
  }

  function cancelBtRoute() {
    map.off('click', onBtClick);
    map.off('dblclick', finishBtRoute);
    state.tempBtPoints = [];
    state.mode = null;
    hideTraceToolbar();
    renderProjected();
    notify('Trazo BT cancelado. No se guardo esa ruta.', 'info', 6000);
  }

  function undoBtRoutePoint() {
    if (state.mode !== 'draw-bt') return;
    if (state.tempBtPoints.length <= 1) {
      notify('El primer punto es el origen de la BT y no se borra con deshacer. Use Cancelar si quiere salir.', 'info', 6000);
      return;
    }
    state.tempBtPoints.pop();
    saveProject();
    renderProjected();
  }

  function finishBtAndStartBranch() {
    finishBtRoute(null, { nextBranch: true });
  }

  async function askCalculationRules() {
    if (!state.childSeds.length) {
      notify('Primero cree SED proyectadas.', 'error');
      return;
    }
    const disconnected = state.childSeds.filter((sed) => !isChildConnected(sed.id));
    if (disconnected.length) {
      notify('Hay SED proyectadas sin llegada LP/RP. Conectelas antes del calculo.', 'error', 10000);
      return chooseChildForLp();
    }

    const result = await modal({
      title: 'Parametros de calculo preliminar',
      html: `
        <input id="pgBtSpan" class="swal2-input" type="number" value="70" placeholder="Vano maximo BT (m)">
        <input id="pgMtSpan" class="swal2-input" type="number" value="140" placeholder="Vano maximo LP/RP (m)">
        <input id="pgDrop" class="swal2-input" type="number" value="25" placeholder="Acometida maxima (m)">
        <input id="pgFall" class="swal2-input" type="number" value="5" placeholder="Caida maxima permitida (%)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Calcular',
      preConfirm: () => ({
        btSpan: numberFromInput('pgBtSpan', 70),
        mtSpan: numberFromInput('pgMtSpan', 140),
        dropMax: numberFromInput('pgDrop', 25),
        voltageDropMax: numberFromInput('pgFall', 5)
      })
    });
    if (!result.isConfirmed) return;
    generateDesign(result.value);
  }

  function generateDesign(rules) {
    state.design = { poles: [], btLines: [], serviceDrops: [], pat: [], retenidas: [], warnings: [] };

    state.childSeds.forEach((sed) => {
      state.design.pat.push({ id: `PAT_${sed.id}`, point: sed, childSedId: sed.id, reason: 'PAT en subestacion proyectada' });
      const refs = state.btRoutes.filter((route) => route.childSedId === sed.id);
      refs.forEach((route) => {
        const span = Math.min(route.spanMeters || rules.btSpan, rules.btSpan);
        route.points = densifyFullRoute(route.points, span).map((point, index) => ({
          ...point,
          id: point.id || `PBT_${sed.id}_${route.id}_${index}`,
          childSedId: sed.id,
          armado: point.manualArmado || point.armado || classifyPointArmado(route.points, point),
          mecanico: point.manualMecanico || point.mecanico || 'CALCULO PRELIMINAR',
          spanMeters: span
        }));
        state.design.btLines.push({ id: `BT_${route.id}`, childSedId: sed.id, points: route.points, type: 'bt' });
        if (route.points.length > 1) {
          state.design.retenidas.push({ id: `RET_INI_${route.id}`, point: route.points[1], reason: 'inicio/terminal BT' });
          state.design.retenidas.push({ id: `RET_FIN_${route.id}`, point: route.points[route.points.length - 1], reason: 'terminal BT' });
        }
      });

    });

    refreshServiceDrops(rules, { collectWarnings: true });
    estimateVoltageDrop(rules);
    saveProject();
    renderProjected();
    showCalculationSummary(rules);
  }

  function refreshServiceDrops(rules = {}, options = {}) {
    const dropMax = rules.dropMax || 25;
    const previous = new Map((state.design.serviceDrops || []).map((drop) => [drop.clientId, drop]));
    state.design.serviceDrops = [];
    state.childSeds.forEach((sed) => {
      const btRoutePoles = state.btRoutes
        .filter((route) => route.childSedId === sed.id)
        .flatMap((route) => validPointList(route.points).slice(1));
      const candidatePoles = btRoutePoles.length ? btRoutePoles : (state.design.poles || []).filter((pole) => pole.childSedId === sed.id);
      assignedClients(sed.id).forEach((client) => {
        const manual = previous.get(client.id);
        const source = manual?.manualSource || nearestPoint(client, candidatePoles) || sed;
        const length = manual?.manualLength || distance(source, client);
        const overLimit = length > dropMax;
        state.design.serviceDrops.push({
          id: `ACO_${client.id}`,
          childSedId: sed.id,
          clientId: client.id,
          points: [source, client],
          sourcePointId: source.id || '',
          length,
          dropMax,
          overLimit,
          manualLength: manual?.manualLength || null,
          manualSource: manual?.manualSource || null
        });
        if (overLimit && options.collectWarnings && state.design.warnings) {
          state.design.warnings.push(`Acometida ${client.id}: ${Math.round(length)} m supera ${dropMax} m.`);
        }
      });
    });
  }

  function currentDropMax() {
    const known = (state.design.serviceDrops || []).find((drop) => Number.isFinite(Number(drop.dropMax)))?.dropMax;
    return Number(known) > 0 ? Number(known) : 25;
  }

  function pruneServiceDropsWithoutAssignment() {
    if (!Array.isArray(state.design.serviceDrops) || !state.design.serviceDrops.length) return;
    state.design.serviceDrops = state.design.serviceDrops.filter((drop) => state.assignments[drop.clientId] === drop.childSedId);
  }

  function estimateVoltageDrop(rules) {
    const totalBt = state.btRoutes.reduce((sum, line) => sum + lineLength(line.points), 0);
    const estimated = totalBt ? Math.min(18, (totalBt / 1000) * 3.2) : 0;
    state.design.voltageDropPct = Number(estimated.toFixed(2));
    if (estimated > rules.voltageDropMax) {
      state.design.warnings.push(`Caida preliminar ${estimated.toFixed(2)}% supera ${rules.voltageDropMax}%. Evaluar conductor mayor o dividir SED.`);
    }
    state.design.warnings.push('Calculo mecanico/electrico preliminar: requiere catalogos Configuracion.xls y Suministros.XLS para seleccionar armados/conductores reales.');
  }

  async function showCalculationSummary(rules) {
    await modal({
      title: 'Resultado preliminar',
      icon: state.design.warnings.length ? 'warning' : 'success',
      html: `
        <div style="text-align:left">
          <p><b>Postes BT proyectados:</b> ${state.btRoutes.reduce((sum, route) => sum + Math.max(0, validPointList(route.points).length - 1), 0)}</p>
          <p><b>Tramos BT:</b> ${state.btRoutes.length}</p>
          <p><b>Acometidas:</b> ${state.design.serviceDrops.length}</p>
          <p><b>PAT:</b> ${state.design.pat.length}</p>
          <p><b>Retenidas:</b> ${state.design.retenidas.length}</p>
          <p><b>Caida preliminar:</b> ${state.design.voltageDropPct || 0}%</p>
          <p><b>Reglas:</b> BT ${rules.btSpan} m, LP/RP ${rules.mtSpan} m, acometida ${rules.dropMax} m.</p>
          ${state.design.warnings.length ? `<hr><b>Advertencias:</b><ul>${state.design.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
        </div>
      `,
      confirmButtonText: 'Aceptar'
    });
  }

  function renderProjected() {
    const layer = ensureLayer();
    const draft = L.featureGroup();
    try {
      normalizeProjectState();
      sanitizeProjectGeometry();
      pruneServiceDropsWithoutAssignment();
      updateMechanicalModel();
      state.lpReferences.forEach((line) => addPolyline(line.points, isRpKind(line.kind) ? '#dc2626' : '#f97316', 3, `${line.kind || 'LP'} referencia`, draft, '8 6'));
      state.lpNetworks.forEach((network) => {
        const lpLine = addPolyline(network.route, isRpKind(network.kind) ? '#b91c1c' : '#ea580c', 4, `${network.kind} proyectada con postes`, draft);
        if (lpLine) lpLine.on('click', () => openLpRpRouteActions(network.id));
        network.fixedNodes.forEach((node) => {
          renderDraggableProjectedPoint(draft, node, {
            network: network.kind,
            source: 'lp-node',
            networkId: network.id,
            label: `${network.kind} nodo fijo`,
            color: '#111827',
            fillColor: isRpKind(network.kind) ? '#fecaca' : '#fed7aa',
            size: 16
          });
        });
        network.poles.forEach((pole) => {
          renderDraggableProjectedPoint(draft, pole, {
            network: network.kind,
            source: 'lp-pole',
            networkId: network.id,
            label: `${network.kind} poste intermedio`,
            color: isRpKind(network.kind) ? '#991b1b' : '#9a3412',
            fillColor: '#fff7ed',
            size: 14
          });
        });
      });
      // La conexion LP/RP se guarda como relacion tecnica y pone la SED en verde.
      // No se dibuja una linea extra para evitar duplicar visualmente la LP/RP existente.
      state.btRoutes.forEach((line) => {
        const polyline = addPolyline(line.points, '#2563eb', 3, 'Referencia BT', draft, '6 5');
        if (polyline) polyline.on('click', () => openBtRouteActions(line.id));
      });
      if (state.tempBtPoints.length > 1) addPolyline(state.tempBtPoints, '#60a5fa', 2, 'BT temporal', draft, '4 6');
      renderBtReferencePoles(draft);
      renderTempBtPoles(draft);
      state.design.serviceDrops.forEach((line) => {
        const color = line.overLimit ? '#dc2626' : '#9333ea';
        const polyline = addPolyline(line.points, color, line.overLimit ? 3 : 2, `Acometida ${Math.round(line.length || 0)} m`, draft, '3 5');
        if (polyline) {
          polyline.on('click', () => openServiceDropActions(line.id));
          polyline.bindTooltip(`Acometida ${Math.round(line.length || 0)} m${line.overLimit ? ' - supera 25 m' : ''}`);
        }
      });

      state.design.pat.forEach((pat) => {
        L.circleMarker([pat.point.lat, pat.point.lon], { radius: 5, color: '#065f46', fillColor: '#a7f3d0', fillOpacity: 1, weight: 2 })
          .bindTooltip('PAT')
          .addTo(draft);
      });

      renderMechanical(draft);
      renderAssignedClientMarkers(draft);
      renderManualClientMarkers(draft);
      renderChildSubstations(draft);
      layer.clearLayers();
      draft.getLayers().forEach((item) => item.addTo(layer));
      actualizarEstadisticas?.();
    } catch (error) {
      console.error('No se pudo redibujar proyectadas, se conserva la capa anterior:', error);
      notify(`Error al redibujar proyectadas: ${error.message}`, 'error', 9000);
    }
  }

  function renderChildSubstations(layer) {
    state.childSeds.forEach((sed) => {
      const marker = L.circleMarker([sed.lat, sed.lon], {
        radius: 12,
        color: sed.connected ? '#065f46' : '#dc2626',
        fillColor: sed.connected ? '#22c55e' : '#f97316',
        fillOpacity: 0.95,
        weight: 4,
        pane: 'markerPane'
      }).bindPopup(`<b>${escapeHtml(sed.name)}</b><br>Padre: ${escapeHtml(sed.parentId)}<br>${sed.connected ? 'Conectada LP/RP' : 'Sin llegada LP/RP'}<br><small>Click: opciones de esta SED hija</small>`);
      marker.on('click', () => openChildSedActions(sed.id));
      marker.addTo(layer);
      marker.bringToFront?.();
    });
  }

  function renderBtReferencePoles(layer) {
    state.btRoutes.forEach((route) => {
      validPointList(route.points).forEach((point, index) => {
        if (index === 0) return;
        renderDraggableProjectedPoint(layer, point, {
          network: 'BT',
          source: 'bt-route',
          routeId: route.id,
          pointIndex: index,
          childSedId: route.childSedId,
          label: `Poste BT referencia ${index}${point.armado ? ` | ${point.armado}` : ''}`,
          color: '#1d4ed8',
          fillColor: '#bfdbfe',
          size: 14
        });
      });
    });
  }

  function renderDraggableProjectedPoint(layer, point, context = {}) {
    if (!isValidPoint(point)) return null;
    const size = Math.max(context.size || 14, 18);
    const iconSize = size + 12;
    const marker = L.marker([point.lat, point.lon], {
      draggable: true,
      riseOnHover: true,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: 'pg-draggable-point',
        html: `
          <div title="Click: opciones | Arrastre: mover poste" style="
            width:${iconSize}px;height:${iconSize}px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            background:rgba(255,255,255,.02);cursor:grab">
            <div style="width:${size}px;height:${size}px;border-radius:50%;background:${context.fillColor || '#e5e7eb'};border:3px solid ${context.color || '#111827'};box-shadow:0 2px 9px rgba(15,23,42,.38)"></div>
          </div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize / 2, iconSize / 2]
      })
    });
    marker.bindTooltip(projectedPointTooltip(point, context), { direction: 'top', sticky: true });
    const openActions = (event) => {
      if (event?.originalEvent) L.DomEvent.stop(event);
      if (state.mode === 'select-service-source') return assignDropManualSource(point);
      if (state.mode === 'select-bt-branch-start' && context.source === 'bt-route' && context.childSedId === state.selectedChildId) {
        return startBtBranchFromPoint(point);
      }
      return openProjectedPointActions(point, context);
    };
    marker.on('click', openActions);
    marker.on('contextmenu', openActions);
    marker.on('dragend', (event) => {
      moveProjectedPointToLatLng(point, event.target.getLatLng());
    });
    marker.addTo(layer);
    return marker;
  }

  function projectedPointTooltip(point, context = {}) {
    const armado = displayArmadoName(point, context);
    const mecanico = point.manualMecanico || point.mecanico || 'Preliminar';
    return `${context.label || point.id || 'Poste'} | ${armado} | ${mecanico}`;
  }

  function renderMechanical(layer) {
    (state.mechanical.spans || []).forEach((span) => {
      if (!isValidPoint(span.a) || !isValidPoint(span.b)) return;
      const mid = midpoint(span.a, span.b);
      L.marker([mid.lat, mid.lon], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div style="padding:2px 5px;border-radius:6px;background:rgba(15,23,42,.78);color:white;font-size:11px;white-space:nowrap">${Math.round(span.length)} m</div>`,
          iconSize: [52, 18],
          iconAnchor: [26, 9]
        })
      }).addTo(layer);
    });

    // Los armados se muestran en el tooltip/modal del poste real.
    // No se dibuja otro circulo encima para no bloquear el arrastre ni confundir el click.
  }

  function updateMechanicalModel() {
    const spans = [];
    const structures = [];
    const networks = [];

    state.lpNetworks.forEach((network) => networks.push({ network: network.kind || 'LP', points: validPointList(network.route) }));
    state.btRoutes.forEach((line) => networks.push({ network: 'BT', points: validPointList(line.points) }));

    networks.forEach((line) => {
      const points = validPointList(line.points);
      points.forEach((point, index) => {
        const prev = points[index - 1];
        const next = points[index + 1];
        if (next) {
          spans.push({
            network: line.network,
            a: point,
            b: next,
            length: distance(point, next)
          });
        }
        structures.push({
          network: line.network,
          point,
          armado: point.manualArmado || point.armado || (line.network === 'BT' && isBtDerivationPoint(point) ? 'DERIVACION' : classifyArmado(prev, point, next)),
          mecanico: point.manualMecanico || point.mecanico || (line.network === 'BT' && isBtDerivationPoint(point) ? 'RETENIDA DERIVACION' : classifyMechanical(prev, point, next))
        });
      });
    });

    state.childSeds.forEach((sed) => {
      structures.push({
        network: 'SED',
        point: sed,
        armado: 'SUBESTACION',
        mecanico: sed.connected ? 'ALIMENTADA' : 'PENDIENTE LP/RP'
      });
    });

    state.mechanical = { spans, structures };
  }

  function classifyArmado(prev, point, next) {
    if (!prev && !next) return 'PUNTO';
    if (!prev || !next) return 'TERMINAL';
    const angle = deflectionAngle(prev, point, next);
    if (angle >= 35) return 'ANGULO FUERTE';
    if (angle >= 12) return 'ANGULO';
    return 'ALINEAMIENTO';
  }

  function classifyMechanical(prev, point, next) {
    if (!prev || !next) return 'RETENIDA TERMINAL';
    const angle = deflectionAngle(prev, point, next);
    if (angle >= 35) return 'RETENIDA + ARMADO ANGULO';
    if (angle >= 12) return 'ARMADO ANGULO';
    return 'ARMADO SIMPLE';
  }

  function classifyPointArmadoFromContext(point, context = {}) {
      if (context.source === 'bt-route') {
        const route = state.btRoutes.find((item) => item.id === context.routeId);
        if (isBtDerivationPoint(point)) return 'DERIVACION';
        return classifyPointArmado(route?.points || [], point);
      }
      if (context.source === 'design-pole') {
        return point.armado || point.manualArmado || 'ALINEAMIENTO';
      }
    if (context.source === 'lp-node' || context.source === 'lp-pole') {
      const network = state.lpNetworks.find((item) => item.id === context.networkId);
      return classifyPointArmado(network?.route || [], point);
    }
    return point.armado || 'ALINEAMIENTO';
  }

  function classifyPointArmado(points, point) {
    if (isBtDerivationPoint(point)) return 'DERIVACION';
    const index = validPointList(points).findIndex((item) => item === point || (item.id && item.id === point.id));
    const valid = validPointList(points);
    const pos = index >= 0 ? index : valid.findIndex((item) => distance(item, point) < 0.2);
    if (pos < 0) return point.armado || 'ALINEAMIENTO';
    return classifyArmado(valid[pos - 1], valid[pos], valid[pos + 1]);
  }

  function isBtDerivationPoint(point) {
    if (!point) return false;
    if (point.hasDerivation || String(point.armado || '').toUpperCase().includes('DERIV')) return true;
    const key = pointKey(point);
    let degree = 0;
    state.btRoutes.forEach((route) => {
      const points = validPointList(route.points);
      points.forEach((item, index) => {
        if (pointKey(item) !== key) return;
        if (points[index - 1]) degree += 1;
        if (points[index + 1]) degree += 1;
      });
    });
    return degree > 2;
  }

  function pointKey(point) {
    if (point?.id) return `id:${point.id}`;
    return `${round(point?.lat || 0, 7)},${round(point?.lon || 0, 7)}`;
  }

  function lookupArmadoDetail(armado, network) {
    const catalogInfo = [
      state.catalogs.configuracion?.name,
      state.catalogs.suministros?.name
    ].filter(Boolean).join(' + ');
    const upper = String(armado || '').toUpperCase();
    const isTerminal = upper.includes('TERMINAL');
    const isStrongAngle = upper.includes('FUERTE');
    const isAngle = upper.includes('ANGULO');
    const isSed = upper.includes('SUBESTACION') || network === 'SED';
    const isBt = network === 'BT';
    return {
      altura: isSed ? 'Segun tipo de subestacion del catalogo' : isBt ? '8 m referencial BT RS' : '12 m referencial',
      estructura: isSed ? 'Armado de subestacion' : isBt ? `Autosoportante BT ${armado}` : isTerminal ? 'Terminal' : isStrongAngle ? 'Angulo fuerte' : isAngle ? 'Angulo' : 'Alineamiento',
      retenida: isTerminal || isStrongAngle || upper.includes('DERIV') || upper.includes('RS-04') ? 'Recomendada preliminarmente' : isAngle ? 'Evaluar segun angulo/carga' : 'No preliminar',
      pat: isSed || isTerminal ? 'Recomendado preliminarmente' : 'Segun norma/catalogo',
      fuente: catalogInfo || 'Preliminar: catalogo RedCAD no cargado en esta sesion'
    };
  }

  function inferPhaseMode(typeText = '') {
    const upper = String(typeText).toUpperCase();
    if (upper.includes('3Φ') || upper.includes('3F') || upper.includes('TRIF')) return 'TRIFASICO';
    if (upper.includes('2Φ') || upper.includes('2F') || upper.includes('BIF')) return 'BIFASICO';
    if (upper.includes('1Φ') || upper.includes('1F') || upper.includes('MONO')) return 'MONOFASICO';
    return 'BIFASICO';
  }

  function inferPhaseMode(typeText = '') {
    const upper = normalizePhaseText(typeText).toUpperCase();
    if (upper.includes('3Φ') || upper.includes('3F') || upper.includes('TRIF')) return 'TRIFASICO';
    if (upper.includes('2Φ') || upper.includes('2F') || upper.includes('BIF')) return 'BIFASICO';
    if (upper.includes('1Φ') || upper.includes('1F') || upper.includes('MONO')) return 'MONOFASICO';
    return 'BIFASICO';
  }

  function selectConductorForPhase(phaseMode = '') {
    const conductors = state.catalogs.configuracion?.conductors || [];
    const phase = String(phaseMode).toUpperCase();
    const preferred = conductors.find((name) => {
      const upper = String(name).toUpperCase();
      if (phase === 'TRIFASICO') return /3X|4X|TRIF|3F|3Φ/.test(upper);
      if (phase === 'BIFASICO') return /2X|3X|BIF|2F|2Φ/.test(upper);
      return /1X|2X|MONO|1F|1Φ/.test(upper);
    }) || conductors[0];
    if (preferred) {
      return { name: preferred, phaseMode, source: state.catalogs.configuracion?.name || 'Configuracion.xls' };
    }
    const fallback = {
      MONOFASICO: 'Conductor BT monofasico preliminar',
      BIFASICO: 'Conductor BT bifasico preliminar',
      TRIFASICO: 'Conductor BT trifasico preliminar'
    };
    return { name: fallback[phase] || fallback.BIFASICO, phaseMode, source: 'Preliminar: falta catalogo Configuracion.xls' };
  }

  function displayArmadoName(point, context = {}) {
    const raw = point.manualArmado || point.armado || classifyPointArmadoFromContext(point, context);
    if (context.network !== 'BT') return raw;
    const upper = String(raw || '').toUpperCase();
    if (/RS-\d+/i.test(upper)) return raw;
    if (upper.includes('TERMINAL')) return 'RS-06 TERMINAL BT';
    if (upper.includes('FUERTE')) return 'RS-05 ANGULO FUERTE BT';
    if (upper.includes('DERIV')) return 'RS-04 DERIVACION BT';
    if (upper.includes('ANGULO')) return 'RS-03 ANGULO BT';
    return 'RS-01 ALINEAMIENTO BT';
  }

  function deflectionAngle(a, b, c) {
    if (!a || !b || !c) return 0;
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (!l1 || !l2) return 0;
    const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)));
    const angle = Math.acos(cos) * 180 / Math.PI;
    return Math.abs(180 - angle);
  }

  function midpoint(a, b) {
    return {
      lat: (a.lat + b.lat) / 2,
      lon: (a.lon + b.lon) / 2,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function renderTempBtPoles(layer) {
    if (state.mode !== 'draw-bt' && state.mode !== 'draw-lp-reference') return;
    validPointList(state.tempBtPoints).forEach((point, index) => {
      if (index === 0 && state.mode === 'draw-bt') return;
      if (state.mode === 'draw-lp-reference') {
        const marker = L.marker([point.lat, point.lon], {
          draggable: true,
          icon: L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${isRpKind(state.tempLpKind) ? '#dc2626' : '#f97316'};border:3px solid white;box-shadow:0 1px 6px rgba(0,0,0,.35)"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          })
        }).bindTooltip(`${state.tempLpKind || 'LP'} punto ${index + 1} - arrastre para mover`);
        marker.on('dragend', (event) => {
          state.tempBtPoints[index] = latLngToPoint(event.target.getLatLng());
          renderProjected();
        });
        marker.addTo(layer);
        return;
      }
      L.circleMarker([point.lat, point.lon], {
        radius: 5,
        color: state.mode === 'draw-bt' ? '#0f172a' : '#ea580c',
        fillColor: state.mode === 'draw-bt' ? '#e0f2fe' : '#fed7aa',
        fillOpacity: 1,
        weight: 2
      }).bindTooltip(state.mode === 'draw-bt' ? `Poste BT ${index}` : `Punto LP/RP ${index + 1}`).addTo(layer);
    });
  }

  function renderManualClientMarkers(layer) {
    if (state.mode !== 'manual-clients') return;
    getClients().forEach((client) => {
      const selected = state.selectedClientIds.has(client.id);
      const marker = L.circleMarker([client.lat, client.lon], {
        radius: selected ? 8 : 6,
        color: selected ? '#16a34a' : '#2563eb',
        fillColor: selected ? '#bbf7d0' : '#dbeafe',
        fillOpacity: 0.75,
        weight: 3
      }).bindTooltip(client.name || client.id);
      marker.on('click', () => {
        if (state.selectedClientIds.has(client.id)) {
          state.selectedClientIds.delete(client.id);
          delete state.assignments[client.id];
        } else {
          state.selectedClientIds.add(client.id);
          state.assignments[client.id] = state.selectedChildId;
        }
        refreshServiceDrops({ dropMax: currentDropMax() });
        saveProject();
        renderProjected();
      });
      marker.addTo(layer);
    });
  }

  function renderAssignedClientMarkers(layer) {
    if (state.mode === 'manual-clients') return;
    getClients().forEach((client) => {
      const childSedId = state.assignments[client.id];
      if (!childSedId) return;
      const child = state.childSeds.find((sed) => sed.id === childSedId);
      const marker = L.circleMarker([client.lat, client.lon], {
        radius: 7,
        color: '#16a34a',
        fillColor: '#dcfce7',
        fillOpacity: 0.82,
        weight: 3
      }).bindTooltip(`${client.name || client.id} -> ${child?.name || childSedId}`);
      marker.on('click', async () => {
        const result = await modal({
          title: 'Suministro asignado',
          html: `<div style="text-align:left"><p><b>${escapeHtml(client.name || client.id)}</b></p><p>Pertenece a: ${escapeHtml(child?.name || childSedId)}</p></div>`,
          showDenyButton: true,
          showCancelButton: true,
          confirmButtonText: 'Mantener',
          denyButtonText: 'Excluir de esta SED'
        });
        if (result.isDenied) {
          delete state.assignments[client.id];
          refreshServiceDrops({ dropMax: currentDropMax() });
          saveProject();
          renderProjected();
        }
      });
      marker.addTo(layer);
    });
  }

  async function openChildSedActions(childSedId) {
    const child = state.childSeds.find((sed) => sed.id === childSedId);
    if (!child) return;
    const stats = childStats(child);
    const result = await modal({
      title: `SED hija: ${child.name}`,
      html: `
        <div style="text-align:left">
          <p><b>SED padre:</b> ${escapeHtml(parentSedLabel())}</p>
          <p><b>Estado LP/RP:</b> ${child.connected ? 'Conectada' : 'Pendiente'}</p>
          <p><b>Clientes asignados:</b> ${stats.clients}</p>
          <p><b>Distancia minima a clientes:</b> ${stats.minDistance} m</p>
          <p><b>Distancia promedio a clientes:</b> ${stats.avgDistance} m</p>
          <p><b>Capacidad referencial:</b> ${child.capacityKva || 0} kVA</p>
          <p><b>Tipo subestacion:</b> ${escapeHtml(child.substationType || 'No definido')}</p>
          <p><b>Sistema BT asumido:</b> ${escapeHtml(child.phaseMode || 'No definido')}</p>
          <p><b>Conductor asumido:</b> ${escapeHtml(child.conductor?.name || 'No definido')}</p>
        </div>
      `,
      input: 'select',
      inputOptions: {
        type: 'Tipo de subestacion / sistema BT',
        disconnect: 'Eliminar llegada LP/RP de esta SED',
        clients: 'Agrupar/seleccionar clientes',
        exclude: 'Excluir clientes de esta SED',
        bt: 'Trazar BT',
        calc: 'Calculos mecanicos y acometidas',
        kmz: 'Exportar proyectado KMZ/KML',
        json: 'Exportar proyectado JSON'
      },
      inputPlaceholder: 'Elija accion',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || !result.value) return;
    state.selectedChildId = child.id;
    if (result.value === 'type') return chooseSubstationType(child);
    if (result.value === 'disconnect') return deleteChildLpRpConnection(child);
    if (result.value === 'clients') return chooseChildForClientsFixed(child);
    if (result.value === 'exclude') return excludeClientsFromChild(child);
    if (result.value === 'bt') return chooseChildForBtFixed(child);
    if (result.value === 'calc') return askCalculationRules();
    if (result.value === 'kmz') return exportKmz();
    if (result.value === 'json') return exportJson();
  }

  async function chooseSubstationType(child) {
    if (!state.catalogs.configuracion?.substationTypes?.length) {
      const load = await modal({
        title: 'Catalogo Configuracion.xls',
        html: '<div class="pg-card" style="text-align:left">Para elegir el tipo desde RedCAD cargue primero <b>Configuracion.xls</b>. Tambien puede continuar con tipos referenciales.</div>',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Cargar catalogos',
        denyButtonText: 'Usar referencial'
      });
      if (load.isConfirmed) await askOptionalCatalogs();
      if (!load.isDenied && !state.catalogs.configuracion?.substationTypes?.length) return;
    }
    const types = state.catalogs.configuracion?.substationTypes?.length
      ? state.catalogs.configuracion.substationTypes
      : extractSubstationTypes([]);
    const options = {};
    types.forEach((type, index) => { options[String(index)] = type; });
    const result = await modal({
      title: 'Tipo de subestacion proyectada',
      html: `
        <div style="text-align:left">
          <p><b>SED hija:</b> ${escapeHtml(child.name)}</p>
          <p style="font-size:12px;color:#64748b">El sistema BT y conductor preliminar se asumiran para toda la red BT de esta SED.</p>
        </div>
      `,
      input: 'select',
      inputOptions: options,
      inputValue: Math.max(0, types.indexOf(child.substationType || '')).toString(),
      showCancelButton: true,
      confirmButtonText: 'Aplicar tipo'
    });
    if (!result.isConfirmed) return;
    const substationType = types[Number(result.value)] || types[0];
    const phaseMode = inferPhaseMode(substationType);
    const conductor = selectConductorForPhase(phaseMode);
    Object.assign(child, { substationType, phaseMode, conductor });
    state.btRoutes
      .filter((route) => route.childSedId === child.id)
      .forEach((route) => {
        route.phaseMode = phaseMode;
        route.conductor = conductor;
      });
    saveProject();
    renderProjected();
    notify(`Tipo aplicado: ${substationType}. Red BT asumida como ${phaseMode}.`, 'success', 8000);
  }

  async function openProjectedPointActions(point, context = {}) {
    if (!isValidPoint(point)) return;
    const result = await modal({
      title: `${context.network || 'Red'} proyectada`,
      html: `
        <div style="text-align:left">
          <p><b>ID:</b> ${escapeHtml(point.id || 'sin_id')}</p>
          <p><b>Tipo:</b> ${escapeHtml(context.network || 'N/A')}</p>
          <p><b>Armado:</b> ${escapeHtml(displayArmadoName(point, context))}</p>
          <p><b>Mecanico:</b> ${escapeHtml(point.manualMecanico || point.mecanico || 'Preliminar')}</p>
          <p><b>X:</b> ${round(point.x || 0, 2)} | <b>Y:</b> ${round(point.y || 0, 2)}</p>
        </div>
      `,
      input: 'select',
      inputOptions: {
        move: 'Mover punto/poste',
        branch: 'Crear derivacion desde este poste',
        update: 'Actualizar datos / armado',
        detail: 'Ver detalle de armado',
        design3d: 'Ver diseno 3D',
        delete: 'Eliminar punto/poste',
        ...(context.network !== 'BT' && context.networkId ? { deleteRoute: 'Eliminar toda esta ruta LP/RP' } : {})
      },
      inputPlaceholder: 'Elija accion',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || !result.value) return;
    if (result.value === 'move') return startMoveProjectedPoint(point, context);
    if (result.value === 'branch') return startBranchFromProjectedPoint(point, context);
    if (result.value === 'update') return updateProjectedPoint(point, context);
    if (result.value === 'detail') return showArmadoDetail(point, context);
    if (result.value === 'design3d') return showArmado3D(point, context);
    if (result.value === 'delete') return deleteProjectedPoint(point, context);
    if (result.value === 'deleteRoute') return deleteLpRpNetworkById(context.networkId);
  }

  async function openLpRpRouteActions(networkId) {
    const network = state.lpNetworks.find((item) => item.id === networkId);
    if (!network) return;
    const polesCount = validPointList(network.fixedNodes).length + validPointList(network.poles).length;
    const result = await modal({
      title: `Ruta ${network.kind || 'LP'} proyectada`,
      html: `
        <div style="text-align:left">
          <p><b>Longitud:</b> ${Math.round(lineLength(network.route || []))} m</p>
          <p><b>Postes/nodos:</b> ${polesCount}</p>
          <div class="pg-card">Esta accion elimina directamente el conductor/trazo y todos los postes de esta ruta.</div>
        </div>
      `,
      input: 'select',
      inputOptions: {
        deleteRoute: 'Eliminar toda esta ruta LP/RP'
      },
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || result.value !== 'deleteRoute') return;
    return deleteLpRpNetworkById(networkId);
  }

  async function openBtRouteActions(routeId) {
    const route = state.btRoutes.find((item) => item.id === routeId);
    if (!route) return;
    const child = state.childSeds.find((sed) => sed.id === route.childSedId);
    const phaseMode = route.phaseMode || child?.phaseMode || 'No definido';
    const conductor = route.conductor || child?.conductor || selectConductorForPhase(phaseMode);
    await modal({
      title: 'Datos del conductor BT',
      html: `
        <div style="text-align:left">
          <p><b>Tramo:</b> ${escapeHtml(route.id)}</p>
          <p><b>SED proyectada:</b> ${escapeHtml(child?.name || route.childSedId || '')}</p>
          <p><b>Tipo subestacion:</b> ${escapeHtml(child?.substationType || 'No definido')}</p>
          <p><b>Sistema asumido:</b> ${escapeHtml(phaseMode)}</p>
          <p><b>Conductor:</b> ${escapeHtml(conductor?.name || 'No definido')}</p>
          <p><b>Fuente:</b> ${escapeHtml(conductor?.source || 'Configuracion.xls no cargado / preliminar')}</p>
          <p><b>Longitud tramo:</b> ${Math.round(lineLength(route.points))} m</p>
          <p style="font-size:12px;color:#64748b">Si cambia el tipo de subestacion del trafo, este conductor se actualiza para toda su BT.</p>
        </div>
      `,
      confirmButtonText: 'Aceptar'
    });
  }

  function startBranchFromProjectedPoint(point, context = {}) {
    if (context.network === 'BT') {
      const route = state.btRoutes.find((item) => item.id === context.routeId);
      state.selectedChildId = context.childSedId || route?.childSedId || state.selectedChildId;
      return startBtBranchFromPoint(point);
    }
    state.tempLpKind = isRpKind(context.network) ? 'RP' : 'LP';
    state.tempLpSpan = 140;
    state.mode = 'draw-lp-reference';
    state.tempBtPoints = [point];
    showTraceToolbar(`${state.tempLpKind}: derivacion desde poste. Click agrega poste`, {
      undo: undoLpReferencePoint,
      save: () => finishLpReference(),
      cancel: cancelLpReference
    });
    notify(`Derivacion ${state.tempLpKind} iniciada desde el poste seleccionado. Marque mas puntos y guarde.`, 'info', 10000);
    map.on('click', onLpReferenceClick);
  }

  async function showArmadoDetail(point, context = {}) {
    const armado = displayArmadoName(point, context);
    const detail = lookupArmadoDetail(armado, context.network);
    await modal({
      title: `Detalle de armado ${armado}`,
      html: `
        <div style="text-align:left">
          <p><b>Red:</b> ${escapeHtml(context.network || 'N/A')}</p>
          <p><b>Armado:</b> ${escapeHtml(armado)}</p>
          <p><b>Altura:</b> ${escapeHtml(detail.altura)}</p>
          <p><b>Estructura:</b> ${escapeHtml(detail.estructura)}</p>
          <p><b>Retenida:</b> ${escapeHtml(detail.retenida)}</p>
          <p><b>PAT:</b> ${escapeHtml(detail.pat)}</p>
          <p><b>Fuente catalogo:</b> ${escapeHtml(detail.fuente)}</p>
          <p style="font-size:12px;color:#64748b">Para detalle exacto de RedCAD cargue Configuracion.xls/Suministros.XLS desde Catalogos. Si falta una hoja/campo, el valor queda como referencia preliminar.</p>
        </div>
      `,
      confirmButtonText: 'Aceptar'
    });
  }

  async function showArmado3D(point, context = {}) {
    if (typeof THREE === 'undefined') {
      notify('Three.js no esta disponible para mostrar el visor 3D.', 'error', 7000);
      return;
    }
    const armado = displayArmadoName(point, context);
    const detail = lookupArmadoDetail(armado, context.network);
    let renderer = null;
    let animationId = null;
    await modal({
      title: `Diseno 3D - ${armado}`,
      width: 920,
      html: `
        <div style="text-align:left">
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:12px;align-items:stretch">
            <div id="pgArmado3D" style="height:520px;border-radius:12px;overflow:hidden;background:#dcecff;border:1px solid #cbd5e1"></div>
            <div class="pg-card" style="margin:0;line-height:1.35">
              <b>Leyenda</b>
              ${armadoLegendHtml(armado, context.network)}
            </div>
          </div>
          <div class="pg-card">
            <b>${escapeHtml(context.network || 'Red')}</b> | ${escapeHtml(detail.estructura)} | Altura: ${escapeHtml(detail.altura)} | Retenida: ${escapeHtml(detail.retenida)}
          </div>
          <p style="font-size:12px;color:#64748b">Vista 3D esquematica. Los archivos DWG de armados deben convertirse a DXF/OBJ/GLTF para replicarlos exactamente en navegador.</p>
        </div>
      `,
      confirmButtonText: 'Cerrar',
      didOpen: () => {
        const container = document.getElementById('pgArmado3D');
        const view = createArmado3DScene(container, { armado, network: context.network, detail });
        renderer = view.renderer;
        const animate = () => {
          animationId = requestAnimationFrame(animate);
          view.group.rotation.y += 0.0025;
          view.controls?.update();
          view.renderer.render(view.scene, view.camera);
        };
        animate();
      },
      willClose: () => {
        if (animationId) cancelAnimationFrame(animationId);
        if (renderer) {
          renderer.dispose();
          renderer.domElement?.remove();
        }
      }
    });
  }

  function createArmado3DScene(container, options = {}) {
    const width = container.clientWidth || 860;
    const height = container.clientHeight || 500;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdcecff);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 500);
    camera.position.set(8, 8, 13);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.target.set(0, 4.5, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
    }

    scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(8, 14, 7);
    sun.castShadow = true;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshStandardMaterial({ color: 0xb7d2a5, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new THREE.GridHelper(28, 28, 0x7aa071, 0xd2e3cd));

    const group = new THREE.Group();
    scene.add(group);
    buildArmado3D(group, options);
    return { scene, camera, renderer, controls, group };
  }

  function buildArmado3D(group, options = {}) {
    const network = options.network || 'BT';
    const armado = String(options.armado || '').toUpperCase();
    const isBt = network === 'BT';
    if (isBt) return buildRsBtArmado3D(group, options);
    const isSed = network === 'SED' || armado.includes('SUBESTACION');
    const isTerminal = armado.includes('TERMINAL');
    const isStrongAngle = armado.includes('FUERTE');
    const isAngle = armado.includes('ANGULO') || isStrongAngle;
    const height = isBt ? 8 : 12;

    const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x59616a, roughness: 0.55, metalness: 0.25 });
    const ceramic = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });
    const cableMat = new THREE.MeshStandardMaterial({ color: isBt ? 0x111827 : 0xc2410c, roughness: 0.7 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.5, metalness: 0.25 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, height, 18), wood);
    pole.position.y = height / 2;
    pole.castShadow = true;
    group.add(pole);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.22, 18), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.9 }));
    base.position.y = 0.11;
    group.add(base);

    const armY = height * 0.78;
    const armWidth = isBt ? 3.2 : 4.4;
    addBox(group, armWidth, 0.16, 0.18, 0, armY, 0, steel);
    addBox(group, armWidth * 0.72, 0.11, 0.14, 0, armY - 0.55, 0, steel, 0, 0, isAngle ? 0.35 : 0);

    const conductorCount = isBt ? 4 : 3;
    for (let i = 0; i < conductorCount; i += 1) {
      const x = conductorCount === 4 ? -1.35 + i * 0.9 : -1.35 + i * 1.35;
      addInsulator(group, x, armY + 0.18, 0, ceramic);
      addCylinderBetween(group, new THREE.Vector3(x - 2.6, armY + 0.34, 0), new THREE.Vector3(x + 2.6, armY + 0.34, 0), 0.025, cableMat);
      if (isAngle) {
        addCylinderBetween(group, new THREE.Vector3(x, armY + 0.3, -0.1), new THREE.Vector3(x + 2.1, armY + 0.1, 2.1), 0.022, cableMat);
      }
    }

    if (isTerminal || isStrongAngle) {
      addGuyWire(group, height, steel);
    }

    if (isSed) {
      addTransformer3D(group, height * 0.43, steel);
    }

    addPat3D(group, height, copper);
  }

  function buildRsBtArmado3D(group, options = {}) {
    const armado = String(options.armado || 'RS-01').toUpperCase();
    const isTerminal = armado.includes('TERMINAL') || armado.includes('RS-06');
    const isStrongAngle = armado.includes('FUERTE') || armado.includes('RS-05');
    const isAngle = armado.includes('ANGULO') || armado.includes('RS-03') || isStrongAngle;
    const isDerivation = armado.includes('DERIV') || armado.includes('RS-04') || armado.includes('RS-05');
    const hasPat = armado.includes('PAT') || armado.includes('PUESTA') || isTerminal;
    const height = 8;

    const concrete = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.92 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x626a73, roughness: 0.48, metalness: 0.28 });
    const ceramic = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
    const cable = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.78 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.5, metalness: 0.25 });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.24, height, 16), concrete);
    pole.position.y = height / 2;
    pole.castShadow = true;
    group.add(pole);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.24, 16), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.9 }));
    base.position.y = 0.12;
    group.add(base);

    addBox(group, 0.95, 0.08, 0.16, 0, height * 0.84, 0, steel);

    const rackY = [height * 0.71, height * 0.65, height * 0.59, height * 0.53];
    rackY.forEach((y, idx) => {
      addInsulator(group, -0.32, y, 0, ceramic);
      addInsulator(group, 0.32, y, 0, ceramic);
      addCylinderBetween(group, new THREE.Vector3(-2.4, y + 0.04, 0), new THREE.Vector3(2.4, y + 0.04, 0), 0.018, cable);
    });

    if (isDerivation) {
      addBox(group, 1.35, 0.07, 0.12, 0, height * 0.76, 0, steel, 0, Math.PI / 2, 0);
      addCylinderBetween(group, new THREE.Vector3(0, height * 0.74, -2.2), new THREE.Vector3(0, height * 0.74, 2.2), 0.018, cable);
      addBtServiceDrops3D(group, height, cable);
    }

    if (isAngle) {
      addCylinderBetween(group, new THREE.Vector3(0.35, height * 0.73, 0), new THREE.Vector3(2.6, height * 0.66, 1.65), 0.018, cable);
      addCylinderBetween(group, new THREE.Vector3(-0.35, height * 0.68, 0), new THREE.Vector3(-2.6, height * 0.61, -1.65), 0.018, cable);
    }

    const guyCount = isStrongAngle ? 2 : (isTerminal || isDerivation) ? 1 : 0;
    addGuyWires(group, height, steel, guyCount);
    if (hasPat) addPat3D(group, height, copper);
  }

  function addBtServiceDrops3D(group, height, cableMaterial) {
    const serviceBox = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.58 });
    [-0.6, 0.15, 0.85].forEach((angle, index) => {
      const start = new THREE.Vector3(0.45 * Math.cos(angle), height * 0.61 - index * 0.08, 0.45 * Math.sin(angle));
      const end = new THREE.Vector3(2.0 * Math.cos(angle), height * 0.43 - index * 0.14, 2.0 * Math.sin(angle));
      addCylinderBetween(group, start, end, 0.012, cableMaterial);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.08), serviceBox);
      box.position.copy(end);
      box.castShadow = true;
      group.add(box);
    });
  }

  function addGuyWires(group, height, material, count = 0) {
    if (count <= 0) return;
    const angles = count === 1 ? [-2.35] : [-2.35, 0.78].slice(0, Math.min(count, 2));
    angles.forEach((angle) => {
      const end = new THREE.Vector3(Math.cos(angle) * 4.2, 0.25, Math.sin(angle) * 4.2);
      addCylinderBetween(group, new THREE.Vector3(0, height * 0.76, 0), end, 0.016, material);
      const anchor = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), material);
      anchor.position.copy(end);
      anchor.position.y = 0.2;
      anchor.rotation.z = Math.PI;
      group.add(anchor);
    });
  }

  function armadoLegendHtml(armado, network) {
    const upper = String(armado || '').toUpperCase();
    const items = [
      ['01', 'Poste proyectado'],
      ['02', network === 'BT' ? 'Armado/Rack BT RS' : 'Cruceta/armado LP/RP'],
      ['03', 'Conductores principales']
    ];
    if (upper.includes('DERIV') || upper.includes('RS-04') || upper.includes('RS-05')) {
      items.push(['04', 'Salida de derivacion']);
    }
    if (upper.includes('TERMINAL') || upper.includes('FUERTE') || upper.includes('RS-05') || upper.includes('RS-06')) {
      items.push(['05', 'Retenida']);
      items.push(['06', 'Anclaje de retenida']);
    }
    if (upper.includes('PAT') || upper.includes('PUESTA') || upper.includes('TERMINAL')) {
      items.push(['07', 'Cable de puesta a tierra']);
    }
    return `<ol style="margin:8px 0 0 18px;padding:0">${items.map(([code, text]) => `<li><b>${code}</b> ${escapeHtml(text)}</li>`).join('')}</ol>`;
  }

  function addBox(group, w, h, d, x, y, z, material, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function addInsulator(group, x, y, z, material) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.42, 12), material);
    ins.position.set(x, y, z);
    ins.rotation.x = Math.PI / 2;
    ins.castShadow = true;
    group.add(ins);
  }

  function addCylinderBetween(group, start, end, radius, material) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
    mesh.position.copy(start.clone().add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function addGuyWire(group, height, material) {
    addCylinderBetween(group, new THREE.Vector3(0, height * 0.78, 0), new THREE.Vector3(-4.2, 0.25, -3.2), 0.018, material);
    const anchor = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 8), material);
    anchor.position.set(-4.2, 0.2, -3.2);
    anchor.rotation.z = Math.PI;
    group.add(anchor);
  }

  function addPat3D(group, height, material) {
    addCylinderBetween(group, new THREE.Vector3(0.18, height * 0.62, 0.08), new THREE.Vector3(0.42, 0.08, 0.38), 0.018, material);
    addCylinderBetween(group, new THREE.Vector3(-0.55, 0.08, 0.5), new THREE.Vector3(0.65, 0.08, 0.5), 0.018, material);
  }

  function addTransformer3D(group, y, material) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.15, 0.75), new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6, metalness: 0.15 }));
    body.position.set(0, y, -0.55);
    body.castShadow = true;
    group.add(body);
    addCylinderBetween(group, new THREE.Vector3(-0.45, y + 0.72, -0.55), new THREE.Vector3(-0.45, y + 1.2, -0.55), 0.055, material);
    addCylinderBetween(group, new THREE.Vector3(0.45, y + 0.72, -0.55), new THREE.Vector3(0.45, y + 1.2, -0.55), 0.055, material);
  }

  function startMoveProjectedPoint(point, context = {}) {
    if (!isValidPoint(point)) return;
    state.mode = 'move-projected-point';
    state.movingPointRef = point;
    notify('Haga click en la nueva ubicacion del poste/punto proyectado.', 'info', 10000);
    map.once('click', (event) => {
      moveProjectedPointToLatLng(point, event.latlng);
    });
  }

  function moveProjectedPointToLatLng(point, latlng) {
    const moved = latLngToPoint(latlng);
    Object.assign(point, {
      lat: moved.lat,
      lon: moved.lon,
      x: moved.x,
      y: moved.y,
      zone: moved.zone,
      movedManual: true
    });
    state.mode = null;
    state.movingPointRef = null;
    refreshServiceDrops({ dropMax: currentDropMax() });
    saveProject();
    renderProjected();
    notify('Poste/punto movido. Se actualizaron acometidas y vanos preliminares.', 'success', 6000);
  }

  async function updateProjectedPoint(point, context = {}) {
    const defaults = {
      armado: point.manualArmado || point.armado || classifyPointArmadoFromContext(point, context),
      mecanico: point.manualMecanico || point.mecanico || 'CALCULO PRELIMINAR'
    };
    const result = await modal({
      title: 'Actualizar poste/punto',
      html: `
        <input id="pgPointName" class="swal2-input" value="${escapeHtml(point.name || point.id || '')}" placeholder="Nombre/codigo">
        <input id="pgPointArmado" class="swal2-input" value="${escapeHtml(defaults.armado)}" placeholder="Armado">
        <input id="pgPointMecanico" class="swal2-input" value="${escapeHtml(defaults.mecanico)}" placeholder="Calculo mecanico / retenida / observacion">
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar datos',
      preConfirm: () => ({
        name: document.getElementById('pgPointName')?.value.trim() || point.name || point.id || '',
        armado: document.getElementById('pgPointArmado')?.value.trim() || defaults.armado,
        mecanico: document.getElementById('pgPointMecanico')?.value.trim() || defaults.mecanico
      })
    });
    if (!result.isConfirmed) return;
    Object.assign(point, {
      name: result.value.name,
      manualArmado: result.value.armado,
      manualMecanico: result.value.mecanico,
      armado: result.value.armado,
      mecanico: result.value.mecanico
    });
    saveProject();
    renderProjected();
    notify('Datos del poste actualizados.', 'success', 5000);
  }

  async function deleteProjectedPoint(point, context = {}) {
    const result = await modal({
      title: 'Eliminar punto',
      html: '<div class="pg-card" style="text-align:left">Se eliminara este punto de la ruta proyectada. Si era una derivacion o un nodo intermedio, se recalcularan vanos y acometidas.</div>',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    let removed = false;
    if (context.source === 'bt-route') {
      const route = state.btRoutes.find((item) => item.id === context.routeId);
      if (route && context.pointIndex > 0 && route.points.length > 2) {
        route.points.splice(context.pointIndex, 1);
        removed = true;
      }
    } else if (context.source === 'lp-node' || context.source === 'lp-pole') {
      const network = state.lpNetworks.find((item) => item.id === context.networkId);
      if (network) {
        network.fixedNodes = network.fixedNodes.filter((item) => item.id !== point.id);
        network.poles = network.poles.filter((item) => item.id !== point.id);
        network.route = network.route.filter((item) => item.id !== point.id);
        removed = true;
      }
    }
    if (!removed) {
      notify('No se pudo eliminar: no se puede borrar el origen o la ruta quedaria sin puntos suficientes.', 'error', 7000);
      return;
    }
    refreshServiceDrops({ dropMax: 25 });
    saveProject();
    renderProjected();
    notify('Punto eliminado y proyectadas actualizadas.', 'success', 6000);
  }

  async function openServiceDropActions(dropId) {
    const drop = state.design.serviceDrops.find((item) => item.id === dropId);
    if (!drop) return;
    const result = await modal({
      title: 'Acometida proyectada',
      html: `
        <div style="text-align:left">
          <p><b>Cliente:</b> ${escapeHtml(drop.clientId)}</p>
          <p><b>Longitud:</b> ${Math.round(drop.length || 0)} m</p>
          <p><b>Maximo:</b> ${drop.dropMax || 25} m</p>
          ${drop.overLimit ? '<p style="color:#dc2626"><b>Advertencia:</b> supera la longitud maxima.</p>' : ''}
        </div>
      `,
      input: 'select',
      inputOptions: {
        source: 'Cambiar poste de origen',
        length: 'Actualizar longitud manual',
        auto: 'Volver a longitud automatica'
      },
      inputPlaceholder: 'Elija accion',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || !result.value) return;
    if (result.value === 'source') {
      state.mode = 'select-service-source';
      state.editingDropId = drop.id;
      notify('Haga click en el poste BT que sera origen de esta acometida.', 'info', 10000);
      return;
    }
    if (result.value === 'length') return updateServiceDropLength(drop);
    if (result.value === 'auto') {
      drop.manualLength = null;
      drop.manualSource = null;
      refreshServiceDrops({ dropMax: drop.dropMax || 25 });
      saveProject();
      renderProjected();
    }
  }

  async function updateServiceDropLength(drop) {
    const result = await modal({
      title: 'Longitud manual de acometida',
      html: '<div class="pg-card" style="text-align:left">Use esto cuando en campo la acometida tenga una ruta distinta a la recta del mapa.</div>',
      input: 'number',
      inputValue: Math.round(drop.length || 0),
      inputAttributes: { min: 1 },
      showCancelButton: true,
      confirmButtonText: 'Guardar longitud'
    });
    if (!result.isConfirmed) return;
    const length = Number(result.value);
    if (!Number.isFinite(length) || length <= 0) return;
    drop.manualLength = length;
    drop.length = length;
    drop.overLimit = length > (drop.dropMax || 25);
    saveProject();
    renderProjected();
  }

  function assignDropManualSource(point) {
    const drop = state.design.serviceDrops.find((item) => item.id === state.editingDropId);
    if (!drop || !isValidPoint(point)) return;
    drop.manualSource = point;
    drop.sourcePointId = point.id || '';
    drop.points = [point, drop.points[1]];
    drop.length = drop.manualLength || distance(point, drop.points[1]);
    drop.overLimit = drop.length > (drop.dropMax || 25);
    state.mode = null;
    state.editingDropId = null;
    saveProject();
    renderProjected();
    notify('Acometida actualizada al poste seleccionado.', 'success', 6000);
  }

  function childStats(child) {
    const clients = assignedClients(child.id);
    const distances = clients.map((client) => distance(child, client)).filter(Number.isFinite);
    const min = distances.length ? Math.min(...distances) : 0;
    const avg = distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
    return {
      clients: clients.length,
      minDistance: Math.round(min),
      avgDistance: Math.round(avg)
    };
  }

  function addPolyline(points, color, weight, label, layer, dashArray = '') {
    const validPoints = validPointList(points);
    if (validPoints.length < 2) return null;
    return L.polyline(validPoints.map((p) => [p.lat, p.lon]), { color, weight, opacity: 0.9, dashArray })
      .bindTooltip(label)
      .addTo(layer);
  }

  function showTraceToolbar(label, handlers = {}) {
    hideTraceToolbar();
    traceToolbar = document.createElement('div');
    traceToolbar.className = 'pg-trace-toolbar';
    traceToolbar.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <button type="button" id="pgUndoTrace" class="pg-muted">Deshacer punto</button>
      <button type="button" id="pgSaveTrace">Guardar trazo</button>
      ${handlers.branch ? '<button type="button" id="pgBranchTrace" class="pg-muted">Guardar y derivar</button>' : ''}
      <button type="button" id="pgCancelTrace" class="pg-danger">Cancelar</button>
    `;
    document.body.appendChild(traceToolbar);
    document.getElementById('pgUndoTrace').onclick = handlers.undo || undoLpReferencePoint;
    document.getElementById('pgSaveTrace').onclick = handlers.save || (() => finishLpReference());
    document.getElementById('pgCancelTrace').onclick = handlers.cancel || cancelLpReference;
    const branchButton = document.getElementById('pgBranchTrace');
    if (branchButton) branchButton.onclick = handlers.branch;
  }

  function showBtTraceToolbar() {
    showTraceToolbar('BT: click agrega poste. Puede cancelar o guardar y derivar', {
      undo: undoBtRoutePoint,
      save: () => finishBtRoute(),
      cancel: cancelBtRoute,
      branch: finishBtAndStartBranch
    });
  }

  function hideTraceToolbar() {
    if (traceToolbar) {
      traceToolbar.remove();
      traceToolbar = null;
    }
  }

  async function chooseChildSed(title, helperText = '') {
    if (!state.childSeds.length) {
      notify('Primero cree una SED proyectada hija.', 'error');
      await startCreateChildSed();
      return null;
    }
    const options = {};
    state.childSeds.forEach((sed) => {
      options[sed.id] = `${sed.name} ${sed.connected ? '(con LP/RP)' : '(sin LP/RP)'}`;
    });
    const result = await modal({
      title,
      html: `
        <div style="text-align:left;margin-bottom:10px">
          <p><b>SED padre existente:</b> ${escapeHtml(parentSedLabel())}</p>
          ${helperText ? `<p style="font-size:12px;color:#64748b">${escapeHtml(helperText)}</p>` : ''}
        </div>
      `,
      input: 'select',
      inputOptions: options,
      inputPlaceholder: 'Seleccione SED hija',
      showCancelButton: true
    });
    if (!result.isConfirmed || !result.value) return null;
    return state.childSeds.find((sed) => sed.id === result.value) || null;
  }

  async function exportKmz() {
    const choice = await modal({
      title: 'Exportar proyectado',
      html: `
        <div style="text-align:left">
          <div class="pg-card">
            <label style="display:block;margin-bottom:8px"><b>Red a exportar</b></label>
            <select id="pgExportNetwork" class="swal2-select" style="width:100%">
              <option value="BT">BT - Baja tension proyectada</option>
              <option value="LP" disabled>LP - Proximamente</option>
              <option value="RP" disabled>RP - Proximamente</option>
            </select>
          </div>
          <div class="pg-card">
            <label style="display:block;margin-bottom:8px"><b>Formato</b></label>
            <select id="pgExportMode" class="swal2-select" style="width:100%">
              <option value="2d">KMZ 2D tecnico</option>
              <option value="3d">KMZ 3D visual Google Earth</option>
            </select>
            <p style="font-size:12px;color:#64748b;margin:8px 0 0">El KMZ 3D es solo para visualizar postes/cables en Google Earth. No reemplaza la exportacion tecnica RedCAD.</p>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Exportar',
      preConfirm: () => ({
        network: document.getElementById('pgExportNetwork')?.value || 'BT',
        mode: document.getElementById('pgExportMode')?.value || '2d'
      })
    });
    if (!choice.isConfirmed) return;
    const options = choice.value || { network: 'BT', mode: '2d' };
    const kml = buildProjectedKml(options);
    const date = new Date().toISOString().slice(0, 10);
    const suffix = options.mode === '3d' ? 'kmz_3d_visual' : 'kmz_2d';
    const fileBase = `proyectadas_${options.network}_${suffix}_${cleanFile(state.parentSedId)}_${date}`;

    if (window.JSZip) {
      const zip = new JSZip();
      zip.file('doc.kml', kml);
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz' });
      downloadBlob(blob, `${fileBase}.kmz`);
      notify(options.mode === '3d' ? 'KMZ 3D visual exportado.' : 'KMZ 2D exportado.', 'success');
      return;
    }

    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    downloadBlob(blob, `${fileBase}.kml`);
    notify('JSZip no esta disponible: se descargo KML en lugar de KMZ.', 'warning', 7000);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function exportJson() {
    const payload = buildProjectSnapshot();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proyectadas_${cleanFile(state.parentSedId)}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
    notify('JSON de proyectadas descargado. Este es el respaldo editable sin base de datos.', 'success', 8000);
  }

  function buildProjectedKml(options = {}) {
    const network = options.network || 'BT';
    const mode = options.mode || '2d';
    const placemarks = [];
    const styles = kmlStyles();
    if (network === 'BT') {
      placemarks.push('<Folder><name>SED proyectadas</name>');
      state.childSeds.forEach((sed) => placemarks.push(pointKml(sed.name, sed, '#sedStyle')));
      placemarks.push('</Folder>');

      placemarks.push('<Folder><name>Red BT proyectada</name>');
      state.btRoutes.forEach((route) => {
        const points = validPointList(route.points);
        if (mode === '3d') {
          placemarks.push(...btCatenaryKml(`${route.id}_catenaria_BT`, points));
          points.slice(1).forEach((point, index) => {
            placemarks.push(...verticalPoleKml(point.id || `PBT_${index + 1}`, point, 8, route, index + 1));
            placemarks.push(...btAuxiliary3dKml(point, route, index + 1));
          });
        } else {
          placemarks.push(lineKml(route.id, points, { style: '#btStyle2d' }));
          points.slice(1).forEach((point, index) => placemarks.push(pointKml(point.id || `PBT_${index + 1}`, point, '#poleStyle2d', poleDescriptionHtml(point, route, index + 1))));
        }
      });
      placemarks.push('</Folder>');

      placemarks.push('<Folder><name>Acometidas BT</name>');
      state.design.serviceDrops.forEach((line) => {
        placemarks.push(lineKml(line.id, line.points, {
          altitude: mode === '3d' ? 6 : 0,
          style: line.overLimit ? '#dropOverStyle' : '#dropStyle',
          description: serviceDropDescriptionHtml(line)
        }));
      });
      placemarks.push('</Folder>');
    }
    return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proyectadas ${xml(network)} ${xml(mode.toUpperCase())} ${xml(state.parentSedId)}</name>${styles}${placemarks.join('')}</Document></kml>`;
  }

  function kmlStyles() {
    return `
      <Style id="sedStyle"><IconStyle><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
      <Style id="poleStyle2d"><IconStyle><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>
      <Style id="poleBottom3d"><LineStyle><color>ff666666</color><width>7</width></LineStyle></Style>
      <Style id="poleMiddle3d"><LineStyle><color>ff777777</color><width>5</width></LineStyle></Style>
      <Style id="poleTop3d"><LineStyle><color>ff888888</color><width>3</width></LineStyle></Style>
      <Style id="btStyle2d"><LineStyle><color>ffff7f00</color><width>3</width></LineStyle></Style>
      <Style id="btStyle3d"><LineStyle><color>ffff0000</color><width>2</width></LineStyle></Style>
      <Style id="guyStyle3d"><LineStyle><color>ff202020</color><width>2</width></LineStyle></Style>
      <Style id="patStyle3d"><LineStyle><color>ff00aa00</color><width>3</width></LineStyle></Style>
      <Style id="dropStyle"><LineStyle><color>ffff00ff</color><width>2</width></LineStyle></Style>
      <Style id="dropOverStyle"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>
    `;
  }

  function pointKml(name, point, style = '', description = '') {
    if (!isValidPoint(point)) return '';
    return `<Placemark><name>${xml(name)}</name>${style ? `<styleUrl>${style}</styleUrl>` : ''}${descriptionKml(description)}<Point><coordinates>${point.lon},${point.lat},0</coordinates></Point></Placemark>`;
  }

  function lineKml(name, points, options = {}) {
    const validPoints = validPointList(points);
    if (validPoints.length < 2) return '';
    const altitude = Number(options.altitude || 0);
    const altitudeStart = Number.isFinite(Number(options.altitudeStart)) ? Number(options.altitudeStart) : altitude;
    const altitudeEnd = Number.isFinite(Number(options.altitudeEnd)) ? Number(options.altitudeEnd) : altitude;
    const usesAltitude = altitude > 0 || altitudeStart > 0 || altitudeEnd > 0;
    const altitudeMode = usesAltitude ? '<altitudeMode>relativeToGround</altitudeMode>' : '<tessellate>1</tessellate>';
    const coords = validPoints.map((p, index) => {
      const t = validPoints.length <= 1 ? 0 : index / (validPoints.length - 1);
      const z = altitudeStart + (altitudeEnd - altitudeStart) * t;
      return `${p.lon},${p.lat},${round(z, 2)}`;
    }).join(' ');
    return `<Placemark><name>${xml(name)}</name>${options.style ? `<styleUrl>${options.style}</styleUrl>` : ''}${descriptionKml(options.description || '')}<LineString>${altitudeMode}<coordinates>${coords}</coordinates></LineString></Placemark>`;
  }

  function verticalPoleKml(name, point, height, route, index) {
    if (!isValidPoint(point)) return '';
    const description = poleDescriptionHtml(point, route, index);
    const segments = [
      ['#poleBottom3d', 0, height * 0.38, 'base'],
      ['#poleMiddle3d', height * 0.38, height * 0.72, 'medio'],
      ['#poleTop3d', height * 0.72, height, 'punta']
    ];
    return segments.map(([style, z1, z2, part]) => (
      `<Placemark><name>${xml(`${name}_${part}`)}</name><styleUrl>${style}</styleUrl>${descriptionKml(description)}<LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${point.lon},${point.lat},${round(z1, 2)} ${point.lon},${point.lat},${round(z2, 2)}</coordinates></LineString></Placemark>`
    ));
  }

  function btCatenaryKml(name, points) {
    const valid = validPointList(points);
    const placemarks = [];
    const offsets = [-0.45, 0, 0.45];
    for (let i = 1; i < valid.length; i += 1) {
      const start = valid[i - 1];
      const end = valid[i];
      offsets.forEach((offset, conductorIndex) => {
        const coords = catenaryCoordinates(start, end, offset, 8, 0.55);
        placemarks.push(`<Placemark><name>${xml(`${name}_${i}_${conductorIndex + 1}`)}</name><styleUrl>#btStyle3d</styleUrl><LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>`);
      });
    }
    return placemarks;
  }

  function catenaryCoordinates(start, end, offsetMeters, height, sag) {
    const coords = [];
    for (let step = 0; step <= 6; step += 1) {
      const t = step / 6;
      const base = interpolatePoint(start, end, t);
      const shifted = offsetPointPerpendicular(base, start, end, offsetMeters);
      const curveSag = Math.sin(Math.PI * t) * sag;
      coords.push(`${shifted.lon},${shifted.lat},${round(height - curveSag, 2)}`);
    }
    return coords.join(' ');
  }

  function btAuxiliary3dKml(point, route, index) {
    const placemarks = [];
    const armado = displayArmadoName(point, { network: 'BT', source: 'bt-route', routeId: route.id, pointIndex: index });
    const upper = String(armado || '').toUpperCase();
    if (upper.includes('TERMINAL') || upper.includes('FUERTE') || upper.includes('DERIV') || upper.includes('RS-04') || upper.includes('RS-05') || upper.includes('RS-06')) {
      const guyCount = upper.includes('FUERTE') || upper.includes('RS-05') ? 2 : 1;
      const angles = guyCount === 1 ? [-135] : [-135, 45];
      angles.forEach((angle, idx) => {
        const anchor = offsetPoint(point, 5.5, angle);
        placemarks.push(lineKml(`${point.id || 'PBT'}_RET_${idx + 1}`, [
          { ...point, z: 0 },
          anchor
        ], { style: '#guyStyle3d', altitudeStart: 6.2, altitudeEnd: 0.15 }));
      });
    }
    if (upper.includes('PAT') || upper.includes('PUESTA') || upper.includes('TERMINAL')) {
      placemarks.push(`<Placemark><name>${xml(`${point.id || 'PBT'}_PAT`)}</name><styleUrl>#patStyle3d</styleUrl><LineString><altitudeMode>relativeToGround</altitudeMode><coordinates>${point.lon},${point.lat},5.8 ${point.lon},${point.lat},0</coordinates></LineString></Placemark>`);
    }
    return placemarks;
  }

  function descriptionKml(html) {
    return html ? `<description><![CDATA[${html}]]></description>` : '';
  }

  function poleDescriptionHtml(point, route, index) {
    const armado = displayArmadoName(point, { network: 'BT', source: 'bt-route', routeId: route.id, pointIndex: index });
    const drops = state.design.serviceDrops.filter((drop) => drop.sourcePointId === point.id || samePoint(drop.points?.[0], point));
    const usersHtml = drops.length
      ? drops.map((drop) => clientHistoryHtml(getClientById(drop.clientId), drop)).join('')
      : '<p><b>Usuarios asociados:</b> Sin acometidas directas registradas.</p>';
    return `
      <div style="font-family:Arial,sans-serif;min-width:280px">
        <h3 style="margin:0 0 8px;color:#0b5394">Poste proyectado BT</h3>
        <p><b>Codigo poste:</b> ${escapeHtml(point.id || `PBT_${index}`)}</p>
        <p><b>Armado:</b> ${escapeHtml(armado)}</p>
        <p><b>SED proyectada:</b> ${escapeHtml(route.childSedId || '')}</p>
        <p><b>Ex trafo / SED padre:</b> ${escapeHtml(state.parentSedId || '')}</p>
        <p><b>Altura referencial:</b> 8 m</p>
        <hr>
        ${usersHtml}
      </div>
    `;
  }

  function serviceDropDescriptionHtml(drop) {
    const client = getClientById(drop.clientId);
    return `
      <div style="font-family:Arial,sans-serif;min-width:280px">
        <h3 style="margin:0 0 8px;color:#0b5394">Acometida proyectada</h3>
        <p><b>Longitud:</b> ${Math.round(drop.length || 0)} m</p>
        <p><b>Maximo:</b> ${drop.dropMax || 25} m</p>
        ${drop.overLimit ? '<p style="color:#b91c1c"><b>Advertencia:</b> supera la longitud maxima.</p>' : ''}
        <hr>
        ${clientHistoryHtml(client, drop)}
      </div>
    `;
  }

  function clientHistoryHtml(client, drop = null) {
    if (!client) return '<p><b>Usuario:</b> No encontrado en red existente.</p>';
    const attrs = client.attrs || {};
    const codigo = client.id || getAttr(attrs, ['SUM_COD_SUM', 'OBJECTID'], '');
    const nombre = client.name || getAttr(attrs, ['SUM_NOM_SUM', 'SUM_NOM_CLI'], 'Usuario sin nombre');
    const direccion = getAttr(attrs, ['SUM_DIR_SUM', 'SUM_DIR_CLI', 'DIRECCION'], '');
    const exTrafo = getAttr(attrs, ['SED_COD_SED', 'SUM_COD_SED', 'SED', 'SED_ID'], state.parentSedId || '');
    const tension = getAttr(attrs, ['SUM_TEN_SUM', 'TENSION'], '');
    const tarifa = getAttr(attrs, ['SUM_TAR_SUM', 'TARIFA'], '');
    const fases = getAttr(attrs, ['SUM_FAS_SUM', 'SUM_NRO_FAS', 'FASES'], '');
    const maxDemanda = getAttr(attrs, ['SUM_MAX_DEM', 'MAX_DEMANDA'], '');
    const potencia = getAttr(attrs, ['SUM_POT_EQT', 'POTENCIA', 'POT_KW'], client.demandKw || '');
    const estado = getAttr(attrs, ['SUM_EST_SUM', 'ESTADO'], '');
    return `
      <div style="border-left:4px solid #0b73d9;padding-left:8px;margin:8px 0">
        <h4 style="margin:0 0 6px;color:#0b5394">${escapeHtml(nombre)}</h4>
        <p><b>Codigo suministro:</b> ${escapeHtml(codigo)}</p>
        <p><b>Direccion:</b> ${escapeHtml(direccion)}</p>
        <p><b>Historial ex trafo:</b> ${escapeHtml(exTrafo)}</p>
        <p><b>SED proyectada:</b> ${escapeHtml(drop?.childSedId || state.assignments[codigo] || '')}</p>
        <p><b>Potencia/demanda anterior:</b> ${escapeHtml(potencia || maxDemanda || 'N/A')} ${potencia || maxDemanda ? 'kW/kVA' : ''}</p>
        <p><b>Tension:</b> ${escapeHtml(tension || 'N/A')} | <b>Fases:</b> ${escapeHtml(fases || 'N/A')}</p>
        <p><b>Tarifa:</b> ${escapeHtml(tarifa || 'N/A')} | <b>Estado:</b> ${escapeHtml(estado || 'N/A')}</p>
      </div>
    `;
  }

  function getClientById(clientId) {
    return getClients().find((client) => client.id === clientId);
  }

  function getAttr(attrs, keys, fallback = '') {
    for (const key of keys) {
      const value = attrs?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
    }
    return fallback;
  }

  function samePoint(a, b) {
    return isValidPoint(a) && isValidPoint(b) && Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lon - b.lon) < 1e-10;
  }

  function interpolatePoint(start, end, t) {
    return {
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
      x: Number.isFinite(start.x) && Number.isFinite(end.x) ? start.x + (end.x - start.x) * t : null,
      y: Number.isFinite(start.y) && Number.isFinite(end.y) ? start.y + (end.y - start.y) * t : null
    };
  }

  function offsetPointPerpendicular(point, start, end, meters) {
    if (!meters) return point;
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const len = Math.hypot(dx, dy) || 1;
    return offsetPointByMeters(point, (-dy / len) * meters, (dx / len) * meters);
  }

  function offsetPoint(point, meters, angleDegrees) {
    const angle = angleDegrees * Math.PI / 180;
    return offsetPointByMeters(point, Math.cos(angle) * meters, Math.sin(angle) * meters);
  }

  function offsetPointByMeters(point, eastMeters, northMeters) {
    const lat = point.lat + northMeters / 111320;
    const lon = point.lon + eastMeters / (111320 * Math.cos(point.lat * Math.PI / 180));
    if (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
      return {
        lat,
        lon,
        x: Number(point.x) + eastMeters,
        y: Number(point.y) + northMeters,
        zone: point.zone || '19L'
      };
    }
    return { lat, lon };
  }

  function resetDesign() {
    state.childSeds = [];
    state.lpConnections = [];
    state.btRoutes = [];
    state.assignments = {};
    state.design = { poles: [], btLines: [], serviceDrops: [], pat: [], retenidas: [], warnings: [] };
    state.mechanical = { spans: [], structures: [] };
    state.mode = null;
  }

  function buildProjectSnapshot() {
    return {
      schema: 'proyectadas-guiadas-v1',
      parentSedId: state.parentSedId,
      project: state.project,
      childSeds: state.childSeds,
      lpConnections: state.lpConnections,
      lpReferences: state.lpReferences,
      lpNetworks: state.lpNetworks,
      btRoutes: state.btRoutes,
      assignments: state.assignments,
      design: state.design,
      catalogs: state.catalogs,
      mechanical: state.mechanical,
      lpProject: state.lpProject,
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString()
    };
  }

  function saveProject() {
    if (!state.parentSedId) return;
    state.updatedAt = new Date().toISOString();
    normalizeProjectState();
    if (state.lpProject?.code) saveLpRpProject();
    localStorage.setItem(storageKey(state.parentSedId), JSON.stringify(buildProjectSnapshot()));
  }

  function lpRpStorageKey() {
    return 'proyectadas_lp_rp_global_v1';
  }

  function loadLpRpProjects() {
    try {
      const raw = localStorage.getItem(lpRpStorageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.projects) ? parsed.projects : [];
    } catch (error) {
      console.warn('No se pudo leer el banco LP/RP:', error);
      return [];
    }
  }

  function saveLpRpProject() {
    if (!state.lpProject?.code) return;
    const projects = loadLpRpProjects();
    const payload = {
      ...state.lpProject,
      updatedAt: new Date().toISOString(),
      lpReferences: state.lpReferences,
      lpNetworks: state.lpNetworks
    };
    state.lpProject.updatedAt = payload.updatedAt;
    const index = projects.findIndex((project) => project.code === payload.code);
    if (index >= 0) projects[index] = payload;
    else projects.unshift(payload);
    localStorage.setItem(lpRpStorageKey(), JSON.stringify({
      schema: 'lp-rp-projects-v1',
      updatedAt: payload.updatedAt,
      projects: projects.slice(0, 25)
    }));
  }

  function restoreLpRpProject(project) {
    if (!project) return;
    state.lpProject = {
      name: project.name || project.code || 'LP_RP',
      code: project.code || cleanFile(project.name || `LP_RP_${Date.now()}`),
      startedAt: project.startedAt || '',
      updatedAt: project.updatedAt || ''
    };
    state.lpReferences = project.lpReferences || [];
    state.lpNetworks = project.lpNetworks || [];
  }

  function ensureLatestLpRpProjectLoaded() {
    if (state.lpProject?.code || state.lpNetworks.length) return;
    const latest = loadLpRpProjects()[0];
    if (latest) restoreLpRpProject(latest);
  }

  function loadSavedProject(codigoSED) {
    try {
      const raw = localStorage.getItem(storageKey(codigoSED));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.schema === 'proyectadas-guiadas-v1' ? parsed : null;
    } catch (error) {
      console.warn('No se pudo leer proyectada guardada:', error);
      return null;
    }
  }

  async function confirmContinueSaved(codigoSED, saved) {
    const result = await modal({
      title: 'Proyectada guardada',
      html: `
        <div style="text-align:left">
          <div class="pg-card">
          <p>Ya existe un avance de proyectadas para la SED padre <b>${escapeHtml(codigoSED)}</b>.</p>
          <p><b>SED hijas guardadas:</b> ${saved.childSeds?.length || 0}</p>
          <p><b>Ultima actualizacion:</b> ${escapeHtml(saved.updatedAt || 'N/A')}</p>
          </div>
          <p style="font-size:12px;color:#64748b">No necesita base de datos: se guarda en este navegador con localStorage. Para respaldo/exportacion use KMZ o JSON.</p>
        </div>
      `,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Continuar avance',
      denyButtonText: 'Nuevo desde cero',
      cancelButtonText: 'Cancelar'
    });
    if (result.isConfirmed) return true;
    if (result.isDenied) {
      localStorage.removeItem(storageKey(codigoSED));
      return false;
    }
    throw new Error('Operacion cancelada.');
  }

  function restoreProject(saved) {
    state.active = true;
    state.parentSedId = saved.parentSedId;
    state.project = saved.project;
    state.childSeds = saved.childSeds || [];
    state.lpConnections = saved.lpConnections || [];
    state.lpReferences = saved.lpReferences || [];
    state.lpNetworks = saved.lpNetworks || [];
    state.btRoutes = saved.btRoutes || [];
    state.assignments = saved.assignments || {};
    state.design = saved.design || { poles: [], btLines: [], serviceDrops: [], pat: [], retenidas: [], warnings: [] };
    state.catalogs = saved.catalogs || { configuracion: null, suministros: null };
    state.mechanical = saved.mechanical || { spans: [], structures: [] };
    state.lpProject = saved.lpProject || { name: '', code: '', startedAt: '', updatedAt: '' };
    state.startedAt = saved.startedAt || '';
    state.updatedAt = saved.updatedAt || '';
    state.mode = null;
  }

  function storageKey(codigoSED) {
    return `proyectadas_guiadas_${cleanFile(codigoSED)}`;
  }

  function getClients() {
    return state.project?.existingNetwork?.clients || [];
  }

  function parentSedLabel() {
    const sed = state.project?.existingNetwork?.substations?.find((item) => item.id === state.parentSedId);
    return sed ? `${sed.name || sed.id} (${sed.id})` : state.parentSedId || 'No definida';
  }

  async function readKmlKmzLines(file) {
    let kmlText = '';
    if (/\.kmz$/i.test(file.name)) {
      if (!window.JSZip) throw new Error('JSZip no esta disponible para leer KMZ.');
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const entry = Object.values(zip.files).find((item) => /\.kml$/i.test(item.name));
      if (!entry) throw new Error('El KMZ no contiene KML.');
      kmlText = await entry.async('text');
    } else {
      kmlText = await file.text();
    }
    const xmlDoc = new DOMParser().parseFromString(kmlText, 'application/xml');
    return Array.from(xmlDoc.getElementsByTagName('LineString')).map((line) => {
      const text = line.getElementsByTagName('coordinates')[0]?.textContent || '';
      return text.trim().split(/\s+/).map((chunk) => {
        const [lon, lat] = chunk.split(',').map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return latLngToPoint({ lat, lng: lon });
      }).filter(Boolean);
    }).filter((points) => points.length > 1);
  }

  function assignedClients(childSedId) {
    return getClients().filter((client) => state.assignments[client.id] === childSedId);
  }

  function isChildConnected(childSedId) {
    return state.lpConnections.some((line) => line.childSedId === childSedId);
  }

  function densifyRoute(points, maxSpan) {
    const output = [];
    for (let i = 1; i < points.length; i += 1) {
      const start = points[i - 1];
      const end = points[i];
      const len = distance(start, end);
      const parts = Math.max(1, Math.ceil(len / maxSpan));
      for (let part = 1; part <= parts; part += 1) {
        const t = part / parts;
        output.push({
          lat: start.lat + (end.lat - start.lat) * t,
          lon: start.lon + (end.lon - start.lon) * t,
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          zone: '19L'
        });
      }
    }
    return output;
  }

  function densifyFullRoute(points, maxSpan) {
    const valid = validPointList(points);
    if (!valid.length) return [];
    const output = [{ ...valid[0] }];
    for (let i = 1; i < valid.length; i += 1) {
      const segment = densifySegment(valid[i - 1], valid[i], maxSpan);
      segment.slice(1).forEach((point, index) => {
        const isEnd = index === segment.length - 2;
        output.push({
          ...(isEnd ? valid[i] : point),
          fixed: isEnd ? valid[i].fixed : false,
          inserted: !isEnd
        });
      });
    }
    return output;
  }

  function buildLpNetworkFromNodes(fixedNodes, spanMeters, kind) {
    const route = [];
    const poles = [];
    fixedNodes.forEach((node, index) => {
      if (index === 0) route.push(node);
      const next = fixedNodes[index + 1];
      if (!next) return;
      const segmentPoints = densifySegment(node, next, spanMeters);
      segmentPoints.slice(1, -1).forEach((point, poleIndex) => {
        const pole = {
          ...point,
          id: `${kind}_POSTE_${Date.now().toString(36)}_${index + 1}_${poleIndex + 1}`,
          fixed: false,
          role: 'poste_intermedio'
        };
        poles.push(pole);
        route.push(pole);
      });
      route.push(next);
    });
    return {
      id: `${kind}_NET_${Date.now().toString(36)}`,
      kind,
      spanMeters,
      fixedNodes,
      poles,
      route,
      type: `${kind.toLowerCase()}_network`
    };
  }

  function densifySegment(start, end, maxSpan) {
    const len = distance(start, end);
    const parts = Math.max(1, Math.ceil(len / maxSpan));
    const points = [];
    for (let part = 0; part <= parts; part += 1) {
      const t = part / parts;
      points.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        zone: '19L'
      });
    }
    return points;
  }

  function nearestPoint(target, points) {
    let best = null;
    let bestD = Infinity;
    (points || []).forEach((point) => {
      const d = distance(target, point);
      if (d < bestD) {
        bestD = d;
        best = point;
      }
    });
    return best;
  }

  function lineLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
    return total;
  }

  function distance(a, b) {
    if (Number.isFinite(a?.x) && Number.isFinite(a?.y) && Number.isFinite(b?.x) && Number.isFinite(b?.y)) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    const r = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function latLngToPoint(latlng) {
    const utm = wgs84ToUtm(latlng.lat, latlng.lng, 19);
    return {
      lat: latlng.lat,
      lon: latlng.lng,
      x: round(utm.easting, 3),
      y: round(utm.northing, 3),
      zone: '19L'
    };
  }

  function numberFromInput(id, fallback) {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round(Number(value) * factor) / factor;
  }

  function modal(options) {
    if (window.Swal) {
      return Swal.fire({
        heightAuto: false,
        customClass: {
          popup: 'pg-modal',
          title: 'pg-title',
          htmlContainer: 'pg-html',
          confirmButton: 'pg-confirm',
          denyButton: 'pg-deny',
          cancelButton: 'pg-cancel'
        },
        buttonsStyling: false,
        ...options
      });
    }
    const ok = confirm(stripHtml(options.title || 'Continuar'));
    return Promise.resolve({ isConfirmed: ok, isDenied: false, dismiss: !ok, value: options.input ? '' : true });
  }

  function notify(message, type = 'info', duration = 6000) {
    if (typeof showNotification === 'function') showNotification(message, type, duration);
    else console.log(message);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]+>/g, ' ');
  }

  function xml(value) {
    return String(value || '').replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));
  }

  function cleanFile(value) {
    return String(value || 'SED').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  window.abrirRedcadDesignerProyecciones = iniciarProyectadasGuiadas;
  window.iniciarProyectadasGuiadas = iniciarProyectadasGuiadas;
  window.iniciarProyeccionLpMtGeneral = iniciarProyeccionLpMtGeneral;
})();
