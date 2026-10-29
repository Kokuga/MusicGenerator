import { buildWorkflow, CHECKPOINT, DEFAULTS, NODE_LABELS, REQUIRED_VOICE_NODES, SAVE_NODE_ID } from './workflow.js';
import { PRESETS } from './presets.js';

const API = '/comfy';
const ENCODER_NODE = 'TextEncodeAceStepAudio1.5';
const POLL_MS = 1500;
const COMFY_SUBFOLDER = 'musiquegenerator';
const MAX_DURATION = 600;

const FALLBACK_KEYS = ['C major', 'D major', 'E major', 'F major', 'G major', 'A major', 'B major',
  'C minor', 'D minor', 'E minor', 'F minor', 'G minor', 'A minor', 'B minor'];
const FALLBACK_LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh'];

const $ = (id) => document.getElementById(id);
const clientId = crypto.randomUUID();
let currentPromptId = null;
let ws = null;
let voices = [];
let voiceNodesReady = false;
let coverUpload = null; // { file, audio } : évite de renvoyer le même morceau à chaque génération

// ---------- Utilitaires ----------

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = `status status--${kind}`;
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function setProgress(label, ratio) {
  $('progress').hidden = false;
  $('progressLabel').textContent = label;
  $('progressFill').style.width = `${Math.round((ratio ?? 0) * 100)}%`;
}

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
    await checkVoiceNodes();
    setStatus('ComfyUI connecté · modèle prêt', 'ok');
    return true;
  } catch (err) {
    setStatus('ComfyUI injoignable', 'err');
    showError(`Impossible de joindre ComfyUI. Vérifiez qu'il est lancé (par défaut sur http://127.0.0.1:8188).\n${err.message}`);
    return false;
  }
}

// ComfyUI renvoie {} pour un nœud inconnu.
async function checkVoiceNodes() {
  const infos = await Promise.all(REQUIRED_VOICE_NODES.map((n) => api(`/object_info/${n}`).catch(() => ({}))));
  voiceNodesReady = infos.every((info, i) => info?.[REQUIRED_VOICE_NODES[i]]);
  $('voiceMissing').hidden = voiceNodesReady;
  $('voice').disabled = !voiceNodesReady;
  if (!voiceNodesReady) $('voice').value = '';
  updateVoiceUi();
}

// ---------- Voix ----------

