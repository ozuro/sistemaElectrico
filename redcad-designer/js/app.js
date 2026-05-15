import {
  resetProject,
  setClientAssignments,
  setExistingNetwork,
  setNewClients,
  setProjectedNetwork,
  setRules,
  setValidations,
  state,
  subscribe
} from './state.js';
import { parseKmzOrKmlFile } from './parsers/kmzParser.js';
import { parseClientWorkbook } from './parsers/redcadConfigParser.js';
import { buildPreliminaryNetwork } from './design/projectedNetworkBuilder.js';
import { assignClientsToNearestChildSed } from './design/userAssignmentService.js';
import { validateProject } from './design/validationEngine.js';
import { buildProjectJson, downloadJson, readProjectJsonFile } from './storage/projectStorage.js';
import { exportProjectedKmz } from './export/kmzExporter.js';
import { initMap, enableCreateChildSed, renderMap } from './ui/mapController.js';
import { renderLayerPanel } from './ui/layerPanel.js';
import { renderSedPanel, renderChildSedPanel } from './ui/sedPanel.js';
import { renderClientPanel } from './ui/clientPanel.js';
import { renderProjectStatus, showToast } from './ui/projectPanel.js';
import { renderValidationPanel } from './ui/validationPanel.js';

initMap();
wireEvents();
subscribe(renderAll);
loadSeedProjectFromMainSystem();
renderAll();

function wireEvents() {
  document.getElementById('existingKmzInput').addEventListener('change', handleExistingKmz);
  document.getElementById('newClientsInput').addEventListener('change', handleNewClients);
  document.getElementById('projectJsonInput').addEventListener('change', handleProjectJson);
  document.getElementById('saveRulesBtn').addEventListener('click', saveRulesFromInputs);
  document.getElementById('drawSedChildBtn').addEventListener('click', () => {
    enableCreateChildSed();
    showToast('Haga click en el mapa para ubicar la SED proyectada hija.');
  });
  document.getElementById('assignNearestBtn').addEventListener('click', assignNearest);
  document.getElementById('generatePrelimBtn').addEventListener('click', generatePreliminary);
  document.getElementById('exportProjectBtn').addEventListener('click', () => {
    downloadJson(`redcad_designer_proyecto_${dateStamp()}.json`, buildProjectJson(state));
  });
  document.getElementById('exportKmzBtn').addEventListener('click', () => exportProjectedKmz(state));
}

function loadSeedProjectFromMainSystem() {
  const raw = sessionStorage.getItem('redcadDesignerSeedProject') || localStorage.getItem('redcadDesignerSeedProject');
  if (!raw) return;
  try {
    const project = JSON.parse(raw);
    sessionStorage.removeItem('redcadDesignerSeedProject');
    localStorage.removeItem('redcadDesignerSeedProject');
    if (project.schema !== 'redcad-designer-project-v1') return;
    resetProject({
      project: project.project,
      rules: project.rules,
      existingNetwork: project.existingNetwork,
      newClients: project.newClients,
      parentSubstationId: project.parentSubstationId,
      parentSubstationAction: project.parentSubstationAction,
      projected: project.projected,
      validations: project.validations,
      warnings: project.warnings,
      catalogs: project.catalogs
    });
    showToast('Red ArcGIS recibida. Seleccione o cree SED hijas para proyectadas.');
  } catch (error) {
    console.error(error);
    showToast(`No se pudo cargar la red enviada: ${error.message}`);
  }
}

async function handleExistingKmz(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    showToast('Leyendo KMZ/KML existente...');
    const network = await parseKmzOrKmlFile(file);
    setExistingNetwork(network);
    showToast(`Red existente cargada: ${network.substations.length} SED, ${network.poles.length} postes, ${network.clients.length} clientes.`);
  } catch (error) {
    console.error(error);
    showToast(`Error al leer KMZ/KML: ${error.message}`);
  }
}

async function handleNewClients(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const clients = await parseClientWorkbook(file);
    setNewClients(clients);
    showToast(`Clientes nuevos cargados: ${clients.length}.`);
  } catch (error) {
    console.error(error);
    showToast(`Error al leer clientes: ${error.message}`);
  }
}

async function handleProjectJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const project = await readProjectJsonFile(file);
    resetProject({
      project: project.project,
      rules: project.rules,
      existingNetwork: project.existingNetwork,
      newClients: project.newClients,
      parentSubstationId: project.parentSubstationId,
      parentSubstationAction: project.parentSubstationAction,
      projected: project.projected,
      validations: project.validations,
      warnings: project.warnings,
      catalogs: project.catalogs
    });
    showToast('Proyecto JSON cargado.');
  } catch (error) {
    console.error(error);
    showToast(`Error al cargar proyecto: ${error.message}`);
  }
}

function saveRulesFromInputs() {
  setRules({
    btMaxSpanMeters: numberInput('ruleBtSpan', 75),
    mtLpMaxSpanMeters: numberInput('ruleMtSpan', 140),
    serviceDropMaxMeters: numberInput('ruleServiceDrop', 25)
  });
  showToast('Reglas guardadas.');
}

function assignNearest() {
  const clients = [...state.existingNetwork.clients, ...state.newClients];
  const assignments = assignClientsToNearestChildSed(clients, state.projected.childSubstations);
  setClientAssignments(assignments);
  showToast(`Asignados ${Object.keys(assignments).length} clientes por cercania.`);
}

function generatePreliminary() {
  const clients = [...state.existingNetwork.clients, ...state.newClients];
  let assignments = state.projected.clientAssignments;
  if (!Object.keys(assignments).length && state.projected.childSubstations.length) {
    assignments = assignClientsToNearestChildSed(clients, state.projected.childSubstations);
    setClientAssignments(assignments);
  }
  const projected = buildPreliminaryNetwork({
    childSubstations: state.projected.childSubstations,
    clients,
    assignments,
    rules: state.rules
  });
  setProjectedNetwork(projected);
  setValidations(validateProject({ ...state, projected: { ...state.projected, ...projected } }));
  showToast('Diseño preliminar generado. Revise validaciones antes de exportar.');
}

function renderAll() {
  renderMap(state);
  renderLayerPanel();
  renderSedPanel();
  renderChildSedPanel();
  renderClientPanel();
  renderValidationPanel();
  renderProjectStatus();
  syncRuleInputs();
}

function syncRuleInputs() {
  document.getElementById('ruleBtSpan').value = state.rules.btMaxSpanMeters;
  document.getElementById('ruleMtSpan').value = state.rules.mtLpMaxSpanMeters;
  document.getElementById('ruleServiceDrop').value = state.rules.serviceDropMaxMeters;
}

function numberInput(id, fallback) {
  const parsed = Number(document.getElementById(id).value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
