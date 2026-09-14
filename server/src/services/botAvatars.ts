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
// under that name. Ten more so thirty bots do not repeat a name, and
// ninety more (D-78) so a hundred and twenty do not either.
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
  { name: 'Жужа', breed: 'Cavalier King Charles spaniel', description: 'coat: mixed and long, silky; ears: long, feathered, hanging; muzzle: short, black nose; markings: patches around the eyes; look: big round eyes.' },  // Ninety more (D-78): a pool of 120 on an owner's hours (D-77) shows
  // ten to fifteen dogs at a time in the evening, where thirty showed
  // three. Same order rule — an index keeps its name for good.
  { name: 'Тайсон', breed: 'Rottweiler', description: 'coat: dark and short; ears: folded, hanging; muzzle: broad, black nose; markings: tan eyebrows and cheeks; look: heavy-browed, calm.' },
  { name: 'Ляля', breed: 'Maltese', description: 'coat: light and long, silky, to the ground; ears: hanging, hidden in hair; muzzle: short, black nose; markings: none; look: tiny, hair in a bow.' },
  { name: 'Граф', breed: 'Doberman', description: 'coat: dark and sleek; ears: tall, pointed, standing up; muzzle: long and narrow, black nose; markings: tan on the muzzle and chest; look: alert, chin up.' },
  { name: 'Крихітка', breed: 'Toy terrier', description: 'coat: dark and smooth; ears: huge, pointed, standing up; muzzle: tiny, small black nose; markings: tan eyebrows; look: trembling, eyes wide.' },
  { name: 'Бакс', breed: 'Staffordshire terrier', description: 'coat: mixed and short; ears: small, half-folded; muzzle: wide, black nose; markings: white chest and blaze; look: grinning, thick neck.' },
  { name: 'Ніка', breed: 'Weimaraner', description: 'coat: light and short, silver; ears: long, hanging; muzzle: long, pale nose; markings: none; look: pale eyes, elegant.' },
  { name: 'Пончик', breed: 'Pug', description: 'coat: light and short; ears: small, folded; muzzle: flat, wrinkled, black nose; markings: dark ears; look: round, tongue out.' },
  { name: 'Сіма', breed: 'Siberian laika', description: 'coat: mixed and thick; ears: pointed, standing up; muzzle: medium and pointed, black nose; markings: white mask; look: curled tail, alert.' },
  { name: 'Дюк', breed: 'Great Dane', description: 'coat: light and short; ears: folded, hanging; muzzle: long and square, black nose; markings: none; look: enormous, gentle.' },
  { name: 'Мія', breed: 'Shih tzu', description: 'coat: mixed and long, flowing; ears: hanging, hidden in hair; muzzle: short, black nose; markings: patches; look: topknot, calm.' },
  { name: 'Цезар', breed: 'Cane corso', description: 'coat: dark and short; ears: small, folded; muzzle: broad and square, black nose; markings: none; look: heavy, watchful.' },
  { name: 'Даша', breed: 'Dalmatian', description: 'coat: light and short; ears: folded, hanging; muzzle: long, black nose; markings: black spots everywhere; look: cheerful, spotted.' },
  { name: 'Тоша', breed: 'Mongrel', description: 'coat: mixed and shaggy; ears: floppy, one bent; muzzle: medium, black nose; markings: a dark eye patch; look: friendly, scruffy.' },
  { name: 'Лорд', breed: 'Afghan hound', description: 'coat: light and very long, silky; ears: long, feathered, hanging; muzzle: very long and narrow, black nose; markings: dark mask; look: aloof, hair blowing.' },
  { name: 'Ася', breed: 'Papillon', description: 'coat: light and long, fine; ears: huge, fringed, standing out like wings; muzzle: tiny, small black nose; markings: patches on the ears; look: dainty.' },
  { name: 'Бублик', breed: 'Basset hound', description: 'coat: mixed and short; ears: very long, dragging; muzzle: long and droopy, black nose; markings: patches; look: sleepy, sad eyes.' },
  { name: 'Рой', breed: 'Belgian shepherd', description: 'coat: dark and long; ears: pointed, standing up; muzzle: long and narrow, black nose; markings: none; look: intense, ready.' },
  { name: 'Лола', breed: 'Chihuahua', description: 'coat: light and long; ears: huge, pointed, standing out; muzzle: tiny, small black nose; markings: none; look: bug-eyed, indignant.' },
  { name: 'Кекс', breed: 'Corgi', description: 'coat: mixed and short; ears: huge, rounded, standing up; muzzle: medium, black nose; markings: white chest and legs; look: short legs, smiling.' },
  { name: 'Ельза', breed: 'Samoyed', description: 'coat: light and very thick; ears: small, pointed, standing up; muzzle: medium, black nose; markings: none; look: smiling.' },
  { name: 'Бруно', breed: 'Bernese mountain dog', description: 'coat: dark and long; ears: folded, hanging; muzzle: broad, black nose; markings: white blaze and chest, tan eyebrows; look: big, gentle.' },
  { name: 'Зайка', breed: 'Mongrel', description: 'coat: light and short; ears: long, standing up like a rabbit\'s; muzzle: medium and pointed, black nose; markings: a dark spot on the back; look: nervous.' },
  { name: 'Хан', breed: 'Alabai', description: 'coat: light and thick; ears: tiny, folded; muzzle: broad and blunt, black nose; markings: none; look: enormous, unbothered.' },
  { name: 'Кнопка', breed: 'Pekingese', description: 'coat: mixed and long, flowing; ears: hanging, feathered; muzzle: flat, black nose; markings: dark mask; look: haughty, tiny.' },
  { name: 'Атос', breed: 'Great Pyrenees', description: 'coat: light and very thick; ears: folded, hanging; muzzle: broad, black nose; markings: none; look: huge, serene.' },
  { name: 'Люся', breed: 'Cocker spaniel', description: 'coat: dark and long, wavy; ears: very long, feathered, hanging; muzzle: medium, black nose; markings: none; look: soft eyes.' },
  { name: 'Гектор', breed: 'Bullmastiff', description: 'coat: light and short; ears: folded, hanging; muzzle: short and square, dark mask, black nose; markings: dark mask; look: heavy jowls.' },
  { name: 'Мушка', breed: 'Mongrel', description: 'coat: dark and short; ears: one up, one down; muzzle: medium, black nose; markings: white toes; look: tiny, quick.' },
  { name: 'Ральф', breed: 'Bloodhound', description: 'coat: dark and short; ears: very long, wrinkled, hanging; muzzle: long and droopy, black nose; markings: tan legs; look: mournful, wrinkled.' },
  { name: 'Плюшка', breed: 'Bichon frise', description: 'coat: light and curly, a ball; ears: hidden in the fluff; muzzle: short, small black nose; markings: none; look: round, cheerful.' },
  { name: 'Гарік', breed: 'Bull terrier', description: 'coat: light and short; ears: pointed, standing up; muzzle: egg-shaped, long, black nose; markings: a dark eye patch; look: small triangular eyes.' },
  { name: 'Айса', breed: 'Malamute', description: 'coat: mixed and very thick; ears: pointed, standing up; muzzle: broad, black nose; markings: dark cap, white face; look: wolfish, grinning.' },
  { name: 'Мурчик', breed: 'Mongrel', description: 'coat: mixed and wiry; ears: folded, uneven; muzzle: medium with a little beard, black nose; markings: patches; look: mischievous.' },
  { name: 'Дейзі', breed: 'Golden retriever', description: 'coat: light and long, wavy; ears: floppy, hanging; muzzle: long and blunt, black nose; markings: none; look: smiling, tongue out.' },
  { name: 'Вольт', breed: 'Greyhound', description: 'coat: dark and smooth; ears: small, folded back; muzzle: very long and narrow, black nose; markings: white chest; look: lean, leaning forward.' },
  { name: 'Ірма', breed: 'Irish setter', description: 'coat: dark and long, silky; ears: long, feathered, hanging; muzzle: long, black nose; markings: none; look: elegant, red.' },
  { name: 'Чіп', breed: 'Jack Russell terrier', description: 'coat: light and rough; ears: small, folded forward; muzzle: short, black nose; markings: a dark patch over one eye; look: bouncing.' },
  { name: 'Багіра', breed: 'Mongrel', description: 'coat: dark and sleek; ears: pointed, standing up; muzzle: medium and narrow, black nose; markings: none; look: cat-like, quiet.' },
  { name: 'Топ', breed: 'Boston terrier', description: 'coat: dark and short; ears: big, pointed, standing up; muzzle: flat, black nose; markings: white blaze and chest like a tuxedo; look: round eyes.' },
  { name: 'Ксюша', breed: 'Yorkshire terrier', description: 'coat: mixed and long, silky; ears: small, pointed, standing up; muzzle: short, small black nose; markings: tan face; look: hair in a bow.' },
  { name: 'Отто', breed: 'Dachshund', description: 'coat: dark and wiry; ears: long, rounded, hanging; muzzle: very long and narrow with a beard, black nose; markings: none; look: bushy eyebrows, long body.' },
  { name: 'Соня-Малá', breed: 'Chihuahua', description: 'coat: light and short; ears: huge, standing out; muzzle: tiny, small black nose; markings: a dark spot on the head; look: shivering.' },
  { name: 'Фунтик', breed: 'Pug', description: 'coat: light and short; ears: small, folded; muzzle: flat, wrinkled, black nose; markings: dark mask; look: snoring, round.' },
  { name: 'Джина', breed: 'Boxer', description: 'coat: mixed and short; ears: folded, hanging; muzzle: short and square, wide black nose; markings: white chest and paws; look: worried eyebrows.' },
  { name: 'Кім', breed: 'Shiba inu', description: 'coat: light and short; ears: small, pointed, standing up; muzzle: short and fox-like, black nose; markings: white cheeks and chest; look: smug.' },
  { name: 'Бетті', breed: 'English bulldog', description: 'coat: light and short; ears: small, folded; muzzle: flat, wide, wrinkled, black nose; markings: patches; look: underbite, grumpy.' },
  { name: 'Спайк', breed: 'Mongrel', description: 'coat: dark and short; ears: pointed, one torn; muzzle: medium, black nose; markings: a white stripe on the face; look: tough, grinning.' },
  { name: 'Малина', breed: 'Cavalier King Charles spaniel', description: 'coat: mixed and long, silky; ears: long, feathered, hanging; muzzle: short, black nose; markings: patches on the ears; look: soft eyes.' },
  { name: 'Ромео', breed: 'Poodle', description: 'coat: dark and curly; ears: long, curly, hanging; muzzle: long and narrow, black nose; markings: none; look: elegant, pompom tail.' },
  { name: 'Аврора', breed: 'Husky', description: 'coat: mixed and thick; ears: pointed, standing up; muzzle: medium, black nose; markings: dark cap and mask, white face; look: one blue eye.' },
  { name: 'Батон', breed: 'Labrador', description: 'coat: light and short; ears: floppy, hanging; muzzle: broad and blunt, black nose; markings: none; look: chubby, hopeful.' },
  { name: 'Тіна', breed: 'Whippet', description: 'coat: light and smooth; ears: small, folded back; muzzle: very long and narrow, small black nose; markings: patches; look: shivering, elegant.' },
  { name: 'Мажор', breed: 'Akita', description: 'coat: light and thick; ears: small, pointed, standing up; muzzle: broad, black nose; markings: none; look: dignified, curled tail.' },
  { name: 'Пеппі', breed: 'Beagle', description: 'coat: mixed and short; ears: long, floppy, rounded; muzzle: medium, black nose; markings: a dark saddle and white blaze; look: nose up, howling.' },
  { name: 'Норд', breed: 'Newfoundland', description: 'coat: dark and very thick; ears: small, folded, hanging; muzzle: broad, black nose; markings: none; look: enormous, dripping.' },
  { name: 'Ліза', breed: 'Spitz', description: 'coat: light and fluffy; ears: small, pointed, standing up; muzzle: short and pointed, small black nose; markings: none; look: foxy smile.' },
  { name: 'Шерлок', breed: 'Basset hound', description: 'coat: mixed and short; ears: very long, hanging; muzzle: long and droopy, black nose; markings: tan and white patches; look: investigating, nose down.' },
  { name: 'Ґудзик', breed: 'Mongrel', description: 'coat: light and wiry; ears: folded forward; muzzle: short with a beard, black nose; markings: a dark patch on the back; look: small, round eyes.' },
  { name: 'Марта', breed: 'Bernese mountain dog', description: 'coat: dark and long; ears: folded, hanging; muzzle: broad, black nose; markings: white blaze and chest; look: calm, big paws.' },
  { name: 'Фокс', breed: 'Fox terrier', description: 'coat: light and wiry; ears: folded forward; muzzle: long with a beard, black nose; markings: dark patches; look: bristling, alert.' },
  { name: 'Вінні', breed: 'Pomeranian', description: 'coat: light and very fluffy, a round puff; ears: tiny, pointed; muzzle: tiny and pointed, small black nose; markings: none; look: grinning.' },
  { name: 'Ґрей', breed: 'Weimaraner', description: 'coat: light and short, silver; ears: long, hanging; muzzle: long, pale nose; markings: none; look: amber eyes, serious.' },
  { name: 'Клепа', breed: 'Mongrel', description: 'coat: mixed and scruffy; ears: one up, one down; muzzle: medium, black nose; markings: patches everywhere; look: goofy, tongue sideways.' },
  { name: 'Бонд', breed: 'Dalmatian', description: 'coat: light and short; ears: folded, hanging; muzzle: long, black nose; markings: black spots, one over an eye; look: sly.' },
  { name: 'Хлоя', breed: 'Bichon frise', description: 'coat: light and curly, a cloud; ears: hidden in the fluff; muzzle: short, small black nose; markings: none; look: round, blinking.' },
  { name: 'Пірат', breed: 'Mongrel', description: 'coat: dark and short; ears: pointed, one folded; muzzle: medium, black nose; markings: a black patch over one eye; look: one eye squinting.' },
  { name: 'Роксі', breed: 'Rottweiler', description: 'coat: dark and short; ears: folded, hanging; muzzle: broad, black nose; markings: tan eyebrows and paws; look: sturdy, tongue out.' },
  { name: 'Тео', breed: 'Cocker spaniel', description: 'coat: light and long, wavy; ears: very long, feathered, hanging; muzzle: medium, black nose; markings: none; look: floppy, soulful.' },
  { name: 'Юкі', breed: 'Samoyed', description: 'coat: light and very thick; ears: small, pointed, standing up; muzzle: medium, black nose; markings: none; look: smiling, snowy.' },
  { name: 'Бася', breed: 'Dachshund', description: 'coat: light and smooth; ears: long, rounded, hanging; muzzle: very long and narrow, black nose; markings: none; look: long body, hopeful.' },
  { name: 'Зевс', breed: 'German shepherd', description: 'coat: dark and short, tan legs; ears: big, pointed, standing up; muzzle: long, black nose; markings: dark saddle; look: commanding.' },
  { name: 'Кіра', breed: 'Border collie', description: 'coat: mixed and medium; ears: half-pricked; muzzle: medium and pointed, black nose; markings: white blaze, chest and paws; look: staring, crouched.' },
  { name: 'Лєля', breed: 'Toy poodle', description: 'coat: light and curly; ears: long, curly, hanging; muzzle: short and narrow, black nose; markings: none; look: tiny, prancing.' },
  { name: 'Гоша', breed: 'Mongrel', description: 'coat: mixed and shaggy; ears: floppy; muzzle: medium with a moustache, black nose; markings: a white bib; look: cheerful, unkempt.' },
  { name: 'Іскра', breed: 'Australian shepherd', description: 'coat: mixed and medium, merle; ears: half-folded; muzzle: medium, black nose; markings: patches and speckles; look: two-colored eyes.' },
  { name: 'Санта', breed: 'Saint Bernard', description: 'coat: mixed and thick; ears: folded, hanging; muzzle: broad and short, black nose; markings: white blaze, dark mask; look: huge, drooling.' },
  { name: 'Веста', breed: 'Whippet', description: 'coat: dark and smooth; ears: small, folded back; muzzle: very long and narrow, black nose; markings: white chest; look: curled up, shivering.' },
  { name: 'Патрон', breed: 'Jack Russell terrier', description: 'coat: light and short; ears: small, folded forward; muzzle: short, black nose; markings: a dark patch on the head; look: proud, chest out.' },
  { name: 'Шайба', breed: 'Pug', description: 'coat: dark and short; ears: small, folded; muzzle: flat and wrinkled, black nose; markings: none; look: round, panting.' },
  { name: 'Ліра', breed: 'Afghan hound', description: 'coat: light and very long, silky; ears: long, feathered, hanging; muzzle: very long and narrow, black nose; markings: none; look: serene, hair flowing.' },
  { name: 'Тоні', breed: 'French bulldog', description: 'coat: dark and short; ears: huge bat ears, standing up; muzzle: flat, wide black nose; markings: white chest; look: cheeky.' },
  { name: 'Мокко', breed: 'Labrador', description: 'coat: dark and short; ears: floppy, hanging; muzzle: broad and blunt, brown nose; markings: none; look: eager, tongue out.' },
  { name: 'Жулька', breed: 'Mongrel', description: 'coat: mixed and short; ears: one up, one folded; muzzle: medium, black nose; markings: patches on the back; look: yard dog, wary.' },
  { name: 'Райт', breed: 'Airedale terrier', description: 'coat: mixed and wiry; ears: folded forward; muzzle: long with a beard, black nose; markings: dark saddle, tan face; look: bristly, determined.' },
  { name: 'Умка-Мала', breed: 'Spitz', description: 'coat: light and fluffy; ears: small, pointed, standing up; muzzle: short and pointed, small black nose; markings: none; look: tiny, puffed up.' },
  { name: 'Ґабі', breed: 'Golden retriever', description: 'coat: light and long, flowing; ears: floppy, hanging; muzzle: long and blunt, black nose; markings: none; look: patient, soft eyes.' },
  { name: 'Бос', breed: 'Cane corso', description: 'coat: dark and short; ears: small, folded; muzzle: broad and square, black nose; markings: a white spot on the chest; look: stern, heavy.' },
  { name: 'Софі', breed: 'Maltese', description: 'coat: light and long, silky; ears: hanging, hidden in hair; muzzle: short, black nose; markings: none; look: tiny, hair in a bow.' },
  { name: 'Ерік', breed: 'Schnauzer', description: 'coat: light and wiry, salt and pepper; ears: folded forward; muzzle: square with a long beard and bushy eyebrows, black nose; markings: none; look: stern, bearded.' },
  { name: 'Пуся', breed: 'Pekingese', description: 'coat: light and long, flowing; ears: hanging, feathered; muzzle: flat, black nose; markings: none; look: flat-faced, regal.' },
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

