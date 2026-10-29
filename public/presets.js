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