async function loadVoices(selected = $('voice').value) {
  const res = await fetch('/api/voices');
  voices = res.ok ? await res.json() : [];
  $('voice').replaceChildren(
    new Option("Voix d'origine (ACE-Step)", ''),
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

async function addVoice() {
  const name = $('newVoiceName').value.trim();
  const file = $('newVoiceFile').files[0];
  if (!name || !file) {
    showError('Donnez un nom et choisissez un extrait audio pour la voix.');
    return;
  }
  showError('');
  $('addVoice').disabled = true;
  try {
    const res = await fetch('/api/voices', {
      method: 'POST',
      headers: { 'x-voice-name': encodeURIComponent(name), 'x-filename': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    $('newVoiceName').value = '';
    $('newVoiceFile').value = '';
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
  const res = await fetch(`/api/voices/${voice.id}`, { method: 'DELETE' });
  if (!res.ok) showError((await res.json()).error);
  await loadVoices('');
}

function initVoices() {
  $('voice').addEventListener('change', updateVoiceUi);
  $('addVoice').addEventListener('click', addVoice);
  $('deleteVoice').addEventListener('click', deleteVoice);
  loadVoices().catch((err) => showError(`Voix : ${err.message}`));
}

// Copie la voix dans ComfyUI/input et renvoie le nom attendu par LoadAudio.
async function pushVoice(id) {
  const res = await fetch(`/api/voices/${id}/push`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.audio;
}

// ---------- Reprise ----------

function syncCoverDuration() {
  const seconds = $('coverPreview').duration;
  if ($('cover_use_duration').checked && Number.isFinite(seconds)) {
    $('duration').value = Math.min(MAX_DURATION, Math.round(seconds));
  }
}

function initCover() {
  $('cover_enabled').addEventListener('change', () => {
    $('coverOptions').hidden = !$('cover_enabled').checked;
  });
  $('coverFile').addEventListener('change', () => {
    const file = $('coverFile').files[0];
    $('coverPreview').hidden = !file;
    if (file) $('coverPreview').src = URL.createObjectURL(file);
  });
  $('coverPreview').addEventListener('loadedmetadata', syncCoverDuration);
  $('cover_use_duration').addEventListener('change', syncCoverDuration);
  $('cover_fidelity').addEventListener('input', () => {
    $('coverFidelityValue').textContent = $('cover_fidelity').value;
  });
}

async function uploadCover(file) {
  if (coverUpload?.file === file) return coverUpload.audio;
  const form = new FormData();
  form.append('image', file, file.name);
  form.append('type', 'input');
  form.append('subfolder', COMFY_SUBFOLDER);
  form.append('overwrite', 'true');
  const up = await api('/upload/image', { method: 'POST', body: form });
  coverUpload = { file, audio: up.subfolder ? `${up.subfolder}/${up.name}` : up.name };
  return coverUpload.audio;
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
}

function readParams() {
  const params = {};
  for (const key of TEXT_FIELDS) params[key] = $(key).value;
  for (const key of NUMBER_FIELDS) params[key] = Number($(key).value);
  params.bpm = Math.round(params.bpm);
  params.seed = Math.max(0, Math.round(params.seed));
  params.steps = Math.round(params.steps);
  params.generate_audio_codes = $('generate_audio_codes').checked;
  if (!params.lyrics.trim()) params.lyrics = '[Instrumental]';
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
  return params;
}

// ---------- WebSocket (progression) ----------

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${API}/ws?clientId=${clientId}`);
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return; // aperçus binaires ignorés
    const { type, data } = JSON.parse(ev.data);
    if (!currentPromptId || data?.prompt_id !== currentPromptId) return;
    if (type === 'execution_start') setProgress('Démarrage…', 0);
    if (type === 'executing' && data.node) setProgress(NODE_LABELS[data.node] ?? `Nœud ${data.node}`, 0);
    if (type === 'progress') {
      const label = NODE_LABELS[data.node] ?? 'Calcul';
      setProgress(`${label} — ${data.value}/${data.max}`, data.value / data.max);
    }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 2000));
}

// ---------- Génération ----------

async function waitForResult(promptId) {
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
    if (entry.status?.completed || status === 'success') {
      const audio = entry.outputs?.[SAVE_NODE_ID]?.audio?.[0];
      if (!audio) throw new Error('Génération interrompue ou aucun fichier audio produit.');
      return audio;
    }
  }
}

async function saveToProject(audio) {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(audio),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function addResult(saved, params, seconds) {
  const url = saved.url;
  const li = document.createElement('li');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = params.tags.length > 90 ? `${params.tags.slice(0, 90)}…` : params.tags;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [
    `${params.duration} s`, `${params.bpm} BPM`, params.keyscale, params.language, `seed ${params.seed}`,
    params.voice && `voix : ${params.voice.name}`,
    params.cover && `reprise de ${params.cover.name}`,
    `généré en ${seconds} s`,
  ].filter(Boolean).join(' · ');
  const player = document.createElement('audio');
  player.controls = true;
  player.src = url;
  const link = document.createElement('a');
  link.href = url;
  link.download = saved.filename;
  link.textContent = `Télécharger output/${saved.filename}`;
  const reuse = document.createElement('button');
  reuse.type = 'button';
  reuse.className = 'secondary';
  reuse.textContent = 'Réutiliser ces réglages';
  reuse.style.marginLeft = '12px';
  reuse.addEventListener('click', () => {
    applyParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  li.append(title, meta, player, link, reuse);
  $('results').prepend(li);
  $('emptyResults').hidden = true;
}

async function generate(ev) {
  ev.preventDefault();
  showError('');
  const params = readParams();
  if ($('cover_enabled').checked && !params.cover) {
    showError("Choisissez le morceau à reprendre (ou décochez « Partir d'un morceau existant »).");
    return;
  }
  $('generate').disabled = true;
  $('interrupt').hidden = false;
  setProgress('Envoi à ComfyUI…', 0);
  const start = performance.now();
  try {
    const input = { ...params };
    if (params.voice) {
      setProgress("Envoi de l'extrait de voix à ComfyUI…", 0);
      input.voice = { ...params.voice, audio: await pushVoice(params.voice.id) };
    }
    if (params.cover) {
      setProgress('Envoi du morceau à ComfyUI…', 0);
      input.cover = { ...params.cover, audio: await uploadCover($('coverFile').files[0]) };
    }
    const { prompt_id } = await api('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: buildWorkflow(input), client_id: clientId }),
    });
    currentPromptId = prompt_id;
    setProgress("En file d'attente…", 0);
    const audio = await waitForResult(prompt_id);
    setProgress('Copie dans le dossier output du projet…', 1);
    const saved = await saveToProject(audio);
    addResult(saved, params, Math.round((performance.now() - start) / 1000));
    $('progress').hidden = true;
  } catch (err) {
    $('progress').hidden = true;
    showError(err.message);
  } finally {
    currentPromptId = null;
    $('generate').disabled = false;
    $('interrupt').hidden = true;
  }
}

// ---------- Démarrage ----------

fillSelect($('keyscale'), FALLBACK_KEYS, 'C major');
fillSelect($('language'), FALLBACK_LANGUAGES, 'en');
initPresets();
initVoices();
initCover();
applyParams({ ...DEFAULTS, ...PRESETS[0].params });

$('form').addEventListener('submit', generate);
$('randomSeed').addEventListener('click', () => {
  $('seed').value = Math.floor(Math.random() * 2 ** 32);
});
$('interrupt').addEventListener('click', () => {
  api('/interrupt', { method: 'POST' }).catch((err) => showError(err.message));
});

connectWs();
checkComfy();
