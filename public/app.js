import {
  buildSeparationWorkflow, buildTempoWorkflow, buildWorkflow, CHECKPOINT, DEFAULTS, NODE_LABELS,
  REQUIRED_VOICE_NODES, SAVE_NODES, SEPARATION_NODE, TEMPO_NODE, TEMPO_RESULT_NODE, VOICE_QUALITY_TAGS,
} from './workflow.js';
import { BASIC_VOICES, PRESETS } from './presets.js';

const API = '/comfy';
const ENCODER_NODE = 'TextEncodeAceStepAudio1.5';
const POLL_MS = 1500;
const COMFY_SUBFOLDER = 'musiquegenerator';
const MAX_DURATION = 600;
const MAX_RECORD_SECONDS = 25;
const MAX_SEED = 2 ** 32;

const FALLBACK_KEYS = ['C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'B major',
  'C minor', 'D minor', 'E minor', 'F minor', 'G minor', 'A minor', 'B minor'];
const FALLBACK_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh'];
const FILE_LABELS = { mix: 'Morceau', voix: 'Voix seule', instrumental: 'Instrumental' };

const $ = (id) => document.getElementById(id);
const clientId = crypto.randomUUID();
let ws = null;
let voices = [];
let voiceNodesReady = false;
let separationReady = false;
let tempoReady = false;
let recordedVoice = null; // File issu du micro, prioritaire sur le fichier importé
let recording = null; // { recorder, stream, timer }
const uploads = new WeakMap(); // File → nom dans ComfyUI/input (évite les envois répétés)
const activePrompts = new Map(); // prompt_id → (label, ratio) => void
const pendingPrompts = new Set(); // prompts de la génération en cours, pour « Arrêter »

// ---------- Utilitaires ----------

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = `status status--${kind}`;
}

function showError(message, id = 'error') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

// Barre de progression identifiée par son préfixe d'id (« progress », « separateProgress »).
function progressBar(prefix) {
  return {
    set(label, ratio) {
      $(prefix).hidden = false;
      $(`${prefix}Label`).textContent = label;
      $(`${prefix}Fill`).style.width = `${Math.round((ratio ?? 0) * 100)}%`;
    },
    hide() {
      $(prefix).hidden = true;
    },
  };
}
const mainProgress = progressBar('progress');
const separateProgress = progressBar('separateProgress');

function fillSelect(select, values, selected) {
  select.replaceChildren(...values.map((v) => new Option(v, v, false, v === selected)));
}

