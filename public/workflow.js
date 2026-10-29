// Construit le prompt ComfyUI (format API) reproduisant le template officiel
// « audio_ace_step_1_5_checkpoint » pour ace_step_1.5_turbo_aio.safetensors,
// avec deux extensions optionnelles :
//  - reprise (cover) : un morceau importé guide la structure via ReferenceTimbreAudio ;
//  - voix clonée : séparation voix / instrumental puis conversion Seed-VC et remixage.

export const CHECKPOINT = 'ace_step_1.5_turbo_aio.safetensors';
export const SAVE_NODE_ID = '9';
// Custom nodes nécessaires à la voix clonée (audio-separation-nodes-comfyui, ComfyUI_Seed-VC).
export const REQUIRED_VOICE_NODES = ['AudioSeparation', 'SeedVCRun'];

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
};

const VOCALS_OUTPUT = 3; // AudioSeparation : Bass, Drums, Other, Vocals

export function buildWorkflow(input) {
  const p = { ...DEFAULTS, ...input };
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
    [SAVE_NODE_ID]: {
      class_type: 'SaveAudioMP3',
      inputs: { audio: ['7', 0], filename_prefix: 'audio/MusiqueGenerator', quality: 'V0' },
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

  if (p.voice) {
    wf['20'] = { class_type: 'AudioSeparation', inputs: { audio: ['7', 0] } };
    wf['21'] = { class_type: 'LoadAudio', inputs: { audio: p.voice.audio } };
    wf['22'] = {
      class_type: 'SeedVCRun',
      inputs: {
        source_audio: ['20', VOCALS_OUTPUT],
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
    // Instrumental = mix - voix ; puis on y ajoute la voix convertie.
    wf['23'] = {
      class_type: 'AudioMerge',
      inputs: { audio1: ['7', 0], audio2: ['20', VOCALS_OUTPUT], merge_method: 'subtract' },
    };
    wf['24'] = {
      class_type: 'AudioMerge',
      inputs: { audio1: ['23', 0], audio2: ['22', 0], merge_method: 'add' },
    };
    wf[SAVE_NODE_ID].inputs.audio = ['24', 0];
  }

  return wf;
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
  [SAVE_NODE_ID]: 'Enregistrement du MP3',
};
