// Outils audio exécutés dans le navigateur (Web Audio) : forme d'onde, retouches, export WAV, son de fin.

let ctx = null;
function audioContext() {
  ctx ??= new AudioContext();
  return ctx;
}

export async function decodeAudio(url) {
  const data = await (await fetch(url)).arrayBuffer();
  return audioContext().decodeAudioData(data);
}

// ---------- Forme d'onde ----------

const PEAK_COUNT = 400;
const peaksCache = new Map(); // url → Promise<Float32Array>
let decodeQueue = Promise.resolve(); // un décodage à la fois pour ne pas figer la page

// Amplitude max (0..1) de chaque tranche, canaux mélangés.
function computePeaks(buffer, count = PEAK_COUNT) {
  const peaks = new Float32Array(count);
  const size = Math.max(1, Math.floor(buffer.length / count));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < count; i++) {
      let max = peaks[i];
      const end = Math.min(data.length, (i + 1) * size);
      for (let j = i * size; j < end; j++) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
  }
  return peaks;
}

export function peaksFor(url) {
  if (!peaksCache.has(url)) {
    const job = decodeQueue.then(async () => computePeaks(await decodeAudio(url)));
    decodeQueue = job.catch(() => {});
    peaksCache.set(url, job);
    job.catch(() => peaksCache.delete(url));
  }
  return peaksCache.get(url);
}

// Dessine les pics ; la partie déjà jouée (progress 0..1) prend la couleur d'accent.
export function drawWaveform(canvas, peaks, progress = 0) {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const styles = getComputedStyle(canvas);
  const played = styles.getPropertyValue('--accent').trim() || '#6d4aff';
  const rest = styles.getPropertyValue('--muted').trim() || '#888';
  const bar = width / peaks.length;
  const max = Math.max(...peaks, 0.01);
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, (peaks[i] / max) * (height - 2));
    g.fillStyle = i / peaks.length < progress ? played : rest;
    g.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 1), h);
  }
}

// ---------- Retouches ----------

// edits : { start, end (s), fadeIn, fadeOut (s), normalize (bool) } → nouvel AudioBuffer.
export function renderEdit(buffer, { start = 0, end = buffer.duration, fadeIn = 0, fadeOut = 0, normalize = false }) {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(buffer.length, Math.floor(end * rate));
  if (to - from < rate * 0.1) throw new Error('Extrait trop court (début / fin à vérifier).');
  const length = to - from;
  const out = audioContext().createBuffer(buffer.numberOfChannels, length, rate);
  const fadeInLen = Math.min(length, Math.floor(fadeIn * rate));
  const fadeOutLen = Math.min(length, Math.floor(fadeOut * rate));
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(from, to);
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      let gain = 1;
      if (i < fadeInLen) gain *= i / fadeInLen;
      if (i >= length - fadeOutLen) gain *= (length - 1 - i) / fadeOutLen;
      dst[i] = src[i] * gain;
      const v = Math.abs(dst[i]);
      if (v > peak) peak = v;
    }
  }
  // Normalisation du pic à -1 dBFS.
  if (normalize && peak > 0) {
    const gain = 10 ** (-1 / 20) / peak;
    for (let c = 0; c < out.numberOfChannels; c++) {
      const dst = out.getChannelData(c);
      for (let i = 0; i < length; i++) dst[i] *= gain;
    }
  }
  return out;
}

// WAV PCM 16 bits.
export function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  const data = [...Array(channels)].map((_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// ---------- Son de fin ----------

export function chime() {
  try {
    const ac = audioContext();
    ac.resume();
    const now = ac.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.4);
    });
  } catch {
    // Pas de son si le navigateur bloque l'audio : la notification suffit.
  }
}
