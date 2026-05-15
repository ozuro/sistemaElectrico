import { state } from '../state.js';

export function renderClientPanel() {
  const panel = document.getElementById('clientPanel');
  const existing = state.existingNetwork.clients.length;
  const news = state.newClients.length;
  const assigned = Object.keys(state.projected.clientAssignments).length;
  panel.innerHTML = `
    <div class="item"><strong>Existentes KMZ/KML</strong><span class="muted">${existing}</span></div>
    <div class="item"><strong>Nuevos Excel/CSV</strong><span class="muted">${news}</span></div>
    <div class="item"><strong>Asignados a SED hija</strong><span class="muted">${assigned}</span></div>
  `;
}
