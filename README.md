# Musique Generator

Interface web pour générer de la musique avec **ComfyUI** et le modèle **ACE-Step 1.5 Turbo AIO** (`ace_step_1.5_turbo_aio.safetensors`).

## Prérequis

- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) récent (nœuds ACE-Step 1.5 natifs), lancé sur `http://127.0.0.1:8188`.
- Le checkpoint `ace_step_1.5_turbo_aio.safetensors` (**9,34 Go**) dans `ComfyUI/models/checkpoints/` :
  https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/checkpoints/ace_step_1.5_turbo_aio.safetensors
- Node.js 18+ (aucune dépendance npm).
- *Optionnel, pour les voix clonées* : deux custom nodes ComfyUI (voir ci-dessous).

### Voix clonées (optionnel)

1. Dans `ComfyUI/custom_nodes/` :
   ```bash
   git clone https://github.com/christian-byrne/audio-separation-nodes-comfyui
   git clone https://github.com/billwuhao/ComfyUI_Seed-VC
   ```
   puis installez leurs dépendances avec le Python de ComfyUI (version portable) :
   ```bash
   python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\audio-separation-nodes-comfyui\requirements.txt
   python_embeded\python.exe -m pip install -r ComfyUI\custom_nodes\ComfyUI_Seed-VC\requirements.txt
   ```
   (ou via ComfyUI Manager).
2. Téléchargez les modèles Seed-VC **à la main** (le node ne les télécharge pas) :
   - dans `ComfyUI/models/TTS/Seed-VC/` : `DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema.pth` et `DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth` ([Plachta/Seed-VC](https://huggingface.co/Plachta/Seed-VC)), `campplus_cn_common.bin` ([funasr/campplus](https://huggingface.co/funasr/campplus)), `rmvpe.pt` ([lj1995/VoiceConversionWebUI](https://huggingface.co/lj1995/VoiceConversionWebUI)) ;
   - dans `ComfyUI/models/TTS/` : les dossiers `bigvgan_v2_22khz_80band_256x`, `bigvgan_v2_44khz_128band_512x` (`bigvgan_generator.pt` + `config.json`, [nvidia](https://huggingface.co/nvidia)) et `whisper-small` (`model.safetensors` + fichiers `.json`/`.txt`, [openai/whisper-small](https://huggingface.co/openai/whisper-small)).
3. Relancez ComfyUI. Sans ces nodes, le site fonctionne normalement et le bloc « Voix » indique ce qui manque.

## Lancement

```bash
npm start            # ou : node server.js
```

Ouvrez http://localhost:3000.

Variables d'environnement optionnelles :

| Variable    | Défaut                   | Rôle                    |
|-------------|--------------------------|-------------------------|
| `PORT`      | `3000`                   | Port du site            |
| `COMFY_URL` | `http://127.0.0.1:8188`  | Adresse de ComfyUI      |

Le serveur sert le site et relaie `/comfy/*` (HTTP + WebSocket) vers ComfyUI : inutile d'activer le CORS côté ComfyUI.

## Utilisation

1. Choisissez un **exemple** et cliquez sur « Charger l'exemple » (le lo-fi de 60 s est le plus rapide pour tester).
2. **Style / tags** : genre, instruments, voix, ambiance, production. En anglais de préférence, séparés par des virgules.
   ex. `french pop, upbeat, female vocals, acoustic guitar, punchy drums`
3. **Paroles** : structurez avec `[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Outro]`.
   Pour un morceau sans voix : `[Instrumental]`.
4. **Langue** : celle des paroles (`fr`, `en`, …).
5. **Durée, BPM, mesure, tonalité** : guident la structure musicale.
6. **Seed** : même seed + mêmes réglages = même morceau. 🎲 pour en tirer un au hasard.
7. **Générer** : le MP3 est copié dans le dossier `output/` du projet (nommé `AAAA-MM-JJ_HH-MM-SS_MusiqueGenerator_xxxxx.mp3`) et apparaît dans « Morceaux générés ». ComfyUI en garde aussi une copie dans `ComfyUI/output/audio/`.

### Voix clonée

Dans le bloc **Voix**, « Ajouter une voix » : un nom + un extrait de **5 à 25 s de voix seule** (sans musique, peu de réverbération). La voix est enregistrée dans `voices/` du projet et réutilisable.
En la sélectionnant, le morceau est généré normalement, puis la voix est séparée de l'instrumental (Demucs), convertie avec le timbre de l'extrait (Seed-VC) et remixée sur l'instrumental.
Réglages : transposition (demi-tons, utile pour passer d'une voix d'homme à une voix de femme), étapes Seed-VC (30 par défaut), ajustement automatique de la hauteur.
Le morceau doit contenir du chant : décrivez une voix proche dans les tags (`female vocals`, …) pour un meilleur résultat.

### Reprise d'un morceau

Cochez « Partir d'un morceau existant » et choisissez un fichier audio : ACE-Step régénère un titre qui suit sa structure, sa mélodie et son instrumental, avec vos tags et paroles (nœud natif `ReferenceTimbreAudio`).
- « Durée = celle du morceau » recopie sa durée (max 600 s) ; sinon le morceau est coupé à la durée choisie.
- **Fidélité** : 0 = reprise libre ; en l'augmentant, la génération part du morceau original bruité et lui reste plus proche.
- Les codes audio LLM sont automatiquement désactivés en mode reprise.
- Combinable avec une voix clonée.

Réglages avancés (valeurs du template officiel) : 8 étapes, shift 3, CFG LLM 2, température 0,85, top P 0,9.
Décocher « Codes audio LLM » accélère la génération au prix de la qualité.

## Structure

```
server.js           serveur statique + proxy ComfyUI + copie des morceaux dans output/ + API des voix
output/             morceaux générés (créé automatiquement)
voices/             voix enregistrées + voices.json (créé automatiquement)
public/index.html   page
public/app.js       logique (envoi du prompt, progression WebSocket, résultats)
public/workflow.js  workflow ComfyUI au format API (d'après le template officiel « audio_ace_step_1_5_checkpoint »)
public/presets.js   exemples
public/style.css    styles
```

## Dépannage

- **« ComfyUI injoignable »** : lancez ComfyUI ou ajustez `COMFY_URL`.
- **« Modèle introuvable »** : vérifiez le nom et l'emplacement du checkpoint.
- **Bloc Voix grisé** : custom nodes absents ou en erreur au démarrage de ComfyUI (regardez sa console).
- **Erreur `SeedVCRun` / fichier introuvable** : un modèle Seed-VC manque dans `ComfyUI/models/TTS/`.
- **`SeedVCRun` incompatible avec un ComfyUI récent** (à réappliquer après une mise à jour du node, dossier `custom_nodes/seed-vc-mw/`), puis relancer ComfyUI :
  - `BigVGAN._from_pretrained() missing ... 'proxies' and 'resume_download'` : dans `seed_vc/modules/bigvgan/bigvgan.py`, donner des valeurs par défaut : `proxies: Optional[Dict] = None,` et `resume_download: bool = False,`.
  - `TorchCodec is required for save_with_torchcodec` : dans `seedvcnode.py` (`cache_audio_tensor`), remplacer `torchaudio.save(temp_filepath, audio_tensor, sample_rate)` par
    `import soundfile` puis `soundfile.write(temp_filepath, audio_tensor.detach().float().cpu().numpy().T, sample_rate)`.
- **`extends past the end of the file` / `corrupt/incomplete`** : le téléchargement du checkpoint est incomplet ; retéléchargez-le (le fichier doit faire ~9,34 Go).
