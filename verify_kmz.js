const fs = require('fs');
const path = require('path');

function findPlaywright() {
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  const dirs = fs.existsSync(cacheRoot)
    ? fs.readdirSync(cacheRoot).map((name) => path.join(cacheRoot, name))
    : [];
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'node_modules', 'playwright');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'playwright';
}

const { chromium } = require(findPlaywright());

function feature(geometry, attributes = {}) {
  return { geometry, attributes };
}

function payload(layerId) {
  switch (layerId) {
    case 96:
      return [feature({ x: -69.9708, y: -15.5506 }, {
        SED_COD_SED: 'SEDTEST',
        SED_NOM_SED: 'Subestacion demo',
        SED_POT_INST: 100,
        SED_TEN_NOM_PRI: 10
      })];
    case 24:
      return [feature({ x: -69.9701, y: -15.5501 }, {
        SUM_COD_SUM: 'SUM-1',
        SUM_NOM_SUM: 'Juan Perez',
        SUM_DIR_SUM: 'Calle Demo 123',
        SUM_MAX_DEM: 1.2,
        SUM_POT_EQT: 2.4,
        SUM_TEN_SUM: 220,
        SUM_MED_FAS: 'M'
      })];
    case 25:
      return [feature({ paths: [[[-69.9703, -15.5503], [-69.9698, -15.5500]]] }, { TBT_COD_TIP_RED: 'A', TBT_COD_TBT: 'T-1' })];
    case 27:
      return [
        feature({ x: -69.9703, y: -15.5503 }, {
          NOD_COD_NOD: 'P-1',
          NOD_ALT_SPT: 9,
          NOD_COD_MAT_SPT: 'CO',
          NOD_COD_TIP_SPT: 'BIP',
          NOD_COD_FNC: 'ALI',
          NOD_COD_TIP_ARM_01: 'ARM1',
          NOD_EST_CONS: 'B'
        }),
        feature({ x: -69.9698, y: -15.5500 }, {
          NOD_COD_NOD: 'P-2',
          NOD_ALT_SPT: 8.5,
          NOD_COD_MAT_SPT: 'CO',
          NOD_COD_TIP_SPT: 'BIP',
          NOD_COD_FNC: 'CAD',
          NOD_COD_TIP_ARM_01: 'ARM1',
          NOD_EST_CONS: 'B'
        })
      ];
    case 28:
      return [feature({ x: -69.9704, y: -15.5504 }, { RET_COD_RET: 'R-1', RET_COD_NOD: 'P-1', RET_TIP_RET: 'R' })];
    case 29:
      return [feature({ x: -69.97025, y: -15.55025 }, { PAT_COD_PAT: 'PAT-1', PAT_COD_NOD: 'P-1', PAT_TIP_PAT: 'T', PAT_RES: 12 })];
    case 33:
      return [feature({ paths: [[[-69.9703, -15.5503], [-69.9698, -15.5500]]] }, {
        TBT_COD_TIP_RED: 'A',
        TBT_COD_TBT: 'T-1',
        TBT_SP_MAT_CND: 'CU',
        TBT_SP_SEC_CND: 35,
        TBT_COD_TEC_FAS: 'ABC'
      })];
    default:
      return [];
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true
  });

  const page = await browser.newPage({ acceptDownloads: true });
  await page.setContent(`
    <input id="inputID" value="SEDTEST">
    <script>
      window.transformadorSeleccionado = 'SEDTEST';
      window.__payload = null;
      window.showNotification = () => {};
      window.showLoadingMessage = () => {};
      window.hideLoadingMessage = () => {};
      window.whereEquals = (field, value) => field + " = '" + value + "'";
      window.getValue = (attrs, fields, fallback = 'N/A') => {
        for (const field of fields || []) {
          const value = attrs && attrs[field];
          if (value !== undefined && value !== null && value !== '') return value;
        }
        return fallback;
      };
      window.consultarArcgisReporte = async (layerId) => window.__payload(layerId);
    </script>
  `);
  await page.exposeFunction('__payload', payload);
  await page.addScriptTag({ path: path.join(__dirname, 'assets/js/kmz/reporte-kmz-redlin.js') });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.generarReporteKMZ('SEDTEST'))
  ]);

  const downloadPath = await download.path();
  const text = fs.readFileSync(downloadPath).toString('utf8');
  if (!download.suggestedFilename().endsWith('.kmz')) throw new Error('No se descargo KMZ');
  if (!text.includes('doc.kml')) throw new Error('Falta doc.kml');
  if (!text.includes('Titular')) throw new Error('Falta balloon de suministro');
  if (!text.includes('Altura')) throw new Error('Falta balloon de poste');
  if (!text.includes('Longitud')) throw new Error('Falta balloon de cable');
  if (!text.includes('Subestacion')) throw new Error('Falta balloon de trafo');

  console.log(JSON.stringify({ ok: true, file: download.suggestedFilename(), bytes: fs.statSync(downloadPath).size }, null, 2));
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
