// Serveur sans dépendances : sert public/ et fait proxy de /comfy/* vers ComfyUI (HTTP + WebSocket).
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const COMFY_URL = new URL(process.env.COMFY_URL || 'http://127.0.0.1:8188');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUTPUT_DIR = path.join(__dirname, 'output');
const VOICES_DIR = path.join(__dirname, 'voices');
const VOICES_INDEX = path.join(VOICES_DIR, 'voices.json');
const HISTORY_FILE = path.join(OUTPUT_DIR, 'history.json');
const PRESETS_FILE = path.join(__dirname, 'data', 'presets.json');
const PREFIX = '/comfy';
const OUTPUT_PREFIX = '/output/';
const VOICES_PREFIX = '/voices/';
const COMFY_SUBFOLDER = 'musiquegenerator';
const MAX_VOICE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 300 * 1024 * 1024; // WAV retouché : ~10 Mo par minute en stéréo
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.webm'];
const YTDLP = process.env.YTDLP || 'yt-dlp';
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];
const YOUTUBE_MAX_SECONDS = 10 * 60;
const YOUTUBE_TIMEOUT_MS = 5 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};

function comfyPath(url) {
  return url.slice(PREFIX.length) || '/';
}

function proxyHttp(req, res) {
  const headers = { ...req.headers, host: COMFY_URL.host };
  // ComfyUI rejette les requêtes dont l'Origin ne correspond pas à son hôte.
  delete headers.origin;
  delete headers.referer;
  const upstream = http.request(
    {
      hostname: COMFY_URL.hostname,
      port: COMFY_URL.port || 80,
      method: req.method,
      path: comfyPath(req.url),
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: `ComfyUI injoignable (${COMFY_URL.origin}) : ${err.message}` }));
  });
  req.pipe(upstream);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`fichier trop volumineux (max ${limit / 1024 / 1024} Mo)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Horodatage en heure locale : AAAA-MM-JJ_HH-MM-SS
function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Fichier JSON (tableau) dont les écritures sont sérialisées pour ne rien perdre si deux requêtes arrivent ensemble.
function createStore(filePath) {
  let lock = Promise.resolve();
  async function read() {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    } catch {
      return [];
    }
  }
  function update(change) {
    const run = lock.then(async () => {
      const next = change(await read());
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(next, null, 2));
    });
    lock = run.catch(() => {});
    return run;
  }
  return { read, update };
}

const historyStore = createStore(HISTORY_FILE);
const presetsStore = createStore(PRESETS_FILE);

// Copie un fichier produit par ComfyUI dans output/ du projet et renvoie son URL locale.
async function saveOutput(req, res) {
  try {
    const { filename, subfolder = '', type = 'output' } = JSON.parse(await readBody(req));
    if (!filename) return sendJson(res, 400, { error: 'filename manquant' });
    const query = new URLSearchParams({ filename, subfolder, type });
    const upstream = await fetch(`${COMFY_URL.origin}/view?${query}`);
    if (!upstream.ok) {
      return sendJson(res, 502, { error: `ComfyUI /view a répondu ${upstream.status}` });
    }
    const name = `${timestamp()}_${path.basename(filename)}`;
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(OUTPUT_DIR, name), Buffer.from(await upstream.arrayBuffer()));
    sendJson(res, 200, { filename: name, url: OUTPUT_PREFIX + encodeURIComponent(name) });
  } catch (err) {
    sendJson(res, 500, { error: `Enregistrement impossible : ${err.message}` });
  }
}

// Reçoit un fichier audio brut (en-tête x-filename) et l'enregistre dans output/.
async function uploadOutput(req, res) {
  try {
    const original = path.basename(decodeURIComponent(req.headers['x-filename'] || ''));
    if (!AUDIO_EXTS.includes(path.extname(original).toLowerCase())) {
      return sendJson(res, 400, { error: `Format non supporté (${AUDIO_EXTS.join(', ')})` });
    }
    const data = await readBuffer(req, MAX_OUTPUT_BYTES);
    if (!data.length) return sendJson(res, 400, { error: 'Fichier vide' });
    const name = `${timestamp()}_${original}`;
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(OUTPUT_DIR, name), data);
    sendJson(res, 200, { filename: name, url: OUTPUT_PREFIX + encodeURIComponent(name) });
  } catch (err) {
    sendJson(res, 400, { error: `Enregistrement impossible : ${err.message}` });
  }
}

// ---------- Import YouTube (yt-dlp) ----------
// Télécharge la piste audio telle quelle (m4a de préférence) : pas besoin de ffmpeg.

// Un terminal ouvert avant l'installation garde l'ancien PATH : on cherche aussi dans le dossier de winget.
function findYtDlp() {
  if (process.env.YTDLP || process.platform !== 'win32' || !process.env.LOCALAPPDATA) return YTDLP;
  const packages = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  try {
    const dir = fs.readdirSync(packages).find((d) => d.startsWith('yt-dlp.yt-dlp_'));
    const exe = dir && path.join(packages, dir, 'yt-dlp.exe');
    if (exe && fs.existsSync(exe)) return exe;
  } catch {}
  return YTDLP;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(findYtDlp(), args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), YOUTUBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new Error('yt-dlp introuvable : installez-le (winget install yt-dlp) puis redémarrez le serveur')
        : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const lines = stderr.trim().split(/\r?\n/);
      const line = lines.reverse().find((l) => l.includes('ERROR')) || lines[0];
      reject(new Error(line || (code === null ? 'délai dépassé' : `yt-dlp a échoué (code ${code})`)));
    });
  });
}

async function importYoutube(req, res) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'musiquegenerator-yt-'));
  try {
    const { url } = JSON.parse(await readBody(req));
    let parsed;
    try {
      parsed = new URL(String(url).trim());
    } catch {
      return sendJson(res, 400, { error: 'Lien invalide' });
    }
    if (!/^https?:$/.test(parsed.protocol) || !YOUTUBE_HOSTS.includes(parsed.hostname)) {
      return sendJson(res, 400, { error: 'Seuls les liens YouTube sont acceptés' });
    }
    const out = await runYtDlp([
      '--no-playlist', '--no-progress', '--restrict-filenames',
      '-f', 'bestaudio[ext=m4a]/bestaudio',
      '--match-filter', `duration <= ${YOUTUBE_MAX_SECONDS}`,
      '--max-filesize', '100M',
      '-o', path.join(dir, '%(title).80B.%(ext)s'),
      '--print', 'after_move:filepath',
      '--', parsed.href,
    ]);
    const file = out.trim().split(/\r?\n/).pop();
    if (!file) {
      return sendJson(res, 400, { error: `Vidéo ignorée : plus de ${YOUTUBE_MAX_SECONDS / 60} minutes (ou durée inconnue)` });
    }
    const name = path.basename(file);
    if (!AUDIO_EXTS.includes(path.extname(name).toLowerCase())) {
      return sendJson(res, 400, { error: `Format audio non supporté : ${path.extname(name)}` });
    }
    const data = await fs.promises.readFile(path.join(dir, name));
    res.writeHead(200, {
      'content-type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'x-filename': encodeURIComponent(name),
    });
    res.end(data);
  } catch (err) {
    sendJson(res, 502, { error: `Import YouTube impossible : ${err.message}` });
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- Presets personnels (data/presets.json) ----------
// Entrée : { id, name, params, createdAt }.

async function routePresets(req, res) {
  const id = decodeURIComponent(req.url.split('?')[0].split('/')[3] || ''); // /api/presets/<id>
  try {
    if (!id && req.method === 'GET') return sendJson(res, 200, await presetsStore.read());
    if (!id && req.method === 'POST') {
      const { name, params } = JSON.parse(await readBody(req));
      if (!String(name || '').trim() || !params) return sendJson(res, 400, { error: 'Nom ou réglages manquants' });
      const preset = { id: crypto.randomUUID().slice(0, 8), name: String(name).trim(), params, createdAt: new Date().toISOString() };
      await presetsStore.update((list) => [...list, preset]);
      return sendJson(res, 200, preset);
    }
    if (id && req.method === 'DELETE') {
      await presetsStore.update((list) => list.filter((p) => p.id !== id));
      return sendJson(res, 200, { ok: true });
    }
    sendJson(res, 404, { error: 'Route inconnue' });
  } catch (err) {
    sendJson(res, 400, { error: `Presets : ${err.message}` });
  }
}

// ---------- Bibliothèque de voix (voices/ + voices/voices.json) ----------

async function readVoices() {
  try {
    return JSON.parse(await fs.promises.readFile(VOICES_INDEX, 'utf8'));
  } catch {
    return [];
  }
}

async function writeVoices(voices) {
  await fs.promises.mkdir(VOICES_DIR, { recursive: true });
  await fs.promises.writeFile(VOICES_INDEX, JSON.stringify(voices, null, 2));
}

function voiceView(v) {
  return { ...v, url: VOICES_PREFIX + encodeURIComponent(v.filename) };
}

async function listVoices(req, res) {
  sendJson(res, 200, (await readVoices()).map(voiceView));
}

// Corps brut = fichier audio ; nom de la voix et du fichier dans les en-têtes (encodés URI).
async function addVoice(req, res) {
  try {
    const name = decodeURIComponent(req.headers['x-voice-name'] || '').trim();
    const original = path.basename(decodeURIComponent(req.headers['x-filename'] || ''));
    const ext = path.extname(original).toLowerCase();
    if (!name) return sendJson(res, 400, { error: 'Nom de voix manquant' });
    if (!AUDIO_EXTS.includes(ext)) {
      return sendJson(res, 400, { error: `Format non supporté (${AUDIO_EXTS.join(', ')})` });
    }
    const data = await readBuffer(req, MAX_VOICE_BYTES);
    if (!data.length) return sendJson(res, 400, { error: 'Fichier vide' });
    const id = crypto.randomUUID().slice(0, 8);
    const voice = { id, name, filename: `voice_${id}${ext}`, original, createdAt: new Date().toISOString() };
    await fs.promises.mkdir(VOICES_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(VOICES_DIR, voice.filename), data);
    await writeVoices([...(await readVoices()), voice]);
    sendJson(res, 200, voiceView(voice));
  } catch (err) {
    sendJson(res, 400, { error: `Ajout impossible : ${err.message}` });
  }
}

async function deleteVoice(req, res, id) {
  const voices = await readVoices();
  const voice = voices.find((v) => v.id === id);
  if (!voice) return sendJson(res, 404, { error: 'Voix introuvable' });
  await fs.promises.rm(path.join(VOICES_DIR, voice.filename), { force: true });
  await writeVoices(voices.filter((v) => v.id !== id));
  sendJson(res, 200, { ok: true });
}

// Copie l'extrait dans ComfyUI/input/musiquegenerator/ et renvoie le nom à donner à LoadAudio.
async function pushVoice(req, res, id) {
  try {
    const voice = (await readVoices()).find((v) => v.id === id);
    if (!voice) return sendJson(res, 404, { error: 'Voix introuvable' });
    const data = await fs.promises.readFile(path.join(VOICES_DIR, voice.filename));
    const form = new FormData();
    form.append('image', new Blob([data]), voice.filename);
    form.append('type', 'input');
    form.append('subfolder', COMFY_SUBFOLDER);
    form.append('overwrite', 'true');
    const upstream = await fetch(`${COMFY_URL.origin}/upload/image`, { method: 'POST', body: form });
    if (!upstream.ok) {
      return sendJson(res, 502, { error: `ComfyUI /upload/image a répondu ${upstream.status}` });
    }
    const up = await upstream.json();
    sendJson(res, 200, { audio: up.subfolder ? `${up.subfolder}/${up.name}` : up.name });
  } catch (err) {
    sendJson(res, 502, { error: `Envoi de la voix à ComfyUI impossible : ${err.message}` });
  }
}

function routeVoices(req, res) {
  const [, , , id, action] = req.url.split('?')[0].split('/'); // /api/voices/<id>/<action>
  if (!id && req.method === 'GET') return listVoices(req, res);
  if (!id && req.method === 'POST') return addVoice(req, res);
  if (id && !action && req.method === 'DELETE') return deleteVoice(req, res, id);
  if (id && action === 'push' && req.method === 'POST') return pushVoice(req, res, id);
  sendJson(res, 404, { error: 'Route inconnue' });
}

// ---------- Historique (output/history.json) ----------
// Entrée : { id, createdAt, kind: 'generation' | 'separation' | 'revoice' | 'edit', params, seconds, files: [{ kind, filename }] }.

function fileView(f) {
  return { ...f, url: OUTPUT_PREFIX + encodeURIComponent(f.filename) };
}

// Historique + anciens MP3 de output/ qui n'y figurent pas (générés avant l'historique).
async function listHistory(req, res) {
  const history = await historyStore.read();
  const known = new Set(history.flatMap((e) => e.files.map((f) => f.filename)));
  let names = [];
  try {
    names = await fs.promises.readdir(OUTPUT_DIR);
  } catch {}
  const orphans = await Promise.all(names
    .filter((n) => AUDIO_EXTS.includes(path.extname(n).toLowerCase()) && !known.has(n))
    .map(async (n) => ({
      id: `file:${n}`,
      createdAt: (await fs.promises.stat(path.join(OUTPUT_DIR, n))).mtime.toISOString(),
      kind: 'generation',
      params: null,
      files: [{ kind: 'mix', filename: n }],
    })));
  const entries = [...history, ...orphans]
    .map((e) => ({ ...e, files: e.files.map(fileView) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  sendJson(res, 200, entries);
}

async function addHistory(req, res) {
  try {
    const { kind = 'generation', params = null, seconds = null, files } = JSON.parse(await readBody(req));
    if (!Array.isArray(files) || !files.length) return sendJson(res, 400, { error: 'files manquant' });
    const entry = {
      id: crypto.randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      kind,
      params,
      seconds,
      files: files.map((f) => ({ kind: String(f.kind), filename: path.basename(String(f.filename)) })),
    };
    await historyStore.update((h) => [...h, entry]);
    sendJson(res, 200, { ...entry, files: entry.files.map(fileView) });
  } catch (err) {
    sendJson(res, 400, { error: `Historique : ${err.message}` });
  }
}

// Supprime l'entrée et ses fichiers.
async function deleteHistory(req, res, id) {
  let files;
  if (id.startsWith('file:')) {
    files = [{ filename: path.basename(id.slice(5)) }];
  } else {
    files = (await historyStore.read()).find((e) => e.id === id)?.files;
    if (!files) return sendJson(res, 404, { error: 'Entrée introuvable' });
    await historyStore.update((h) => h.filter((e) => e.id !== id));
  }
  await Promise.all(files.map((f) => fs.promises.rm(path.join(OUTPUT_DIR, path.basename(f.filename)), { force: true })));
  sendJson(res, 200, { ok: true });
}

function routeHistory(req, res) {
  const id = decodeURIComponent(req.url.split('?')[0].split('/')[3] || ''); // /api/history/<id>
  if (!id && req.method === 'GET') return listHistory(req, res);
  if (!id && req.method === 'POST') return addHistory(req, res);
  if (id && req.method === 'DELETE') return deleteHistory(req, res, id);
  sendJson(res, 404, { error: 'Route inconnue' });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const prefix = [OUTPUT_PREFIX, VOICES_PREFIX].find((p) => urlPath.startsWith(p));
  const root = prefix === OUTPUT_PREFIX ? OUTPUT_DIR : prefix === VOICES_PREFIX ? VOICES_DIR : PUBLIC_DIR;
  const relative = prefix ? urlPath.slice(prefix.length) : urlPath === '/' ? 'index.html' : urlPath;
  const file = path.normalize(path.join(root, relative));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === PREFIX || req.url.startsWith(PREFIX + '/')) {
    proxyHttp(req, res);
  } else if (req.method === 'POST' && req.url === '/api/save') {
    saveOutput(req, res);
  } else if (req.method === 'POST' && req.url === '/api/output') {
    uploadOutput(req, res);
  } else if (req.method === 'POST' && req.url === '/api/youtube') {
    importYoutube(req, res);
  } else if (req.url === '/api/presets' || req.url.startsWith('/api/presets/')) {
    routePresets(req, res);
  } else if (req.url === '/api/history' || req.url.startsWith('/api/history/')) {
    routeHistory(req, res);
  } else if (req.url === '/api/voices' || req.url.startsWith('/api/voices/')) {
    routeVoices(req, res);
  } else {
    serveStatic(req, res);
  }
});

// Proxy WebSocket : on relaie la requête d'upgrade brute puis on branche les deux sockets.
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith(PREFIX + '/')) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(Number(COMFY_URL.port) || 80, COMFY_URL.hostname, () => {
    const lines = [`${req.method} ${comfyPath(req.url)} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const lower = name.toLowerCase();
      if (lower === 'origin') continue;
      lines.push(`${name}: ${lower === 'host' ? COMFY_URL.host : req.rawHeaders[i + 1]}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(PORT, () => {
  console.log(`MusiqueGenerator : http://localhost:${PORT}`);
  console.log(`Proxy ComfyUI     : ${COMFY_URL.origin}`);
});
