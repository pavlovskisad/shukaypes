// THE BOT ROSTER, and the portraits drawn for it. D-73.
//
// Bots used to be a name and a home. Once the map shows every dog as a
// chip with its portrait in it (D-73) a bot without one is a blank
// circle among drawn dogs, so each roster entry carries a breed and a
// one-line description, and `pnpm bots:avatars` draws a portrait for
// it the same way a person's is drawn (D-72) — the describe recipe,
// from the words alone, no photo — into assets/bot-avatars/<i>.png.
// The files ship in the image (the Dockerfile copies assets/) and are
// served by GET /bot-avatars/<i>.png.
//
// The first twenty names are the ones the bots have always had, in
// the same order: `bot:N` keeps its name, and the users row it has
// under that name. Ten more so thirty bots do not repeat a name.
//
// A bot with no file yet gets `avatarUrl: null`, and the chip falls
// back to the shared dog. Nothing here reads the network.

import fs from 'node:fs';
import path from 'node:path';

export interface BotRosterEntry {
  name: string;
  breed: string;
  // What the caricaturist is told (petDescription.ts's five parts), so
  // the drawing is this breed and not the samples' animal.
  description: string;
}

export const BOT_ROSTER: BotRosterEntry[] = [
  { name: 'Рекс', breed: 'German shepherd', description: 'coat: dark and short, tan face; ears: big, pointed, standing up; muzzle: long, black nose; markings: dark saddle; look: serious, tongue out.' },
  { name: 'Барон', breed: 'Basset hound', description: 'coat: mixed and short; ears: very long, hanging past the chin; muzzle: long and droopy, black nose; markings: patches; look: sleepy, sad eyes.' },
  { name: 'Лакі', breed: 'Jack Russell terrier', description: 'coat: light and short; ears: small, folded forward; muzzle: short, black nose; markings: a dark patch over one eye; look: alert, cheeky grin.' },
  { name: 'Бім', breed: 'Beagle', description: 'coat: mixed and short; ears: long, floppy, rounded; muzzle: medium, black nose; markings: dark patches on the ears, white blaze; look: curious, head tilt.' },
  { name: 'Джек', breed: 'Labrador', description: 'coat: light and short; ears: floppy, hanging; muzzle: broad and blunt, black nose; markings: none; look: happy grin, tongue out.' },
  { name: 'Марс', breed: 'Husky', description: 'coat: mixed and thick; ears: pointed, standing up; muzzle: medium, black nose; markings: dark cap and mask, white face; look: intense stare, one eye lighter.' },
  { name: 'Тузік', breed: 'Mongrel', description: 'coat: mixed and shaggy; ears: one up, one folded; muzzle: medium, black nose; markings: a dark spot on the side of the face; look: goofy grin.' },
  { name: 'Шарік', breed: 'Spitz', description: 'coat: light and fluffy; ears: small, pointed, standing up; muzzle: short and pointed, small black nose; markings: none; look: smug little smile.' },
  { name: 'Найда', breed: 'Mongrel', description: 'coat: dark and short; ears: floppy, uneven; muzzle: medium, black nose; markings: white chest; look: gentle, hopeful eyes.' },
  { name: 'Белла', breed: 'Golden retriever', description: 'coat: light and long, flowing; ears: floppy, hanging; muzzle: long and blunt, black nose; markings: none; look: happy grin, tongue out.' },
  { name: 'Молі', breed: 'Cocker spaniel', description: 'coat: light and long, wavy; ears: very long, feathered, hanging; muzzle: medium, black nose; markings: none; look: soft, pleading eyes.' },
  { name: 'Чапа', breed: 'Dachshund', description: 'coat: dark and smooth; ears: long, rounded, hanging; muzzle: very long and narrow, black nose; markings: tan eyebrows; look: stubborn, chin up.' },
  { name: 'Персик', breed: 'Pomeranian', description: 'coat: light and very fluffy, a round puff; ears: tiny, pointed; muzzle: tiny and pointed, small black nose; markings: none; look: delighted, mouth open.' },
  { name: 'Умка', breed: 'Samoyed', description: 'coat: light and very thick; ears: small, pointed, standing up; muzzle: medium, black nose; markings: none; look: the famous wide smile.' },
  { name: 'Гав', breed: 'Boxer', description: 'coat: mixed and short; ears: folded, hanging; muzzle: short and square, wide black nose; markings: white blaze, dark mask; look: worried eyebrows, jowls.' },
  { name: 'Кузя', breed: 'Pug', description: 'coat: light and short; ears: small, folded; muzzle: flat and wrinkled, black nose; markings: dark mask; look: bulging eyes, tongue poking out.' },
  { name: 'Арчі', breed: 'Border collie', description: 'coat: mixed and medium; ears: half-pricked; muzzle: medium and pointed, black nose; markings: white blaze and collar on dark; look: intense, focused stare.' },
  { name: 'Боня', breed: 'Yorkshire terrier', description: 'coat: mixed and long, silky, hanging; ears: small, pointed, standing up; muzzle: short, small black nose; markings: a topknot; look: haughty.' },
  { name: 'Джесі', breed: 'Corgi', description: 'coat: mixed and short; ears: huge, rounded, standing up; muzzle: medium, black nose; markings: white blaze, dark cap; look: wide happy grin.' },
  { name: 'Локі', breed: 'Schnauzer', description: 'coat: dark and wiry; ears: folded forward; muzzle: square with a long beard and bushy eyebrows, black nose; markings: none; look: grumpy old man.' },
  { name: 'Рудий', breed: 'Shiba inu', description: 'coat: mixed and short; ears: small, pointed, standing up; muzzle: short and fox-like, black nose; markings: white cheeks and chest; look: judging side-eye.' },
  { name: 'Соня', breed: 'French bulldog', description: 'coat: light and short; ears: huge bat ears, standing up; muzzle: flat, wide black nose; markings: a dark patch over one eye; look: sleepy grin.' },
  { name: 'Буся', breed: 'Chihuahua', description: 'coat: light and short; ears: huge, pointed, standing out sideways; muzzle: tiny, small black nose; markings: none; look: enormous eyes, trembling.' },
  { name: 'Зефір', breed: 'Bichon frise', description: 'coat: light and curly, a cloud; ears: hidden in the fluff, hanging; muzzle: short, small black nose; markings: none; look: tiny black eyes, sweet.' },
  { name: 'Пиріжок', breed: 'English bulldog', description: 'coat: light and short; ears: small, folded; muzzle: flat, wide, wrinkled, wide black nose; markings: a dark patch; look: grumpy underbite.' },
  { name: 'Ґрета', breed: 'Whippet', description: 'coat: light and smooth; ears: small, folded back; muzzle: very long and narrow, small black nose; markings: none; look: anxious, wide eyes.' },
  { name: 'Вася', breed: 'Mongrel', description: 'coat: mixed and scruffy; ears: floppy, one torn; muzzle: medium, black nose; markings: patches everywhere; look: cheeky, tongue out.' },
  { name: 'Фрося', breed: 'Poodle', description: 'coat: light and curly; ears: long, curly, hanging; muzzle: long, black nose; markings: none; look: elegant, chin up.' },
  { name: 'Оскар', breed: 'Akita', description: 'coat: mixed and thick; ears: small, pointed, standing up; muzzle: broad, black nose; markings: white face; look: calm, dignified.' },
  { name: 'Жужа', breed: 'Cavalier King Charles spaniel', description: 'coat: mixed and long, silky; ears: long, feathered, hanging; muzzle: short, black nose; markings: patches around the eyes; look: big round eyes.' },
];

