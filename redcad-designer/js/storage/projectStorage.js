export function buildProjectJson(state) {
  return {
    schema: 'redcad-designer-project-v1',
    exportedAt: new Date().toISOString(),
    project: state.project,
    rules: state.rules,
    existingNetwork: state.existingNetwork,
    newClients: state.newClients,
    parentSubstationId: state.parentSubstationId,
    parentSubstationAction: state.parentSubstationAction,
    projected: state.projected,
    validations: state.validations,
    warnings: state.warnings,
    catalogs: state.catalogs
  };
}

export async function readProjectJsonFile(file) {
  const data = JSON.parse(await file.text());
  if (data.schema !== 'redcad-designer-project-v1') {
    throw new Error('El JSON no corresponde a un proyecto RedCAD Designer.');
  }
  return data;
}

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 600);
}
