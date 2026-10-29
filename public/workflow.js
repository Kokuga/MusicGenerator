// Construit le prompt ComfyUI (format API) reproduisant le template officiel
// « audio_ace_step_1_5_checkpoint » pour ace_step_1.5_turbo_aio.safetensors,
// avec des extensions optionnelles :
//  - reprise (cover) : un morceau importé guide la structure via ReferenceTimbreAudio ;
//  - voix clonée : séparation voix / instrumental puis conversion Seed-VC et remixage ;
//  - mixage : volume de la voix, égaliseur 3 bandes, export des pistes séparées.

export const CHECKPOINT = 'ace_step_1.5_turbo_aio.safetensors';
export const SAVE_NODE_ID = '9';
// Custom nodes : audio-separation-nodes-comfyui (séparation, tempo) et ComfyUI_Seed-VC.
export const SEPARATION_NODE = 'AudioSeparation';
export const TEMPO_NODE = 'AudioGetTempo';
export const REQUIRED_VOICE_NODES = [SEPARATION_NODE, 'SeedVCRun'];

// Nœuds d'enregistrement → type de piste (même ids dans tous les workflows).
export const SAVE_NODES = {
  [SAVE_NODE_ID]: 'mix',
  '30': 'voix',
  '31': 'instrumental',
};

export const DEFAULTS = {
  tags: '',
  lyrics: '',
  duration: 120,
  bpm: 120,
  timesignature: '4',
  language: 'en',
  keyscale: 'C major',
  seed: 0,
  steps: 8,
  shift: 3,
  generate_audio_codes: true,
  cfg_scale: 2,
  temperature: 0.85,
  top_p: 0.9,
  top_k: 0,
  min_p: 0,
  // { audio: nom dans ComfyUI/input, fidelity: 0..0.9 }
  cover: null,
  // { audio: nom dans ComfyUI/input, pitch_shift, steps, auto_f0_adjust }
  voice: null,
  // Type de voix de base { id, name, tags } : ses tags remplacent ceux de voix du style.
  basic_voice: null,
  // Gains en dB ; vocal_db nécessite la séparation.
  mix: { vocal_db: 0, low_db: 0, mid_db: 0, high_db: 0 },
  // Enregistre aussi la voix et l'instrumental (nécessite la séparation).
  stems: false,
};

const VOCALS_OUTPUT = 3; // AudioSeparation : Bass, Drums, Other, Vocals

function saveMp3(audio, suffix = '') {
  return {
    class_type: 'SaveAudioMP3',
    inputs: { audio, filename_prefix: `audio/MusiqueGenerator${suffix}`, quality: 'V0' },
  };
}

const VOICE_TAG = /\b(vocals?|voices?|singers?|singing|rap|rapper|duet|a cappella)\b/i;

// Retire les tags de voix du style (séparés par des virgules) et ajoute ceux du type choisi.
export function applyVoiceTags(tags, voiceTags) {
  const kept = tags.split(',').map((t) => t.trim()).filter((t) => t && !VOICE_TAG.test(t));
  return [...kept, voiceTags].join(', ');
}

