// Bot copy in UK + EN. Kyiv pilot ships UK as default for every
// user regardless of their Telegram client locale — that's the
// pilot's whole reason for existing (the dog should sound like he's
// from Kyiv, not auto-translated from English). EN is opt-in via
// the /lang command, persisted per user in Redis.
//
// Voice spec (see Pidmohylny "Місто" reference in repo root):
//   - modern Kyiv UK, no 1928 archaisms (sets that feel "literary"
//     like либонь/сей/інакший are out).
//   - sensory beat first, observation second, optional dry footnote
//     third. The em-dash pivot is where the wit lives.
//   - dignified words for small subjects is the Pidmohylny move —
//     "запам'ятав" not "записав", "занюхав" not "знайшов".
//   - the dog catches himself mid-thought ("не дочув", "ніс у пост")
//     — small physical beats in asterisks.

export type Lang = 'uk' | 'en';

export const DEFAULT_LANG: Lang = 'uk';

// Parse a /lang command's argument into a Lang or null. Accepts a
// few obvious variants ("en", "english", "англ", "ua", "uk",
// "укр") so the command is tolerant of natural typing.
export function parseLangArg(raw: string): Lang | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('en') || v.startsWith('англ') || v === 'eng') return 'en';
  if (v.startsWith('uk') || v.startsWith('ua') || v.startsWith('укр') || v.startsWith('укра')) return 'uk';
  return null;
}

interface TgCommand {
  command: string;
  description: string;
}

export interface BotMessages {
  welcome: (firstName: string | undefined) => string;
  deepLinkPrompt: string;
  lostCommandHint: string;
  otherDm: string;
  dmInserted: (args: { name: string; emoji: string; link: string }) => string;
  dmUpdated: (args: { name: string; emoji: string; link: string }) => string;
  dmDuplicate: (args: { name?: string; link: string }) => string;
  dmFallback: string;
  dmPhotoOnly: string;
  groupInserted: (args: { name: string; emoji: string }) => string;
  groupDuplicate: string;
  groupFallback: string;
  langSwitched: string;
  langHint: string;
  buttonOpenApp: string;
  buttonOpenSearch: string;
  meta: {
    description: string;
    shortDescription: string;
    commands: TgCommand[];
    menuButtonText: string;
  };
}

const uk: BotMessages = {
  welcome: (firstName) => {
    const hi = firstName ? `*хвостом* привіт, ${firstName}!` : '*хвостом* привіт!';
    return [
      hi,
      '',
      'я — <b>шукайпес</b>, такий знайомий пес із Києва. ходімо разом: походимо, понюхаємо, знайдемо загублених, потроху вивчимо місто. лапа за лапою.',
      '',
      "🆘 <b>загубив когось?</b> кажи мені просто отут. напиши ім'я, де востаннє бачили, як виглядає — фотка ще краще. додам на мапу, щоб сусіди теж шукали.",
      '',
      'тиць нижче — і ходімо. 🐾',
    ].join('\n');
  },
  deepLinkPrompt:
    "🐾 тиць нижче — відкрию пошук просто на тому собаці. не загубимось.",
  lostCommandHint: [
    'розкажи про того, хто пропав 🐾',
    '',
    "що детальніше — то краще: ім'я, де і коли востаннє бачив, як виглядає, чи є винагорода. фотка дуже допомагає.",
    '',
    '<i>наприклад: «загубив пса Барсика на Поштовій вчора ввечері, чорний з білою лапою, нашийник червоний, винагорода 2000»</i>',
  ].join('\n'),
  otherDm:
    '*вуха набік* — не зовсім зрозумів. ходімо разом, на мапі видніше. (а як загубив когось — кажи отут, додам на мапу.)',
  dmInserted: ({ name, emoji, link }) =>
    [
      `${emoji} запам'ятав. ${name} — тепер на мапі.`,
      '',
      'тиць по кнопці, щоб відкрити пошук. а посилання кинь сусідам — кому, як не їм, шукати поруч:',
      '',
      link,
    ].join('\n'),
  dmUpdated: ({ name, emoji, link }) =>
    [
      `${emoji} оновив — ${name} тепер свіжіший на мапі.`,
      '',
      'кинь посилання сусідам, нехай не забувають дивитись:',
      '',
      link,
    ].join('\n'),
  dmDuplicate: ({ name, link }) =>
    [
      name
        ? `*ніс угору* — цього вже занюхав. ${name} на мапі є.`
        : '*ніс угору* — цього вже занюхав. на мапі є.',
      '',
      'кинь посилання сусідам, нехай шукають разом:',
      '',
      link,
    ].join('\n'),
  dmFallback:
    'не дочув. спробуй так: «загубив пса Барсика на Поштовій вчора, чорний з білою лапою, винагорода». це я зрозумію відразу.',
  dmPhotoOnly:
    "*ніс до фотки* — гарна. розкажи ще: кого шукаємо, де востаннє бачили?",
  groupInserted: ({ name, emoji }) =>
    `*ніс у пост* ${emoji}\n\nдодав ${name} на мапу — тиць нижче, ходімо шукати:`,
  groupDuplicate: '*ніс у пост* — цього вже занюхав. на мапі є:',
  groupFallback:
    '*ніс у пост* — здається, хтось пропав. відкрий мене — разом понюхаємо:',
  langSwitched: '*кивнув* добре, говоримо українською.',
  langHint:
    "*вухом* можу англійською, якщо зручніше — напиши <code>/lang en</code>. або <code>/lang uk</code>, щоб повернутись.",
  buttonOpenApp: '🐾 відкрити шукайпеса',
  buttonOpenSearch: '🐾 відкрити пошук',
  meta: {
    description:
      "гав! загубив когось? кажи мені просто сюди — додам на мапу. або /start, щоб ходити Києвом разом 🐾",
    shortDescription: 'кожна прогулянка має сенс 🐾',
    commands: [
      { command: 'start', description: 'відкрити шукайпеса' },
      { command: 'lost', description: 'повідомити про пропажу' },
      { command: 'lang', description: 'мова бота (uk / en)' },
    ],
    menuButtonText: 'відкрити шукайпеса',
  },
};

