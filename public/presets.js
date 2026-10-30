// Exemples prêts à l'emploi. « hint » explique ce que l'exemple illustre.

export const PRESETS = [
  {
    id: 'lofi',
    name: 'Lo-fi instrumental (test rapide, 60 s)',
    hint: "Pas de paroles : on écrit simplement [Instrumental]. Le style décrit les instruments, l'ambiance et la production. Idéal pour vérifier que tout fonctionne.",
    params: {
      tags: 'lo-fi hip hop, chill, instrumental, mellow Rhodes piano, dusty vinyl crackle, soft boom-bap drums, warm upright bass, relaxing, late night study vibe',
      lyrics: '[Instrumental]',
      duration: 60,
      bpm: 82,
      timesignature: '4',
      language: 'en',
      keyscale: 'F major',
      seed: 42,
    },
  },
  {
    id: 'pop-fr',
    name: 'Pop française avec paroles (90 s)',
    hint: 'Choisissez la langue « fr » pour des paroles en français. Les balises [Verse], [Chorus], [Bridge]… structurent la chanson.',
    params: {
      tags: 'french pop, upbeat, catchy melody, female vocals, bright synths, acoustic guitar, punchy drums, summer feeling',
      lyrics: `[Intro]

[Verse 1]
Le soleil se lève sur la ville
Les rues s'éveillent, tout est tranquille
J'ai mis mes rêves dans un sac à dos
Je pars ce matin, je pars sans un mot

[Chorus]
On danse, on danse sous le ciel bleu
Le monde est grand quand on est deux
On chante, on chante jusqu'au matin
L'été commence, prends-moi la main

[Verse 2]
Les heures s'envolent comme des oiseaux
On suit la route au bord de l'eau
Et si demain tout recommence
Je garderai ce goût de vacances

[Chorus]
On danse, on danse sous le ciel bleu
Le monde est grand quand on est deux
On chante, on chante jusqu'au matin
L'été commence, prends-moi la main

[Outro]`,
      duration: 90,
      bpm: 118,
      timesignature: '4',
      language: 'fr',
      keyscale: 'G major',
      seed: 1234,
    },
  },
  {
    id: 'neosoul',
    name: 'Neo-Soul (exemple officiel ComfyUI, 120 s)',
    hint: "L'exemple du template officiel : un style très détaillé (rythme, instruments, sensation) et des paroles longues structurées.",
    params: {
      tags: 'Neo-Soul: A warm, organic neo-soul track dripping with live instrumentation and effortless groove. A live drummer plays a loose, hip-hop influenced pocket—soft kick drum with lazy swing, snare hits that sit just behind the beat, and brushed hi-hats that breathe and shuffle with human imperfection.',
      lyrics: `[Intro - Guitar Riff & Drums]
mm…
yeah…
let it breathe…

[Verse 1]
Late night glow on your skin
Window cracked, city hums again
Coffee rings on the table top
Time don't rush, it just drops

Loose kick drum, heart runs slow
Snare talks back, says "take it low"
Every step just slightly late
Still we land right on the faith

[Pre-Chorus]
No count-in for this kind of love
We don't line it up
We just lean and trust

[Chorus]
Stay right there, don't pull it straight
I love how we arrive late
Off the grid but locked in time
That lazy swing feels like mine

Yeah we bend, we drift, we sway
Let tomorrow wait its turn today
If love lives just off the line
Soft kick drum, your hand in mine

[Bridge]
Brush it light, let it breathe
Leave a little space for me
Every miss is part of it
That's how soul was always meant

[Chorus]
Stay right there, don't pull it straight
I love how we arrive late
Off the grid but locked in time
That lazy swing feels like mine

[Outro - Guitar Riff & Final Chord]
no rush…
no rush…
just groove…`,
      duration: 120,
      bpm: 120,
      timesignature: '4',
      language: 'en',
      keyscale: 'E minor',
      seed: 31,
    },
  },
  {
    id: 'epic',
    name: 'Orchestral épique (instrumental, 90 s)',
    hint: 'Un autre style instrumental : en 3/4 et en tonalité mineure pour une ambiance dramatique.',
    params: {
      tags: 'epic orchestral, cinematic, instrumental, soaring strings, french horns, timpani, choir pads, building tension, heroic climax, film score',
      lyrics: '[Instrumental]',
      duration: 90,
      bpm: 96,
      timesignature: '3',
      language: 'en',
      keyscale: 'D minor',
      seed: 7,
    },
  },
];

