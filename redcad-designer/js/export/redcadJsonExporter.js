import { buildProjectJson } from '../storage/projectStorage.js';

export function buildRedcadTechnicalJson(state) {
  const project = buildProjectJson(state);
  return {
    schema: 'redcad-technical-json-v1',
    warning: 'Exportacion tecnica preliminar. Validar catalogos RedCAD antes de generar XLS final.',
    generatedAt: new Date().toISOString(),
    parentSubstationId: state.parentSubstationId,
    parentSubstationAction: state.parentSubstationAction,
    childSubstations: state.projected.childSubstations,
    structures: state.projected.poles,
    btLines: state.projected.lines,
    serviceDrops: state.projected.serviceDrops,
    assignments: state.projected.clientAssignments,
    rules: state.rules,
    validations: state.validations,
    sourceProject: project
  };
}