const en: BotMessages = {
  welcome: (firstName) => {
    const hi = firstName ? `*tail wag* hi, ${firstName}!` : '*tail wag* hi!';
    return [
      hi,
      '',
      "i'm <b>шукайпес</b> — your kyiv walking companion. we walk, we sniff, we find lost pets, we learn the city paw by paw.",
      '',
      "🆘 <b>lost someone?</b> just tell me right here — say their name, where you last saw them, what they look like (a photo helps a lot). i'll add them to the map so neighbours can spot them.",
      '',
      'tap below to open the map. 🐾',
    ].join('\n');
  },
  deepLinkPrompt:
    "🐾 tap below to open the search — i'll take you straight to the pin.",
  lostCommandHint: [
    'tell me about your missing pet 🐾',
    '',
    'more detail = better — name, where + when last seen, what they look like, any reward. a photo helps a lot.',
    '',
    '<i>example: «lost my dog Barsyk near Poshtova yesterday evening, black with a white paw, red collar, reward 2000»</i>',
  ].join('\n'),
  otherDm:
    "*ear flick* — didn't quite catch that. come walk with me — the map's clearer. (lost someone? tell me right here and i'll add them to the map.)",
  dmInserted: ({ name, emoji, link }) =>
    [
      `${emoji} got it. ${name} is on the map.`,
      '',
      "tap the button to open the search. and share this link with neighbours — they're the ones who'll spot them nearby:",
      '',
      link,
    ].join('\n'),
  dmUpdated: ({ name, emoji, link }) =>
    [
      `${emoji} updated — ${name}'s entry is fresher on the map now.`,
      '',
      'share the link with neighbours so they keep an eye out:',
      '',
      link,
    ].join('\n'),
  dmDuplicate: ({ name, link }) =>
    [
      name
        ? `*nose up* — sniffed this one before. ${name}'s already on the map.`
        : "*nose up* — sniffed this one before. already on the map.",
      '',
      'share the link with neighbours so they look together:',
      '',
      link,
    ].join('\n'),
  dmFallback:
    "didn't quite catch it. try: «lost my dog Barsyk near Poshtova yesterday, black with a white paw, reward». that i'll get right away.",
  dmPhotoOnly:
    "*nose to the photo* — nice one. tell me more: who are we looking for, where last seen?",
  groupInserted: ({ name, emoji }) =>
    `*sniff sniff* ${emoji}\n\nadded ${name} to the map — tap below, let's go find them:`,
  groupDuplicate: '*sniff sniff* — sniffed this one before. on the map already:',
  groupFallback:
    "*sniff sniff* — looks like a lost one. open me, let's sniff together:",
  langSwitched: '*nod* alright, switching to english.',
  langHint:
    "*ear flick* i can switch to ukrainian — say <code>/lang uk</code>. or <code>/lang en</code> to stay in english.",
  buttonOpenApp: '🐾 open шукайпес',
  buttonOpenSearch: '🐾 open the search',
  meta: {
    description:
      "woof! lost a pet? tell me here and i'll add them to the map. or /start to walk and sniff kyiv with me 🐾",
    shortDescription: 'every walk has a purpose 🐾',
    commands: [
      { command: 'start', description: 'open шукайпес' },
      { command: 'lost', description: 'report a missing pet' },
      { command: 'lang', description: 'bot language (uk / en)' },
    ],
    menuButtonText: 'open шукайпес',
  },
};

export const messages: Record<Lang, BotMessages> = { uk, en };
