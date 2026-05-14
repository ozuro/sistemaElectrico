const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.REDCAD_PORT || 8765);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'exportar_redcad_com.ps1');
const LOG = path.join(__dirname, 'redcad_local_server.log');

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\r\n`;
  fs.appendFileSync(LOG, line, 'utf8');
  console.log(message);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cleanCode(value) {
  return String(value || 'SED')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 32) || 'SED';
}

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, {
      cwd: ROOT,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const output = (stderr || stdout || `PowerShell termino con codigo ${code}`).trim();
        log(`PowerShell error ${code}: ${output}`);
        reject(new Error(output));
      }
    });
  });
}

async function generarXls(req, res) {
  try {
    const payload = await collect(req);
    const data = JSON.parse(payload.toString('utf8'));
    if (!data || !Array.isArray(data.estructuras)) throw new Error('JSON RedCAD invalido.');

    const sed = cleanCode(data.sed);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redcad-'));
    const jsonPath = path.join(workDir, `redcad_data_${sed}.json`);
    const outputPath = path.join(workDir, `redcad_export_${sed}.xls`);
    const debugPath = path.join(path.dirname(outputPath), 'debug_redcad.geojson');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');

    await runPowerShell([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-STA',
      '-File',
      SCRIPT,
      '-JsonDataPath',
      jsonPath,
      '-OutputPath',
      outputPath
    ]);

    if (!fs.existsSync(outputPath)) throw new Error('El generador local no produjo el XLS.');
    const output = fs.readFileSync(outputPath);
    if (data.debug_geojson) {
      const downloadsDebug = path.join(os.homedir(), 'Downloads', 'debug_redcad.geojson');
      fs.writeFileSync(downloadsDebug, JSON.stringify(data.debug_geojson, null, 2), 'utf8');
      fs.writeFileSync(debugPath, JSON.stringify(data.debug_geojson, null, 2), 'utf8');
    }
    cors(res);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="redcad_export_${sed}.xls"`,
      'Content-Length': output.length
    });
    res.end(output);
    setTimeout(() => fs.rm(workDir, { recursive: true, force: true }, () => {}), 5000);
  } catch (error) {
    log(`Export error: ${error.stack || error.message}`);
    const needsExcel = /Excel\.Application|80070520|0x80040154|NoCOMClass|No se pudo recuperar el generador de clases COM|ActiveX/i.test(error.message);
    json(res, 500, {
      error: needsExcel
        ? `No se pudo iniciar Microsoft Excel por COM. Verifique que Excel de escritorio este instalado y abra Excel una vez. Detalle: ${error.message}`
        : error.message
    });
  }
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && req.url === '/redcad/generar-xls') {
    generarXls(req, res);
    return;
  }
  json(res, 404, { error: 'Ruta no encontrada.' });
});

server.listen(PORT, HOST, () => {
  log(`Generador local RedCAD listo en http://${HOST}:${PORT}`);
  log('Mantenga esta ventana abierta mientras usa Generar XLS RedCAD.');
});