export function botIndex(id: string): number | null {
  const m = /^bot:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export function botEntry(i: number): BotRosterEntry {
  return BOT_ROSTER[i % BOT_ROSTER.length]!;
}

export function botAvatarsDir(): string {
  return process.env.BOT_AVATARS_DIR?.trim() || path.join(process.cwd(), 'assets', 'bot-avatars');
}

export function botAvatarFile(i: number): string {
  return path.join(botAvatarsDir(), `${i}.png`);
}

const DEFAULT_BASE = 'https://shukajpes-api.fly.dev';
function publicBase(): string {
  return (process.env.PUBLIC_API_URL ?? process.env.TELEGRAM_PUBLIC_URL ?? DEFAULT_BASE).replace(/\/$/, '');
}

// Checked once per index per process: the files do not change while
// the server runs, and the bots cron would otherwise stat thirty files
// every few seconds.
const haveFile = new Map<number, boolean>();
export function botAvatarUrl(i: number): string | null {
  let have = haveFile.get(i);
  if (have === undefined) {
    have = fs.existsSync(botAvatarFile(i));
    haveFile.set(i, have);
  }
  return have ? `${publicBase()}/bot-avatars/${i}.png` : null;
}

// A bot's level, for its card. Bots have no experience; this is a stable
// number per bot so the card has one, spread over the range a walker a
// few weeks in would have. It is a fiction, like the bot.
export function botLevel(i: number): number {
  return 2 + ((i * 7) % 11);
}
