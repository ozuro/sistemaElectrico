import { state } from '../state.js';

export function renderLayerPanel() {
  const panel = document.getElementById('layerPanel');
  const existing = state.existingNetwork;
  panel.innerHTML = [
    item('Subestaciones existentes', existing.substations.length),
    item('Postes existentes', existing.poles.length),
    item('Tramos BT existentes', existing.btLines.length),
    item('Tramos MT/LP existentes', existing.mtLpLines.length),
    item('Clientes existentes', existing.clients.length),
    item('Clientes nuevos', state.newClients.length),
    item('SED hijas proyectadas', state.projected.childSubstations.length),
    item('Postes proyectados', state.projected.poles.length)
  ].join('');
}

function item(label, count) {
  return `<div class="item"><strong>${label}</strong><span class="muted">${count} elementos</span></div>`;
}
