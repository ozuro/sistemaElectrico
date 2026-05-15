export function exportProjectedKmz(state) {
  const kml = buildKml(state);
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  downloadBlob(blob, `redcad_designer_proyectado_${dateStamp()}.kml`);
}

function buildKml(state) {
  const sedPlacemarks = state.projected.childSubstations.map((sed) => pointPlacemark('SED_PROYECTADAS', sed.name, sed));
  const polePlacemarks = state.projected.poles.map((pole) => pointPlacemark('POSTES_PROYECTADOS', pole.name, pole));
  const linePlacemarks = [...state.projected.lines, ...state.projected.serviceDrops].map((line) => linePlacemark(line.type === 'service_drop' ? 'ACOMETIDAS' : 'BT_PROYECTADA', line.id, line.points));
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>RedCAD Designer Proyectado</name>
    ${folder('SED proyectadas', sedPlacemarks)}
    ${folder('Postes proyectados', polePlacemarks)}
    ${folder('Red proyectada', linePlacemarks)}
  </Document>
</kml>`;
}

function folder(name, placemarks) {
  return `<Folder><name>${xml(name)}</name>${placemarks.join('')}</Folder>`;
}

function pointPlacemark(folderName, name, point) {
  return `<Placemark><name>${xml(name || folderName)}</name><Point><coordinates>${point.lon},${point.lat},0</coordinates></Point></Placemark>`;
}

function linePlacemark(folderName, name, points) {
  const coords = points.map((point) => `${point.lon},${point.lat},0`).join(' ');
  return `<Placemark><name>${xml(name || folderName)}</name><LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
}

function xml(value) {
  return String(value || '').replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 700);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
