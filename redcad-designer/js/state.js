export const defaultRules = {
  btMaxSpanMeters: 75,
  mtLpMaxSpanMeters: 140,
  serviceDropMaxMeters: 25,
  designHorizonYears: 20,
  annualGrowthRate: 0.03,
  duplicatePoleToleranceMeters: 1
};

export const state = {
  project: {
    name: 'Proyecto RedCAD Designer',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  rules: { ...defaultRules },
  existingNetwork: {
    substations: [],
    poles: [],
    btLines: [],
    mtLpLines: [],
    serviceDrops: [],
    clients: []
  },
  newClients: [],
  parentSubstationId: null,
  parentSubstationAction: 'mantener',
  projected: {
    childSubstations: [],
    clientAssignments: {},
    references: {
      bt: [],
      mt: [],
      lp: []
    },
    poles: [],
    lines: [],
    serviceDrops: []
  },
  validations: [],
  warnings: [],
  catalogs: {}
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyStateChanged() {
  state.project.updatedAt = new Date().toISOString();
  listeners.forEach((listener) => listener(state));
}

export function resetProject(payload = {}) {
  Object.assign(state, payload);
  notifyStateChanged();
}

export function setRules(rules) {
  state.rules = { ...state.rules, ...rules };
  notifyStateChanged();
}

export function setExistingNetwork(network) {
  state.existingNetwork = {
    substations: network.substations || [],
    poles: network.poles || [],
    btLines: network.btLines || [],
    mtLpLines: network.mtLpLines || [],
    serviceDrops: network.serviceDrops || [],
    clients: network.clients || []
  };
  state.parentSubstationId = null;
  state.projected.childSubstations = [];
  state.projected.clientAssignments = {};
  notifyStateChanged();
}

export function setNewClients(clients) {
  state.newClients = clients || [];
  notifyStateChanged();
}

export function selectParentSubstation(id) {
  state.parentSubstationId = id;
  notifyStateChanged();
}

export function setParentSubstationAction(action) {
  state.parentSubstationAction = action;
  notifyStateChanged();
}

export function addChildSubstation(child) {
  state.projected.childSubstations.push(child);
  notifyStateChanged();
}

export function setClientAssignments(assignments) {
  state.projected.clientAssignments = assignments || {};
  notifyStateChanged();
}

export function setProjectedNetwork(payload) {
  state.projected = { ...state.projected, ...payload };
  notifyStateChanged();
}

export function setValidations(validations) {
  state.validations = validations || [];
  notifyStateChanged();
}
