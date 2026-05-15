import { setParentSubstationAction, state } from '../state.js';

export function renderSedPanel() {
  const panel = document.getElementById('sedPanel');
  const sed = state.existingNetwork.substations.find((item) => item.id === state.parentSubstationId);
  if (!sed) {
    panel.className = 'empty';
    panel.innerHTML = 'Cargue KMZ/KML y seleccione una SED en el mapa.';
    return;
  }
  panel.className = 'item';
  panel.innerHTML = `
    <strong>${escapeHtml(sed.name)}</strong>
    <div class="muted">${escapeHtml(sed.id)}</div>
    <label>Accion sobre SED padre
      <select id="parentSedAction">
        <option value="mantener">Mantener</option>
        <option value="desmontar">Desmontar</option>
        <option value="reubicar">Reubicar</option>
        <option value="dividir">Dividir en SED hijas</option>
      </select>
    </label>
  `;
  const select = document.getElementById('parentSedAction');
  select.value = state.parentSubstationAction;
  select.addEventListener('change', () => setParentSubstationAction(select.value));
}

export function renderChildSedPanel() {
  const panel = document.getElementById('childSedPanel');
  if (!state.projected.childSubstations.length) {
    panel.innerHTML = '<div class="empty">Use "Crear SED hija" y haga click en el mapa.</div>';
    return;
  }
  panel.innerHTML = state.projected.childSubstations.map((sed) => `
    <div class="item">
      <strong>${escapeHtml(sed.name)}</strong>
      <div class="muted">Padre: ${escapeHtml(sed.parentId)}</div>
      <div>Capacidad: ${Number(sed.capacityKva || 0)} kVA</div>
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
