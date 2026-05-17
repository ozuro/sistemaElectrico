export function exportProjectedKmz(state) {
  const kml = buildKml(state);
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8' });
  downloadBlob(blob, `redcad_designer_proyectado_${dateStamp()}.kml`);
}

function buildKml(state) {
  const sedPlacemarks = state.projected.childSubstations.map((sed, index) =>
    pointPlacemark('SED proyectadas', `Subestacion ${sed.id || sed.name || index + 1}`, sed, [
      ['Descripcion RedCAD', 'Subestacion'],
      ['Nombre', sed.name || 'SED proyectada'],
      ['Tipo', sed.substationType || '15kVA-2ø-13,2kV']
    ]));
  const polePlacemarks = state.projected.poles.map((pole, index) =>
    pointPlacemark('Postes proyectados', `Poste ${pole.id || pole.name || index + 1}`, pole, [
      ['Descripcion RedCAD', 'Poste BT'],
      ['Armado', pole.armado || pole.type || 'RS-01'],
      ['Mecanico', pole.mecanico || 'CALCULO PRELIMINAR']
    ]));
  const linePlacemarks = [...state.projected.lines, ...state.projected.serviceDrops].map((line) => {
    const isDrop = line.type === 'service_drop';
    return linePlacemark(isDrop ? 'Acometidas BT' : 'Red BT proyectada', isDrop ? `Suministro ${line.clientId || line.id}` : `Tramo BT Aéreo ${line.id}`, line.points, [
      ['Descripcion RedCAD', isDrop ? 'Suministro / Acometida' : 'Tramo BT Aéreo'],
      ['Longitud', `${Math.round(lengthMeters(line.points) || 0)} m`],
      ['Codigo', line.id || '']
    ]);
  });
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

function pointPlacemark(folderName, name, point, rows = []) {
  return `<Placemark><name>${xml(name || folderName)}</name>${description(rows)}<Point><coordinates>${point.lon},${point.lat},0</coordinates></Point></Placemark>`;
}

function linePlacemark(folderName, name, points, rows = []) {
  const coords = points.map((point) => `${point.lon},${point.lat},0`).join(' ');
  return `<Placemark><name>${xml(name || folderName)}</name>${description(rows)}<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString></Placemark>`;
}

function description(rows) {
  if (!rows.length) return '';
  const body = rows.map(([k, v]) => `<p><b>${xml(k)}:</b> ${xml(v)}</p>`).join('');
  return `<description><![CDATA[<div style="font-family:Arial,sans-serif">${body}</div>]]></description>`;
}

function lengthMeters(points = []) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

function distanceMeters(a, b) {
  if (!a || !b) return 0;
  const lat = ((Number(a.lat) || 0) + (Number(b.lat) || 0)) / 2;
  const dx = (Number(b.lon) - Number(a.lon)) * 111320 * Math.cos(lat * Math.PI / 180);
  const dy = (Number(b.lat) - Number(a.lat)) * 111320;
  return Math.hypot(dx, dy);
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
