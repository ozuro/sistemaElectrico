import { state } from '../state.js';

export function renderProjectStatus() {
  const el = document.getElementById('projectStatus');
  const parent = state.parentSubstationId ? 'SED padre seleccionada' : 'sin SED padre';
  el.textContent = `${parent} | ${state.projected.childSubstations.length} hijas | ${state.validations.length} validaciones`;
}

export function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}