async function api(path, options) {
  const res = await fetch(API + path, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(formatComfyError(data) || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Réponse non JSON : typiquement un serveur lancé avant une mise à jour (route inconnue).
    throw new Error(res.ok ? `Réponse invalide de ${url}` :
      `${url} : HTTP ${res.status} ${text.slice(0, 80)} — redémarrez le serveur (npm start) s'il date d'avant une mise à jour.`);
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function formatComfyError(data) {
  if (!data || typeof data !== 'object') return data || '';
  const lines = [];
  if (data.error) {
    lines.push(typeof data.error === 'string' ? data.error : data.error.message);
    if (data.error.details) lines.push(data.error.details);
  }
  for (const [nodeId, info] of Object.entries(data.node_errors || {})) {
    for (const e of info.errors || []) {
      lines.push(`• ${info.class_type} (#${nodeId}) : ${e.message}${e.details ? ` — ${e.details}` : ''}`);
    }
  }
  return lines.join('\n');
}

// ---------- Initialisation ----------

async function checkComfy() {
  try {
    const [ckpt, encoder] = await Promise.all([
      api('/object_info/CheckpointLoaderSimple'),
      api(`/object_info/${encodeURIComponent(ENCODER_NODE)}`),
    ]);
    const ckptNames = ckpt.CheckpointLoaderSimple.input.required.ckpt_name[0];
    const enc = encoder[ENCODER_NODE];
    if (!enc) {
      setStatus('Nœud ACE-Step 1.5 absent : mettez ComfyUI à jour', 'err');
      return false;
    }
    const req = enc.input.required;
    fillSelect($('keyscale'), req.keyscale[1].options, $('keyscale').value || 'C major');
    fillSelect($('language'), req.language[1].options, $('language').value || 'en');

    if (!ckptNames.includes(CHECKPOINT)) {
      setStatus(`Modèle introuvable : ${CHECKPOINT}`, 'err');
      showError(`Placez ${CHECKPOINT} dans ComfyUI/models/checkpoints/ puis rechargez la page.\n` +
        'Téléchargement : https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files');
      return false;
    }
    await checkOptionalNodes();
    setStatus('ComfyUI connecté · modèle prêt', 'ok');
    return true;
  } catch (err) {
    setStatus('ComfyUI injoignable', 'err');
    showError(`Impossible de joindre ComfyUI. Vérifiez qu'il est lancé (par défaut sur http://127.0.0.1:8188).\n${err.message}`);
    return false;
  }
}

// ComfyUI renvoie {} pour un nœud inconnu.
async function hasNode(name) {
  const info = await api(`/object_info/${name}`).catch(() => ({}));
  return Boolean(info?.[name]);
}

async function checkOptionalNodes() {
  const names = [...new Set([...REQUIRED_VOICE_NODES, SEPARATION_NODE, TEMPO_NODE, 'PreviewAny'])];
  const present = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await hasNode(n)])));
  voiceNodesReady = REQUIRED_VOICE_NODES.every((n) => present[n]);
  separationReady = present[SEPARATION_NODE];
  tempoReady = present[TEMPO_NODE] && present.PreviewAny;

  $('voiceMissing').hidden = voiceNodesReady;
  $('voice').disabled = !voiceNodesReady;
  if (!voiceNodesReady) $('voice').value = '';
  updateVoiceUi();

  $('separationMissing').hidden = separationReady;
  for (const el of document.querySelectorAll('.needs-separation')) {
    for (const input of el.matches('button') ? [el] : el.querySelectorAll('input')) input.disabled = !separationReady;
  }
  for (const el of document.querySelectorAll('.needs-separation-msg')) el.hidden = separationReady;
}

// Envoie un fichier dans ComfyUI/input/musiquegenerator et renvoie le nom attendu par LoadAudio.
async function uploadToComfy(file) {
  if (uploads.has(file)) return uploads.get(file);
  const form = new FormData();
  form.append('image', file, file.name);
  form.append('type', 'input');
  form.append('subfolder', COMFY_SUBFOLDER);
  form.append('overwrite', 'true');
  const up = await api('/upload/image', { method: 'POST', body: form });
  const name = up.subfolder ? `${up.subfolder}/${up.name}` : up.name;
  uploads.set(file, name);
  return name;
}

// ---------- Exécution des prompts ----------

async function queuePrompt(workflow, onProgress) {
  const { prompt_id } = await api('/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (onProgress) activePrompts.set(prompt_id, onProgress);
  return prompt_id;
}

async function waitForPrompt(promptId) {
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const history = await api(`/history/${promptId}`);
      const entry = history?.[promptId];
      if (!entry) continue;
      const status = entry.status?.status_str;
      if (status === 'error') {
        if (entry.status.messages?.some(([t]) => t === 'execution_interrupted')) {
          throw new Error('Génération arrêtée.');
        }
        const errMsg = entry.status.messages?.find(([t]) => t === 'execution_error')?.[1];
        throw new Error(errMsg ? `${errMsg.node_type} : ${errMsg.exception_message}` : 'Erreur pendant la génération.');
      }
      if (entry.status?.completed || status === 'success') return entry.outputs ?? {};
    }
  } finally {
    activePrompts.delete(promptId);
  }
}

// Copie dans output/ chaque piste produite par les nœuds d'enregistrement.
async function saveOutputs(outputs) {
  const files = [];
  for (const [nodeId, kind] of Object.entries(SAVE_NODES)) {
    const audio = outputs[nodeId]?.audio?.[0];
    if (!audio) continue;
    const saved = await jsonFetch('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(audio),
    });
    files.push({ kind, filename: saved.filename });
  }
  if (!files.length) throw new Error('Génération interrompue ou aucun fichier audio produit.');
  return files;
}