export function buildWorkflow(input) {
  const p = { ...DEFAULTS, ...input };
  const mixSettings = { ...DEFAULTS.mix, ...p.mix };
  if (p.basic_voice) p.tags = applyVoiceTags(p.tags, p.basic_voice.tags);
  const wf = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: CHECKPOINT },
    },
    '2': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['1', 0], shift: p.shift },
    },
    '3': {
      class_type: 'TextEncodeAceStepAudio1.5',
      inputs: {
        clip: ['1', 1],
        tags: p.tags,
        lyrics: p.lyrics,
        seed: p.seed,
        bpm: p.bpm,
        duration: p.duration,
        timesignature: p.timesignature,
        language: p.language,
        keyscale: p.keyscale,
        // Avec une référence audio, les codes LLM doivent être désactivés (cf. tooltip du nœud).
        generate_audio_codes: p.cover ? false : p.generate_audio_codes,
        cfg_scale: p.cfg_scale,
        temperature: p.temperature,
        top_p: p.top_p,
        top_k: p.top_k,
        min_p: p.min_p,
      },
    },
    '4': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['3', 0] },
    },
    '5': {
      class_type: 'EmptyAceStep1.5LatentAudio',
      inputs: { seconds: p.duration, batch_size: 1 },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed: p.seed,
        steps: p.steps,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '7': {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
  };

  if (p.cover) {
    wf['10'] = { class_type: 'LoadAudio', inputs: { audio: p.cover.audio } };
    wf['13'] = {
      class_type: 'TrimAudioDuration',
      inputs: { audio: ['10', 0], start_index: 0, duration: p.duration },
    };
    wf['11'] = { class_type: 'VAEEncodeAudio', inputs: { audio: ['13', 0], vae: ['1', 2] } };
    wf['12'] = {
      class_type: 'ReferenceTimbreAudio',
      inputs: { conditioning: ['3', 0], latent: ['11', 0] },
    };
    wf['6'].inputs.positive = ['12', 0];
    // Fidélité > 0 : on part du morceau bruité au lieu d'un latent vide (audio2audio).
    if (p.cover.fidelity > 0) {
      wf['6'].inputs.latent_image = ['11', 0];
      wf['6'].inputs.denoise = 1 - p.cover.fidelity;
      delete wf['5'];
    }
  }

  let mix = ['7', 0];
  const remixVocals = Boolean(p.voice) || mixSettings.vocal_db !== 0;
  if (remixVocals || p.stems) {
    wf['20'] = { class_type: SEPARATION_NODE, inputs: { audio: ['7', 0] } };
    // Instrumental = mix - voix.
    wf['23'] = {
      class_type: 'AudioMerge',
      inputs: { audio1: ['7', 0], audio2: ['20', VOCALS_OUTPUT], merge_method: 'subtract' },
    };
    let vocals = ['20', VOCALS_OUTPUT];
    if (p.voice) {
      wf['21'] = { class_type: 'LoadAudio', inputs: { audio: p.voice.audio } };
      wf['22'] = {
        class_type: 'SeedVCRun',
        inputs: {
          source_audio: vocals,
          ref_audio: ['21', 0],
          steps: p.voice.steps,
          speed: 1,
          inference_cfg_rate: 0.7,
          f0_condition: true, // obligatoire pour le chant
          auto_f0_adjust: p.voice.auto_f0_adjust,
          pitch_shift: p.voice.pitch_shift,
          unload_model: true,
        },
      };
      vocals = ['22', 0];
    }
    if (mixSettings.vocal_db !== 0) {
      wf['25'] = { class_type: 'AudioAdjustVolume', inputs: { audio: vocals, volume: mixSettings.vocal_db } };
      vocals = ['25', 0];
    }
    if (remixVocals) {
      wf['24'] = {
        class_type: 'AudioMerge',
        inputs: { audio1: ['23', 0], audio2: vocals, merge_method: 'add' },
      };
      mix = ['24', 0];
    }
    if (p.stems) {
      wf['30'] = saveMp3(vocals, '_voix');
      wf['31'] = saveMp3(['23', 0], '_instrumental');
    }
  }

  if (mixSettings.low_db || mixSettings.mid_db || mixSettings.high_db) {
    wf['26'] = {
      class_type: 'AudioEqualizer3Band',
      inputs: {
        audio: mix,
        low_gain_dB: mixSettings.low_db,
        low_freq: 100,
        mid_gain_dB: mixSettings.mid_db,
        mid_freq: 1000,
        mid_q: 0.707,
        high_gain_dB: mixSettings.high_db,
        high_freq: 5000,
      },
    };
    mix = ['26', 0];
  }

  wf[SAVE_NODE_ID] = saveMp3(mix);
  return wf;
}

// Sépare un morceau importé en voix + instrumental (pas de génération).
export function buildSeparationWorkflow(audio) {
  return {
    '40': { class_type: 'LoadAudio', inputs: { audio } },
    '41': { class_type: SEPARATION_NODE, inputs: { audio: ['40', 0] } },
    '42': {
      class_type: 'AudioMerge',
      inputs: { audio1: ['40', 0], audio2: ['41', VOCALS_OUTPUT], merge_method: 'subtract' },
    },
    '30': saveMp3(['41', VOCALS_OUTPUT], '_voix'),
    '31': saveMp3(['42', 0], '_instrumental'),
  };
}

// Détecte le tempo d'un morceau ; le résultat sort en texte du nœud TEMPO_RESULT_NODE.
export const TEMPO_RESULT_NODE = '52';
export function buildTempoWorkflow(audio) {
  return {
    '50': { class_type: 'LoadAudio', inputs: { audio } },
    '51': { class_type: TEMPO_NODE, inputs: { audio: ['50', 0] } },
    [TEMPO_RESULT_NODE]: { class_type: 'PreviewAny', inputs: { source: ['51', 2] } },
  };
}

// Libellés affichés pendant l'exécution de chaque nœud.
export const NODE_LABELS = {
  '1': 'Chargement du modèle',
  '2': 'Préparation du modèle',
  '3': 'Encodage du style et des paroles (LLM)',
  '4': 'Préparation du conditionnement',
  '5': 'Création du latent audio',
  '6': 'Diffusion',
  '7': 'Décodage audio',
  '10': 'Chargement du morceau importé',
  '11': 'Encodage du morceau importé',
  '12': 'Référence de reprise',
  '13': 'Découpe du morceau importé',
  '20': 'Séparation voix / instrumental',
  '21': "Chargement de l'extrait de voix",
  '22': 'Clonage de la voix (Seed-VC)',
  '23': "Extraction de l'instrumental",
  '24': 'Mixage voix + instrumental',
  '25': 'Volume de la voix',
  '26': 'Égaliseur',
  '30': 'Enregistrement de la voix seule',
  '31': "Enregistrement de l'instrumental",
  '40': 'Chargement du morceau',
  '41': 'Séparation voix / instrumental',
  '42': "Extraction de l'instrumental",
  [SAVE_NODE_ID]: 'Enregistrement du MP3',
};
