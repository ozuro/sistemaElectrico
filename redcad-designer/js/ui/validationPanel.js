import { state } from '../state.js';

export function renderValidationPanel() {
  const panel = document.getElementById('validationPanel');
  if (!state.validations.length) {
    panel.innerHTML = '<div class="empty">Aun no hay validaciones. Genere un preliminar.</div>';
    return;
  }
  panel.innerHTML = state.validations.map((validation) => {
    const cls = validation.level === 'error' ? 'error' : validation.level === 'warning' ? 'warning' : '';
    return `<div class="item ${cls}"><strong>${validation.title}</strong><span>${validation.message}</span></div>`;
  }).join('');
}