// ---------- WebSocket (progression) ----------

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${API}/ws?clientId=${clientId}`);
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return; // aperçus binaires ignorés
    const { type, data } = JSON.parse(ev.data);
    const onProgress = activePrompts.get(data?.prompt_id);
    if (!onProgress) return;
    if (type === 'execution_start') onProgress('Démarrage…', 0);
    if (type === 'executing' && data.node) onProgress(NODE_LABELS[data.node] ?? `Nœud ${data.node}`, 0);
    if (type === 'progress') {
      const label = NODE_LABELS[data.node] ?? 'Calcul';
      onProgress(`${label} — ${data.value}/${data.max}`, data.value / data.max);
    }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 2000));
}

// ---------- Voix ----------

function selectedBasicVoice() {
  return BASIC_VOICES.find((v) => v.id === $('basic_voice').value) ?? null;
}

function updateBasicVoiceHint() {
  const basic = selectedBasicVoice();
  $('basicVoiceHint').textContent = basic
    ? `Ajoute « ${basic.tags}, ${VOICE_QUALITY_TAGS} » au style (en remplaçant ses tags de voix).`
    : 'La voix suit les tags du style.';
}

function initBasicVoices() {
  $('basic_voice').replaceChildren(
    new Option('Selon le style (tags)', ''),
    ...BASIC_VOICES.map((v) => new Option(v.name, v.id)),
  );
  $('basic_voice').addEventListener('change', updateBasicVoiceHint);
  updateBasicVoiceHint();
}

async function loadVoices(selected = $('voice').value) {
  const res = await fetch('/api/voices');
  voices = res.ok ? await res.json() : [];
  $('voice').replaceChildren(
    new Option('Aucune', ''),
    ...voices.map((v) => new Option(v.name, v.id, false, v.id === selected)),
  );
  updateVoiceUi();
}

function selectedVoice() {
  return voices.find((v) => v.id === $('voice').value) ?? null;
}

function updateVoiceUi() {
  const voice = selectedVoice();
  $('deleteVoice').hidden = !voice;
  $('voiceOptions').hidden = !voice;
  $('voicePreview').hidden = !voice;
  if (voice && !$('voicePreview').src.endsWith(voice.url)) $('voicePreview').src = voice.url;
}

function showNewVoicePreview(file) {
  $('newVoicePreview').hidden = !file;
  if (file) $('newVoicePreview').src = URL.createObjectURL(file);
}

async function addVoice() {
  const name = $('newVoiceName').value.trim();
  const file = recordedVoice ?? $('newVoiceFile').files[0];
  if (!name || !file) {
    showError('Donnez un nom et enregistrez ou choisissez un extrait audio pour la voix.');
    return;
  }
  showError('');
  $('addVoice').disabled = true;
  try {
    const data = await jsonFetch('/api/voices', {
      method: 'POST',
      headers: { 'x-voice-name': encodeURIComponent(name), 'x-filename': encodeURIComponent(file.name) },
      body: file,
    });
    $('newVoiceName').value = '';
    $('newVoiceFile').value = '';
    recordedVoice = null;
    showNewVoicePreview(null);
    $('recordStatus').textContent = '';
    $('addVoiceBox').open = false;
    await loadVoices(voiceNodesReady ? data.id : '');
  } catch (err) {
    showError(err.message);
  } finally {
    $('addVoice').disabled = false;
  }
}

async function deleteVoice() {
  const voice = selectedVoice();
  if (!voice || !confirm(`Supprimer la voix « ${voice.name} » ?`)) return;
  try {
    await jsonFetch(`/api/voices/${voice.id}`, { method: 'DELETE' });
  } catch (err) {
    showError(err.message);
  }
  await loadVoices('');
}

// Copie la voix dans ComfyUI/input et renvoie le nom attendu par LoadAudio.
async function pushVoice(id) {
  return (await jsonFetch(`/api/voices/${id}/push`, { method: 'POST' })).audio;
}

// ---------- Enregistrement au micro ----------

const RECORD_TYPES = [['audio/webm;codecs=opus', 'webm'], ['audio/ogg;codecs=opus', 'ogg'], ['audio/mp4', 'm4a']];

function stopRecording() {
  if (recording?.recorder.state === 'recording') recording.recorder.stop();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError("L'enregistrement n'est pas pris en charge par ce navigateur : importez un fichier.");
    return;
  }
  let stream;
  try {
    // Aucun traitement du navigateur : la réduction de bruit rend la voix métallique et Seed-VC copie ce défaut.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch (err) {
    showError(`Micro inaccessible : ${err.message}`);
    return;
  }
  showError('');
  const [mimeType, ext] = RECORD_TYPES.find(([t]) => MediaRecorder.isTypeSupported(t)) ?? ['', 'webm'];
  const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 256000 });
  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => chunks.push(e.data));
  recorder.addEventListener('stop', () => {
    clearInterval(recording.timer);
    stream.getTracks().forEach((t) => t.stop());
    recording = null;
    $('recordVoice').textContent = '🎙️ Réenregistrer';
    const blob = new Blob(chunks, { type: recorder.mimeType });
    recordedVoice = new File([blob], `enregistrement.${ext}`, { type: recorder.mimeType });
    $('newVoiceFile').value = '';
    $('recordStatus').textContent = 'Enregistrement prêt : réécoutez-le puis « Enregistrer la voix ».';
    showNewVoicePreview(recordedVoice);
  });

  // Compte à rebours pour laisser le temps de se préparer.
  $('recordVoice').disabled = true;
  for (let n = 3; n > 0; n--) {
    $('recordStatus').textContent = `Début dans ${n}…`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  $('recordVoice').disabled = false;
  $('recordVoice').textContent = '⏹ Arrêter';
  recorder.start();
  const started = Date.now();
  recording = { recorder, stream, timer: null };
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('recordStatus').textContent = `● Enregistrement… ${s} s / ${MAX_RECORD_SECONDS} s`;
    if (s >= MAX_RECORD_SECONDS) stopRecording();
  };
  tick();
  recording.timer = setInterval(tick, 250);
}

function initVoices() {
  $('voice').addEventListener('change', updateVoiceUi);
  $('addVoice').addEventListener('click', addVoice);
  $('deleteVoice').addEventListener('click', deleteVoice);
  $('recordVoice').addEventListener('click', () => (recording ? stopRecording() : startRecording()));
  $('newVoiceFile').addEventListener('change', () => {
    recordedVoice = null;
    $('recordStatus').textContent = '';
    showNewVoicePreview($('newVoiceFile').files[0]);
  });
  loadVoices().catch((err) => showError(`Voix : ${err.message}`));
}

// ---------- Reprise ----------

function syncCoverDuration() {
  const seconds = $('coverPreview').duration;
  if ($('cover_use_duration').checked && Number.isFinite(seconds)) {
    $('duration').value = Math.min(MAX_DURATION, Math.round(seconds));
  }
}

// Détecte le BPM du morceau importé et le reporte dans le formulaire.
async function detectCoverBpm(file) {
  if (!tempoReady) return;
  const hint = $('coverBpm');
  hint.hidden = false;
  hint.textContent = 'Détection du BPM…';
  try {
    const id = await queuePrompt(buildTempoWorkflow(await uploadToComfy(file)));
    const text = (await waitForPrompt(id))[TEMPO_RESULT_NODE]?.text;
    const bpm = Math.round(Number([].concat(text ?? [])[0]));
    if ($('coverFile').files[0] !== file) return; // un autre fichier a été choisi entre-temps
    if (!(bpm >= 10 && bpm <= 300)) throw new Error('tempo non reconnu');
    $('bpm').value = bpm;
    hint.textContent = `BPM détecté : ${bpm} (reporté dans le champ BPM).`;
  } catch (err) {
    hint.textContent = `BPM non détecté (${err.message}) : réglez-le à la main.`;
  }
}

function initCover() {
  $('cover_enabled').addEventListener('change', () => {
    $('coverOptions').hidden = !$('cover_enabled').checked;
  });
  $('coverFile').addEventListener('change', () => {
    const file = $('coverFile').files[0];
    $('coverPreview').hidden = !file;
    $('coverBpm').hidden = true;
    if (!file) return;
    $('coverPreview').src = URL.createObjectURL(file);
    detectCoverBpm(file);
  });
  $('coverPreview').addEventListener('loadedmetadata', syncCoverDuration);
  $('cover_use_duration').addEventListener('change', syncCoverDuration);
  $('cover_fidelity').addEventListener('input', () => {
    $('coverFidelityValue').textContent = $('cover_fidelity').value;
  });
}

function initPresets() {
  fillSelect($('preset'), [], null);
  for (const p of PRESETS) $('preset').add(new Option(p.name, p.id));
  const updateHint = () => {
    $('presetHint').textContent = PRESETS.find((p) => p.id === $('preset').value)?.hint ?? '';
  };
  $('preset').addEventListener('change', updateHint);
  $('loadPreset').addEventListener('click', () => {
    const preset = PRESETS.find((p) => p.id === $('preset').value);
    if (preset) applyParams({ ...DEFAULTS, ...preset.params });
  });
  updateHint();
}

// ---------- Formulaire ----------

const NUMBER_FIELDS = ['duration', 'bpm', 'seed', 'steps', 'shift', 'cfg_scale', 'temperature', 'top_p'];
const TEXT_FIELDS = ['tags', 'lyrics', 'timesignature', 'keyscale', 'language'];
const MIX_FIELDS = ['vocal_db', 'low_db', 'mid_db', 'high_db'];

function applyParams(params) {
  for (const key of [...NUMBER_FIELDS, ...TEXT_FIELDS]) {
    if (params[key] === undefined) continue;
    const el = $(key);
    if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(params[key]))) {
      el.add(new Option(params[key], params[key]));
    }
    el.value = params[key];
  }
  $('generate_audio_codes').checked = params.generate_audio_codes;
  if ('basic_voice' in params) {
    $('basic_voice').value = BASIC_VOICES.some((v) => v.id === params.basic_voice?.id) ? params.basic_voice.id : '';
    updateBasicVoiceHint();
  }
  if ('voice' in params) {
    const id = voiceNodesReady && voices.some((v) => v.id === params.voice?.id) ? params.voice.id : '';
    $('voice').value = id;
    if (id) {
      $('voice_pitch').value = params.voice.pitch_shift;
      $('voice_steps').value = params.voice.steps;
      $('voice_auto_f0').checked = params.voice.auto_f0_adjust;
    }
    updateVoiceUi();
  }
  if (params.cover) {
    $('cover_fidelity').value = params.cover.fidelity;
    $('coverFidelityValue').textContent = params.cover.fidelity;
  }
  const mix = { ...DEFAULTS.mix, ...params.mix };
  for (const key of MIX_FIELDS) $(`mix_${key}`).value = mix[key];
  $('stems').checked = Boolean(params.stems) && separationReady;
}

function readParams() {
  const params = {};
  for (const key of TEXT_FIELDS) params[key] = $(key).value;
  for (const key of NUMBER_FIELDS) params[key] = Number($(key).value);
  params.bpm = Math.round(params.bpm);
  params.seed = Math.max(0, Math.round(params.seed)) % MAX_SEED;
  params.steps = Math.round(params.steps);
  params.generate_audio_codes = $('generate_audio_codes').checked;
  if (!params.lyrics.trim()) params.lyrics = '[Instrumental]';
  params.basic_voice = selectedBasicVoice();
  const voice = selectedVoice();
  params.voice = voice ? {
    id: voice.id,
    name: voice.name,
    pitch_shift: Math.round(Number($('voice_pitch').value)),
    steps: Math.max(1, Math.round(Number($('voice_steps').value))),
    auto_f0_adjust: $('voice_auto_f0').checked,
  } : null;
  const coverFile = $('cover_enabled').checked ? $('coverFile').files[0] : null;
  params.cover = coverFile ? { name: coverFile.name, fidelity: Number($('cover_fidelity').value) } : null;
  params.mix = Object.fromEntries(MIX_FIELDS.map((key) => [key, Number($(`mix_${key}`).value) || 0]));
  params.mix.vocal_db = Math.round(params.mix.vocal_db);
  // Sans séparation, ni volume de voix ni pistes séparées.
  if (!separationReady) params.mix.vocal_db = 0;
  params.stems = separationReady && $('stems').checked;
  return params;
}

// ---------- Historique ----------

function describe(entry) {
  const p = entry.params;
  if (entry.kind === 'separation') {
    return { title: `Séparation de ${p?.name ?? 'un morceau'}`, meta: entry.seconds ? `traité en ${entry.seconds} s` : '' };
  }
  if (!p) return { title: entry.files[0].filename, meta: 'réglages non enregistrés (ancien morceau)' };
  const mix = { ...DEFAULTS.mix, ...p.mix };
  const eq = mix.low_db || mix.mid_db || mix.high_db;
  return {
    title: p.tags.length > 90 ? `${p.tags.slice(0, 90)}…` : p.tags,
    meta: [
      `${p.duration} s`, `${p.bpm} BPM`, p.keyscale, p.language, `seed ${p.seed}`,
      p.basic_voice && `type : ${p.basic_voice.name}`,
      p.voice && `voix : ${p.voice.name}`,
      p.cover && `reprise de ${p.cover.name}`,
      mix.vocal_db && `voix ${mix.vocal_db > 0 ? '+' : ''}${mix.vocal_db} dB`,
      eq && `EQ ${mix.low_db}/${mix.mid_db}/${mix.high_db} dB`,
      entry.seconds && `généré en ${entry.seconds} s`,
    ].filter(Boolean).join(' · '),
  };
}

function renderEntry(entry) {
  const li = document.createElement('li');
  const { title, meta } = describe(entry);
  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = title;
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = [new Date(entry.createdAt).toLocaleString('fr-FR'), meta].filter(Boolean).join(' · ');
  li.append(titleEl, metaEl);

  for (const file of entry.files) {
    const box = document.createElement('div');
    box.className = 'file';
    if (entry.files.length > 1) {
      const label = document.createElement('div');
      label.className = 'file__label';
      label.textContent = FILE_LABELS[file.kind] ?? file.kind;
      box.append(label);
    }
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'none';
    player.src = file.url;
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.filename;
    link.textContent = `Télécharger output/${file.filename}`;
    box.append(player, link);
    li.append(box);
  }

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  if (entry.kind === 'generation' && entry.params) {
    const reuse = document.createElement('button');
    reuse.type = 'button';
    reuse.className = 'secondary';
    reuse.textContent = 'Réutiliser ces réglages';
    reuse.addEventListener('click', () => {
      applyParams(entry.params);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    actions.append(reuse);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'secondary danger';
  del.textContent = 'Supprimer';
  del.addEventListener('click', async () => {
    if (!confirm(`Supprimer « ${title} » et ses fichiers ?`)) return;
    try {
      await jsonFetch(`/api/history/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      li.remove();
      $('emptyResults').hidden = $('results').children.length > 0;
    } catch (err) {
      alert(err.message);
    }
  });
  actions.append(del);
  li.append(actions);
  return li;
}