// Types de voix de base : des tags ACE-Step, sans extrait audio ni custom node.
// Ils remplacent les tags de voix déjà présents dans le style.
export const BASIC_VOICES = [
  { id: 'female-soft', name: 'Femme — douce', tags: 'female vocals, soft, breathy, intimate' },
  { id: 'female-pop', name: 'Femme — pop claire', tags: 'female vocals, bright, clear, pop' },
  { id: 'female-power', name: 'Femme — puissante', tags: 'female vocals, powerful, belting, soulful' },
  { id: 'male-deep', name: 'Homme — grave', tags: 'male vocals, deep baritone, warm' },
  { id: 'male-tenor', name: 'Homme — ténor', tags: 'male vocals, tenor, clear, emotional' },
  { id: 'male-raspy', name: 'Homme — rauque', tags: 'male vocals, raspy, gritty' },
  { id: 'rap', name: 'Rap', tags: 'male rap vocals, rhythmic flow, confident delivery' },
  { id: 'whisper', name: 'Chuchotée', tags: 'whispered vocals, airy, intimate' },
  { id: 'duet', name: 'Duo homme / femme', tags: 'male and female duet vocals, harmonies' },
  { id: 'choir', name: 'Chœur', tags: 'choir vocals, layered harmonies, epic' },
];

// « Surprends-moi » : chaque genre a ses instruments, sa plage de BPM et des types de voix cohérents.
const RANDOM_GENRES = [
  { tags: 'french pop, catchy melody', instruments: ['acoustic guitar', 'bright synths', 'punchy drums', 'piano', 'claps'], bpm: [96, 124], minor: 0.3, voices: ['female-pop', 'male-tenor', 'duet'] },
  { tags: 'synthwave, retro 80s', instruments: ['analog synths', 'driving bass', 'gated reverb drums', 'arpeggiator'], bpm: [90, 118], minor: 0.7, voices: ['male-tenor', 'female-soft'] },
  { tags: 'lo-fi hip hop, chill', instruments: ['mellow Rhodes piano', 'vinyl crackle', 'boom-bap drums', 'upright bass'], bpm: [70, 90], minor: 0.5, voices: ['rap', 'whisper', 'female-soft'] },
  { tags: 'indie folk, intimate', instruments: ['fingerpicked acoustic guitar', 'soft strings', 'harmonica', 'light percussion'], bpm: [72, 104], minor: 0.4, voices: ['male-deep', 'female-soft', 'duet'] },
  { tags: 'rock, energetic', instruments: ['distorted electric guitars', 'live drums', 'bass guitar', 'organ'], bpm: [110, 150], minor: 0.5, voices: ['male-raspy', 'female-power'] },
  { tags: 'soul, groovy', instruments: ['horn section', 'Hammond organ', 'funky bass', 'tight drums'], bpm: [80, 108], minor: 0.4, voices: ['female-power', 'male-tenor', 'choir'] },
  { tags: 'french rap, urban', instruments: ['808 bass', 'trap hi-hats', 'dark piano', 'atmospheric pads'], bpm: [130, 150], minor: 0.8, voices: ['rap'] },
  { tags: 'electro pop, dance', instruments: ['four-on-the-floor kick', 'sidechained synths', 'plucks', 'sub bass'], bpm: [118, 128], minor: 0.5, voices: ['female-pop', 'male-tenor'] },
  { tags: 'jazz ballad, smoky club', instruments: ['brushed drums', 'upright bass', 'piano trio', 'muted trumpet'], bpm: [60, 84], minor: 0.5, voices: ['female-soft', 'male-deep', 'whisper'] },
  { tags: 'reggae, sunny', instruments: ['offbeat guitar skank', 'deep bass', 'one-drop drums', 'organ bubble'], bpm: [70, 90], minor: 0.3, voices: ['male-tenor', 'duet'] },
  { tags: 'cinematic pop, epic', instruments: ['soaring strings', 'big drums', 'piano', 'choir pads'], bpm: [84, 110], minor: 0.7, voices: ['female-power', 'choir', 'male-tenor'] },
  { tags: 'bossa nova, relaxed', instruments: ['nylon guitar', 'soft shaker', 'warm bass', 'flute'], bpm: [110, 140], minor: 0.4, voices: ['whisper', 'female-soft', 'duet'] },
];
const RANDOM_MOODS = ['nostalgic', 'uplifting', 'melancholic', 'dreamy', 'euphoric', 'romantic', 'dark', 'hopeful', 'bittersweet', 'playful'];
const RANDOM_PRODUCTION = ['warm analog mix', 'polished radio mix', 'lush reverb', 'intimate close-mic production', 'wide stereo mix'];
const RANDOM_KEYS = ['C', 'D', 'Eb', 'E', 'F', 'G', 'A', 'Bb'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const pickSome = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

// Renvoie des réglages partiels : tags, bpm, keyscale, basic_voice.
export function randomStyle() {
  const genre = pick(RANDOM_GENRES);
  const voiceId = pick(genre.voices);
  return {
    tags: [genre.tags, ...pickSome(genre.instruments, 3), pick(RANDOM_MOODS), pick(RANDOM_PRODUCTION)].join(', '),
    bpm: genre.bpm[0] + Math.floor(Math.random() * (genre.bpm[1] - genre.bpm[0] + 1)),
    keyscale: `${pick(RANDOM_KEYS)} ${Math.random() < genre.minor ? 'minor' : 'major'}`,
    basic_voice: BASIC_VOICES.find((v) => v.id === voiceId),
  };
}
