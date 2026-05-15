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
    startedAt: '',
    updatedAt: '',
    mode: null,
    selectedChildId: null,
    selectedClientIds: new Set(),
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
    if (!state.parentSedId) state.parentSedId = 'LP_MT_GENERAL';
    if (!state.project) {
      state.project = {
        parentSubstationId: state.parentSedId,
        existingNetwork: { clients: [], substations: [], poles: [], btLines: [], mtLpLines: [] }
      };
    }
    const result = await modal({
      title: 'Proyectar LP/MT',
      html: `
        <div style="text-align:left">
          <div class="pg-card">
            <p>Esta opcion es solo para <b>LP/MT</b>: puede subir un KMZ/KML o trazar manualmente la ruta.</p>
          </div>
          <p style="font-size:12px;color:#64748b">Para proyectar BT, seleccione una subestacion existente y use "Proyectar BT desde esta SED".</p>
        </div>
      `,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Subir KMZ/KML LP/MT',
      denyButtonText: 'Trazar LP/MT manual',
      cancelButtonText: 'Cancelar'
    });
    if (result.isConfirmed) return askLpReference();
    if (result.isDenied) return startManualLpReference();
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

  async function showMainMenu() {
    const clientsCount = getClients().length;
    const connected = state.childSeds.filter((sed) => isChildConnected(sed.id)).length;
    const html = `
      <div style="text-align:left">
        <p><b>SED padre:</b> ${escapeHtml(state.parentSedId)}</p>
        <p><b>SED proyectadas:</b> ${state.childSeds.length} | <b>alimentadas por LP/MT:</b> ${connected}</p>
        <p><b>Clientes disponibles:</b> ${clientsCount} | <b>clientes asignados:</b> ${Object.keys(state.assignments).length}</p>
        <p style="font-size:12px;color:#64748b">Flujo BT: crear SED hija -> conectarla a LP/MT -> seleccionar clientes -> trazar BT -> calcular.</p>
      </div>
    `;
    const result = await modal({
      title: 'Proyectar BT desde SED padre',
      html,
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Crear SED hija',
      denyButtonText: 'Conectar SED hija a LP/MT',
      cancelButtonText: 'Mas opciones'
    });

    if (result.isConfirmed) return startCreateChildSed();
    if (result.isDenied) return chooseChildForLp();
    if (result.dismiss) return showMoreOptions();
  }

  async function showMoreOptions() {
    const result = await modal({
      title: 'Opciones de proyectadas',
      input: 'select',
      inputOptions: {
        clients: 'BT: seleccionar clientes para SED hija',
        bt: 'BT: trazar red principal',
        branch: 'BT: nueva derivacion desde poste',
        finishbt: 'BT: terminar trazo actual',
        catalogs: 'Cargar catalogos RedCAD opcional',
        calc: 'Generar calculo preliminar',
        kmz: 'Descargar KMZ proyectado',
        json: 'Descargar JSON proyectado',
        clean: 'Limpiar proyectadas'
      },
      inputPlaceholder: 'Elija una opcion',
      showCancelButton: true,
      confirmButtonText: 'Continuar'
    });
    if (!result.isConfirmed || !result.value) return;
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
      notify('Proyectadas limpiadas.', 'success');
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
    return {
      name: file.name,
      sheets: workbook.SheetNames,
      loadedAt: new Date().toISOString()
    };
  }

  async function askLpReference() {
    const result = await modal({
      title: 'LP/MT de referencia',
      html: `
        <div style="text-align:left">
          <p>Puede subir un KMZ/KML de LP/MT o trazarla manualmente en el mapa.</p>
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
      notify(`LP/MT de referencia cargada: ${refs.length} trazo(s).`, 'success', 7000);
    } catch (error) {
      console.error(error);
      notify(`No se pudo cargar LP/MT: ${error.message}`, 'error', 8000);
    }
  }

  async function startManualLpReference() {
    const result = await modal({
      title: 'Tipo de trazo',
      html: '<div class="pg-card" style="text-align:left">Indique si la referencia que trazara es LP o MT.</div>',
      input: 'select',
      inputOptions: {
        LP: 'LP - Linea primaria',
        MT: 'MT - Media tension'
      },
      inputValue: state.tempLpKind || 'LP',
      showCancelButton: true,
      confirmButtonText: 'Iniciar trazo'
    });
    if (!result.isConfirmed) return;
    state.tempLpKind = result.value || 'LP';
    state.tempLpSpan = state.tempLpKind === 'MT' ? 120 : 140;
    state.mode = 'draw-lp-reference';
    state.tempBtPoints = [];
    showTraceToolbar(`${state.tempLpKind}: click agrega punto, arrastre puntos para corregir`);
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
    notify('Trazo LP/MT cancelado.', 'info', 5000);
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
        <input id="pgLpSpan" class="swal2-input" type="number" min="30" value="${state.tempLpSpan || (kind === 'MT' ? 120 : 140)}" placeholder="Distancia promedio entre postes (m)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar con postes',
      preConfirm: () => ({
        span: numberFromInput('pgLpSpan', kind === 'MT' ? 120 : 140)
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
      notify('SED hija creada. Ahora conectela con llegada LP/MT.', 'success', 7000);
      chooseChildForLp();
    });
  }

  async function chooseChildForLp() {
    const child = await chooseChildSed('Seleccione la SED hija que recibira LP/MT', 'Primero se muestra la SED padre existente. Luego seleccione cual hija/proyectada sera alimentada.');
    if (!child) return;
    return connectSpecificChildLp(child);
  }

  function connectSpecificChildLp(child) {
    state.selectedChildId = child.id;
    state.mode = 'lp-start';
    notify('Seleccione con click el poste existente o punto de LP/MT de origen.', 'info', 9000);
    map.once('click', (event) => {
      state.tempLpStart = latLngToPoint(event.latlng);
      state.mode = 'lp-end';
      notify('Ahora haga click sobre la SED proyectada o punto final de llegada LP/MT.', 'info', 9000);
      map.once('click', () => {
        const target = state.childSeds.find((sed) => sed.id === state.selectedChildId);
        if (!target) return;
        state.lpConnections.push({
          id: `LP_${Date.now().toString(36)}`,
          childSedId: target.id,
          points: [state.tempLpStart, target],
          type: 'lp_connection'
        });
        target.connected = true;
        state.tempLpStart = null;
        saveProject();
        renderProjected();
        notify('Llegada LP/MT conectada. La SED proyectada queda habilitada para BT.', 'success', 8000);
        chooseChildForClients();
      });
    });
  }

  async function chooseChildForClients() {
    const child = await chooseChildSed('Seleccione SED hija para asignar clientes', 'Los clientes seleccionados pasaran de la SED padre a esta SED hija/proyectada.');
    if (!child) return;
    return chooseChildForClientsFixed(child);
  }

  async function chooseChildForClientsFixed(child) {
    if (!isChildConnected(child.id)) {
      notify('Primero conecte la SED hija con LP/MT. Sin llegada de energia no se habilita BT.', 'error', 9000);
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
    const child = await chooseChildSed('Seleccione SED hija para trazar BT', 'Solo se puede trazar BT si la SED hija ya tiene llegada LP/MT.');
    if (!child) return;
    return chooseChildForBtFixed(child);
  }

  function chooseChildForBtFixed(child) {
    if (!isChildConnected(child.id)) {
      notify('Debe conectar primero la llegada LP/MT antes de trazar BT.', 'error', 9000);
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
    notify('Trace BT: cada click crea un poste por defecto. Doble click para terminar o use Hacer proyecciones > BT: terminar trazo actual.', 'info', 14000);
    map.on('click', onBtClick);
    map.once('dblclick', finishBtRoute);
  }

  async function chooseChildForBtBranch() {
    const child = await chooseChildSed('Seleccione SED hija para derivacion BT', 'Luego haga click en un poste/punto azul de una BT ya trazada.');
    if (!child) return;
    if (!isChildConnected(child.id)) {
      notify('Debe conectar primero la llegada LP/MT antes de derivar BT.', 'error', 9000);
      return chooseChildForLp();
    }
    state.selectedChildId = child.id;
    state.mode = 'select-bt-branch-start';
    renderProjected();
    notify('Seleccione el poste intermedio o punto BT desde donde saldra la derivacion.', 'info', 12000);
  }

  function startBtBranchFromPoint(point) {
    state.tempBtPoints = [point];
    state.mode = 'draw-bt';
    renderProjected();
    notify('Derivacion BT iniciada. Cada click agrega un poste. Doble click para terminar.', 'info', 12000);
    map.on('click', onBtClick);
    map.once('dblclick', finishBtRoute);
  }

  function onBtClick(event) {
    if (state.mode !== 'draw-bt') return;
    state.tempBtPoints.push(latLngToPoint(event.latlng));
    saveProject();
    renderProjected();
  }

  function finishBtRoute(event = null) {
    if (event?.originalEvent) L.DomEvent.stop(event);
    map.off('click', onBtClick);
    if (state.tempBtPoints.length < 2) {
      notify('Ruta BT cancelada: necesita al menos dos puntos.', 'error');
      state.mode = null;
      return;
    }
    state.btRoutes.push({
      id: `BTREF_${Date.now().toString(36)}`,
      childSedId: state.selectedChildId,
      points: state.tempBtPoints.slice(),
      type: 'bt_reference'
    });
    state.tempBtPoints = [];
    state.mode = null;
    saveProject();
    renderProjected();
    notify('Referencia BT guardada. Ahora puede generar calculo preliminar.', 'success', 9000);
  }

  async function askCalculationRules() {
    if (!state.childSeds.length) {
      notify('Primero cree SED proyectadas.', 'error');
      return;
    }
    const disconnected = state.childSeds.filter((sed) => !isChildConnected(sed.id));
    if (disconnected.length) {
      notify('Hay SED proyectadas sin llegada LP/MT. Conectelas antes del calculo.', 'error', 10000);
      return chooseChildForLp();
    }

    const result = await modal({
      title: 'Parametros de calculo preliminar',
      html: `
        <input id="pgBtSpan" class="swal2-input" type="number" value="75" placeholder="Vano maximo BT (m)">
        <input id="pgMtSpan" class="swal2-input" type="number" value="140" placeholder="Vano maximo LP/MT (m)">
        <input id="pgDrop" class="swal2-input" type="number" value="25" placeholder="Acometida maxima (m)">
        <input id="pgFall" class="swal2-input" type="number" value="5" placeholder="Caida maxima permitida (%)">
      `,
      showCancelButton: true,
      confirmButtonText: 'Calcular',
      preConfirm: () => ({
        btSpan: numberFromInput('pgBtSpan', 75),
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
        const poles = densifyRoute(route.points, rules.btSpan).map((point, index) => ({
          id: `PBT_${sed.id}_${state.design.poles.length + index + 1}`,
          childSedId: sed.id,
          ...point
        }));
        state.design.poles.push(...poles);
        state.design.btLines.push({ id: `BT_${route.id}`, childSedId: sed.id, points: [sed, ...poles], type: 'bt' });
        if (poles.length) {
          state.design.retenidas.push({ id: `RET_INI_${route.id}`, point: poles[0], reason: 'inicio/terminal BT' });
          state.design.retenidas.push({ id: `RET_FIN_${route.id}`, point: poles[poles.length - 1], reason: 'terminal BT' });
        }
      });

      assignedClients(sed.id).forEach((client) => {
        const nearest = nearestPoint(client, state.design.poles.filter((pole) => pole.childSedId === sed.id));
        const source = nearest || sed;
        const length = distance(source, client);
        state.design.serviceDrops.push({ id: `ACO_${client.id}`, childSedId: sed.id, clientId: client.id, points: [source, client], length });
        if (length > rules.dropMax) {
          state.design.warnings.push(`Acometida ${client.id}: ${Math.round(length)} m supera ${rules.dropMax} m.`);
        }
      });
    });

    estimateVoltageDrop(rules);
    saveProject();
    renderProjected();
    showCalculationSummary(rules);
  }

  function estimateVoltageDrop(rules) {
    const totalBt = state.design.btLines.reduce((sum, line) => sum + lineLength(line.points), 0);
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
          <p><b>Postes proyectados:</b> ${state.design.poles.length}</p>
          <p><b>Tramos BT:</b> ${state.design.btLines.length}</p>
          <p><b>Acometidas:</b> ${state.design.serviceDrops.length}</p>
          <p><b>PAT:</b> ${state.design.pat.length}</p>
          <p><b>Retenidas:</b> ${state.design.retenidas.length}</p>
          <p><b>Caida preliminar:</b> ${state.design.voltageDropPct || 0}%</p>
          <p><b>Reglas:</b> BT ${rules.btSpan} m, LP/MT ${rules.mtSpan} m, acometida ${rules.dropMax} m.</p>
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
      updateMechanicalModel();
      state.lpReferences.forEach((line) => addPolyline(line.points, line.kind === 'MT' ? '#dc2626' : '#f97316', 3, `${line.kind || 'LP'} referencia`, draft, '8 6'));
      state.lpNetworks.forEach((network) => {
        addPolyline(network.route, network.kind === 'MT' ? '#b91c1c' : '#ea580c', 4, `${network.kind} proyectada con postes`, draft);
        network.fixedNodes.forEach((node) => {
          L.circleMarker([node.lat, node.lon], {
            radius: 6,
            color: '#111827',
            fillColor: network.kind === 'MT' ? '#fecaca' : '#fed7aa',
            fillOpacity: 1,
            weight: 2
          }).bindTooltip(`${network.kind} nodo fijo`).addTo(draft);
        });
        network.poles.forEach((pole) => {
          L.circleMarker([pole.lat, pole.lon], {
            radius: 5,
            color: network.kind === 'MT' ? '#991b1b' : '#9a3412',
            fillColor: '#fff7ed',
            fillOpacity: 1,
            weight: 2
          }).bindTooltip(`${network.kind} poste intermedio`).addTo(draft);
        });
      });
      state.lpConnections.forEach((line) => addPolyline(line.points, '#16a34a', 4, 'Conexion LP/MT a SED proyectada', draft));
      state.btRoutes.forEach((line) => addPolyline(line.points, '#2563eb', 3, 'Referencia BT', draft, '6 5'));
      if (state.tempBtPoints.length > 1) addPolyline(state.tempBtPoints, '#60a5fa', 2, 'BT temporal', draft, '4 6');
      renderBtReferencePoles(draft);
      renderTempBtPoles(draft);
      state.design.btLines.forEach((line) => addPolyline(line.points, '#0ea5e9', 4, 'BT proyectada', draft));
      state.design.serviceDrops.forEach((line) => addPolyline(line.points, '#9333ea', 2, 'Acometida proyectada', draft, '3 5'));

      state.design.poles.forEach((pole) => {
        L.circleMarker([pole.lat, pole.lon], { radius: 5, color: '#111827', fillColor: '#e5e7eb', fillOpacity: 1, weight: 2 })
          .bindTooltip(pole.id)
          .addTo(draft);
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
      }).bindPopup(`<b>${escapeHtml(sed.name)}</b><br>Padre: ${escapeHtml(sed.parentId)}<br>${sed.connected ? 'Conectada LP/MT' : 'Sin llegada LP/MT'}<br><small>Click: opciones de esta SED hija</small>`);
      marker.on('click', () => openChildSedActions(sed.id));
      marker.addTo(layer);
      marker.bringToFront?.();
    });
  }

  function renderBtReferencePoles(layer) {
    state.btRoutes.forEach((route) => {
      validPointList(route.points).forEach((point, index) => {
        if (index === 0) return;
        const marker = L.circleMarker([point.lat, point.lon], {
          radius: 5,
          color: '#1d4ed8',
          fillColor: '#bfdbfe',
          fillOpacity: 1,
          weight: 2
        }).bindTooltip(index === 0 ? 'SED' : `Poste BT referencia ${index}`);
        marker.on('click', () => {
          if (state.mode === 'select-bt-branch-start' && route.childSedId === state.selectedChildId) {
            startBtBranchFromPoint(point);
          }
        });
        marker.addTo(layer);
      });
    });
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

    (state.mechanical.structures || []).forEach((item) => {
      if (!isValidPoint(item.point)) return;
      const color = item.network === 'BT' ? '#1d4ed8' : item.network === 'MT' ? '#991b1b' : '#9a3412';
      L.circleMarker([item.point.lat, item.point.lon], {
        radius: 4,
        color,
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 2
      }).bindTooltip(`${item.network} | ${item.armado} | ${item.mecanico}`).addTo(layer);
    });
  }

  function updateMechanicalModel() {
    const spans = [];
    const structures = [];
    const networks = [];

    state.lpNetworks.forEach((network) => networks.push({ network: network.kind || 'LP', points: validPointList(network.route) }));
    state.lpConnections.forEach((line) => networks.push({ network: 'LP', points: validPointList(line.points) }));
    state.btRoutes.forEach((line) => networks.push({ network: 'BT', points: validPointList(line.points) }));
    state.design.btLines.forEach((line) => networks.push({ network: 'BT', points: validPointList(line.points) }));

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
          armado: classifyArmado(prev, point, next),
          mecanico: classifyMechanical(prev, point, next)
        });
      });
    });

    state.childSeds.forEach((sed) => {
      structures.push({
        network: 'SED',
        point: sed,
        armado: 'SUBESTACION',
        mecanico: sed.connected ? 'ALIMENTADA' : 'PENDIENTE LP/MT'
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
            html: `<div style="width:14px;height:14px;border-radius:50%;background:${state.tempLpKind === 'MT' ? '#dc2626' : '#f97316'};border:3px solid white;box-shadow:0 1px 6px rgba(0,0,0,.35)"></div>`,
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
      }).bindTooltip(state.mode === 'draw-bt' ? `Poste BT ${index}` : `Punto LP/MT ${index + 1}`).addTo(layer);
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
          <p><b>Estado LP/MT:</b> ${child.connected ? 'Conectada' : 'Pendiente'}</p>
          <p><b>Clientes asignados:</b> ${stats.clients}</p>
          <p><b>Distancia minima a clientes:</b> ${stats.minDistance} m</p>
          <p><b>Distancia promedio a clientes:</b> ${stats.avgDistance} m</p>
          <p><b>Capacidad referencial:</b> ${child.capacityKva || 0} kVA</p>
        </div>
      `,
      input: 'select',
      inputOptions: {
        lp: 'Conectar a red LP/MT',
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
    if (result.value === 'lp') return connectSpecificChildLp(child);
    if (result.value === 'clients') return chooseChildForClientsFixed(child);
    if (result.value === 'exclude') return excludeClientsFromChild(child);
    if (result.value === 'bt') return chooseChildForBtFixed(child);
    if (result.value === 'calc') return askCalculationRules();
    if (result.value === 'kmz') return exportKmz();
    if (result.value === 'json') return exportJson();
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

  function showTraceToolbar(label) {
    hideTraceToolbar();
    traceToolbar = document.createElement('div');
    traceToolbar.className = 'pg-trace-toolbar';
    traceToolbar.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <button type="button" id="pgUndoTrace" class="pg-muted">Deshacer punto</button>
      <button type="button" id="pgSaveTrace">Guardar trazo</button>
      <button type="button" id="pgCancelTrace" class="pg-danger">Cancelar</button>
    `;
    document.body.appendChild(traceToolbar);
    document.getElementById('pgUndoTrace').onclick = undoLpReferencePoint;
    document.getElementById('pgSaveTrace').onclick = () => finishLpReference();
    document.getElementById('pgCancelTrace').onclick = cancelLpReference;
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
      options[sed.id] = `${sed.name} ${sed.connected ? '(con LP/MT)' : '(sin LP/MT)'}`;
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

  function exportKmz() {
    const kml = buildProjectedKml();
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proyectadas_${cleanFile(state.parentSedId)}_${new Date().toISOString().slice(0, 10)}.kml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
    notify('KMZ/KML proyectado descargado.', 'success');
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

  function buildProjectedKml() {
    const placemarks = [];
    state.childSeds.forEach((sed) => placemarks.push(pointKml(sed.name, sed)));
    state.design.poles.forEach((pole) => placemarks.push(pointKml(pole.id, pole)));
    state.lpConnections.forEach((line) => placemarks.push(lineKml(line.id, line.points)));
    state.lpNetworks.forEach((network) => {
      placemarks.push(lineKml(network.id, network.route));
      validPointList(network.fixedNodes).forEach((node) => placemarks.push(pointKml(node.id, node)));
      validPointList(network.poles).forEach((pole) => placemarks.push(pointKml(pole.id, pole)));
    });
    state.design.btLines.forEach((line) => placemarks.push(lineKml(line.id, line.points)));
    state.design.serviceDrops.forEach((line) => placemarks.push(lineKml(line.id, line.points)));
    (state.mechanical.structures || []).forEach((item, index) => placemarks.push(pointKml(`${item.network}_${item.armado}_${index + 1}`, item.point)));
    return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proyectadas ${xml(state.parentSedId)}</name>${placemarks.join('')}</Document></kml>`;
  }

  function pointKml(name, point) {
    if (!isValidPoint(point)) return '';
    return `<Placemark><name>${xml(name)}</name><Point><coordinates>${point.lon},${point.lat},0</coordinates></Point></Placemark>`;
  }

  function lineKml(name, points) {
    const validPoints = validPointList(points);
    if (validPoints.length < 2) return '';
    return `<Placemark><name>${xml(name)}</name><LineString><tessellate>1</tessellate><coordinates>${validPoints.map((p) => `${p.lon},${p.lat},0`).join(' ')}</coordinates></LineString></Placemark>`;
  }

  function resetDesign() {
    state.childSeds = [];
    state.lpConnections = [];
    state.lpReferences = [];
    state.lpNetworks = [];
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
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString()
    };
  }

  function saveProject() {
    if (!state.parentSedId) return;
    state.updatedAt = new Date().toISOString();
    normalizeProjectState();
    localStorage.setItem(storageKey(state.parentSedId), JSON.stringify(buildProjectSnapshot()));
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