async function loadHistory() {
  try {
    const entries = await jsonFetch('/api/history');
    $('results').replaceChildren(...entries.map(renderEntry));
    $('emptyResults').hidden = entries.length > 0;
  } catch (err) {
    showError(`Historique : ${err.message}`);
  }
}

async function addToHistory(entry) {
  const saved = await jsonFetch('/api/history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  });
  $('results').prepend(renderEntry(saved));
  $('emptyResults').hidden = true;
}

// ---------- Génération ----------

async function generate(ev) {
  ev.preventDefault();
  showError('');
  const params = readParams();
  if ($('cover_enabled').checked && !params.cover) {
    showError("Choisissez le morceau à reprendre (ou décochez « Partir d'un morceau existant »).");
    return;
  }
  const variants = Number($('variants').value) || 1;
  $('generate').disabled = true;
  $('interrupt').hidden = false;
  mainProgress.set('Envoi à ComfyUI…', 0);
  const start = performance.now();
  try {
    const input = { ...params };
    if (params.voice) {
      mainProgress.set("Envoi de l'extrait de voix à ComfyUI…", 0);
      input.voice = { ...params.voice, audio: await pushVoice(params.voice.id) };
    }
    if (params.cover) {
      mainProgress.set('Envoi du morceau à ComfyUI…', 0);
      input.cover = { ...params.cover, audio: await uploadToComfy($('coverFile').files[0]) };
    }
    // Toutes les versions sont mises en file d'attente d'un coup, avec des seeds consécutives.
    const jobs = [];
    for (let i = 0; i < variants; i++) {
      const seed = (params.seed + i) % MAX_SEED;
      const prefix = variants > 1 ? `Version ${i + 1}/${variants} — ` : '';
      const id = await queuePrompt(buildWorkflow({ ...input, seed }), (label, ratio) => mainProgress.set(prefix + label, ratio));
      pendingPrompts.add(id);
      jobs.push({ id, seed, prefix });
    }
    mainProgress.set("En file d'attente…", 0);
    for (const job of jobs) {
      const outputs = await waitForPrompt(job.id);
      pendingPrompts.delete(job.id);
      mainProgress.set(`${job.prefix}Copie dans le dossier output du projet…`, 1);
      const files = await saveOutputs(outputs);
      await addToHistory({
        kind: 'generation',
        params: { ...params, seed: job.seed },
        seconds: Math.round((performance.now() - start) / 1000),
        files,
      });
    }
    mainProgress.hide();
  } catch (err) {
    mainProgress.hide();
    showError(err.message);
    cancelPending();
  } finally {
    pendingPrompts.clear();
    $('generate').disabled = false;
    $('interrupt').hidden = true;
  }
}

// Retire de la file d'attente les versions pas encore commencées.
function cancelPending() {
  if (!pendingPrompts.size) return Promise.resolve();
  return api('/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delete: [...pendingPrompts] }),
  }).catch(() => {});
}

