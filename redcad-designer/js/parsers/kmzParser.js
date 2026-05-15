import { parseKmlText } from './kmlParser.js';

export async function parseKmzOrKmlFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kml')) {
    return parseKmlText(await file.text());
  }
  if (!window.JSZip) throw new Error('JSZip no esta cargado. No se puede leer KMZ.');
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const kmlEntry = Object.values(zip.files).find((entry) => entry.name.toLowerCase().endsWith('.kml'));
  if (!kmlEntry) throw new Error('El KMZ no contiene KML interno.');
  return parseKmlText(await kmlEntry.async('text'));
}
