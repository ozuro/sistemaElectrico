import { distanceMeters } from '../gis/geometryUtils.js';

export function validateProject(state) {
  const validations = [];
  const clients = [...state.existingNetwork.clients, ...state.newClients];

  if (!state.parentSubstationId) {
    validations.push(warning('Falta SED padre', 'Seleccione una subestacion existente para usarla como padre.'));
  }

  if (!state.projected.childSubstations.length) {
    validations.push(warning('Faltan SED hijas', 'Cree al menos una subestacion proyectada hija.'));
  }

  clients.forEach((client) => {
    if (!state.projected.clientAssignments[client.id]) {
      validations.push(error('Cliente sin asignar', `${client.name || client.id} no esta asignado a una SED hija.`));
    }
  });

  state.projected.lines.filter((line) => line.type === 'bt').forEach((line) => {
    for (let i = 1; i < line.points.length; i += 1) {
      const span = distanceMeters(line.points[i - 1], line.points[i]);
      if (span > state.rules.btMaxSpanMeters + 0.01) {
        validations.push(error('Vano BT excedido', `${line.id}: ${Math.round(span)} m supera ${state.rules.btMaxSpanMeters} m.`));
      }
    }
  });

  state.projected.serviceDrops.forEach((drop) => {
    const length = distanceMeters(drop.points[0], drop.points[1]);
    if (length > state.rules.serviceDropMaxMeters + 0.01) {
      validations.push(warning('Acometida excedida', `${drop.id}: ${Math.round(length)} m supera ${state.rules.serviceDropMaxMeters} m.`));
    }
  });

  if (!validations.length) {
    validations.push(ok('Validacion preliminar conforme', 'No se detectaron observaciones basicas de vano, acometida o asignacion.'));
  }
  return validations;
}

function ok(title, message) {
  return { level: 'ok', title, message };
}

function warning(title, message) {
  return { level: 'warning', title, message };
}

function error(title, message) {
  return { level: 'error', title, message };
}