async function interrupt() {
  await cancelPending();
  api('/interrupt', { method: 'POST' }).catch((err) => showError(err.message));
}

// ---------- Séparation d'un morceau importé ----------

async function separate() {
  const file = $('separateFile').files[0];
  showError('', 'separateError');
  if (!file) {
    showError('Choisissez le morceau à séparer.', 'separateError');
    return;
  }
  $('separate').disabled = true;
  separateProgress.set('Envoi du morceau à ComfyUI…', 0);
  const start = performance.now();
  try {
    const id = await queuePrompt(buildSeparationWorkflow(await uploadToComfy(file)), separateProgress.set);
    separateProgress.set("En file d'attente…", 0);
    const files = await saveOutputs(await waitForPrompt(id));
    await addToHistory({
      kind: 'separation',
      params: { name: file.name },
      seconds: Math.round((performance.now() - start) / 1000),
      files,
    });
    separateProgress.hide();
  } catch (err) {
    separateProgress.hide();
    showError(err.message, 'separateError');
  } finally {
    $('separate').disabled = !separationReady;
  }
}

// ---------- Démarrage ----------

fillSelect($('keyscale'), FALLBACK_KEYS, 'C major');
fillSelect($('language'), FALLBACK_LANGUAGES, 'en');
initPresets();
initBasicVoices();
initVoices();
initCover();
applyParams({ ...DEFAULTS, ...PRESETS[0].params });

$('form').addEventListener('submit', generate);
$('randomSeed').addEventListener('click', () => {
  $('seed').value = Math.floor(Math.random() * MAX_SEED);
});
$('interrupt').addEventListener('click', interrupt);
$('separate').addEventListener('click', separate);

connectWs();
checkComfy();
loadHistory();
