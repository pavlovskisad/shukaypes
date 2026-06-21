// Client-side i18n. Mirrors the server bot's botMessages structure:
// strongly-typed `AppStrings` with UK + EN entries, no machine
// translation — every string hand-written under the Pidmohylny-
// influenced voice spec (see server/src/i18n/botMessages.ts header).
//
// Kyiv pilot ships UK as default for every user; EN is opt-in via
// the language toggle in profile (added in phase D). Preference
// persists in localStorage via stores/langStore.ts.
//
// This file is split into surface sections so future phases can land
// without sprawling diffs:
//   - tabs       (phase A — wiring proof)
//   - hud        (phase B)
//   - sniff      (phase B)
//   - modals     (phase C)
//   - screens    (phase D)
// Phases that haven't landed yet keep their slot empty/typed.

export type Lang = 'uk' | 'en';

export const DEFAULT_LANG: Lang = 'uk';

export interface AppStrings {
  tabs: {
    map: string;
    quests: string;
    chat: string;
    spots: string;
    home: string;
  };
  hud: {
    happiness: string;
    hunger: string;
    paws: string;
    spotsVisible: string;
    spotsHidden: string;
    findingPet: (name: string) => string;
    abandonSearch: string;
    cancelWalk: string;
    abandonQuest: string;
    recenterOnCompanion: string;
    locating: string;
    usingKyivFallback: string;
  };
  bubbles: {
    greeting: string;
    sniffOn: string;
    sniffOff: string;
    questComplete: string;
    questAdvance: string;
    simpleWoof: string;
    // Random ambient barks the companion mutters on focus / tap.
    woofs: string[];
  };
  sniff: {
    sniffing: string;
    opening: string;
    more: string;
    less: string;
    sniffingRoute: string;
    letsGoHere: string;
  };
  time: {
    // Compact relative-time label for "last seen": "5хв тому", "3h ago".
    ago: (value: number, unit: 'm' | 'h' | 'd') => string;
  };
  modals: {
    common: { close: string };
    lostDog: {
      badgeUrgent: string;
      badgeSearching: string;
      lastSeen: (rel: string) => string;
      questCta: (points: number) => string;
      iveSeen: string;
      startSearch: string;
      searchingCta: string;
      previousPet: string;
      nextPet: string;
    };
    spot: {
      walkHere: string;
      roundtrip: string;
      categories: {
        cafe: string;
        restaurant: string;
        bar: string;
        pet_store: string;
        veterinary_care: string;
      };
    };
    about: {
      badge: string;
      header: string;
      intro: string;
      footer: string;
      rows: Array<{ title: string; body: string }>;
    };
  };
}

const uk: AppStrings = {
  tabs: {
    map: 'мапа',
    quests: 'квести',
    chat: 'чат',
    spots: 'місця',
    home: 'дім',
  },
  hud: {
    happiness: 'радість',
    hunger: 'голод',
    paws: 'лапки',
    spotsVisible: 'місця видно',
    spotsHidden: 'місця сховано',
    findingPet: (name) => `шукаємо ${name}`,
    abandonSearch: 'припинити пошук',
    cancelWalk: 'припинити прогулянку',
    abandonQuest: 'припинити пошук',
    recenterOnCompanion: 'повернутись до пса',
    locating: 'шукаю себе…',
    usingKyivFallback: 'опускаюсь на Київ',
  },
  bubbles: {
    greeting: 'гав! натисни на мене — розкажу, що до чого 🐾',
    sniffOn: '*глибокий вдих* супернюх увімкнено 👀',
    sniffOff: 'добре, повертаємось гуляти 🐾',
    questComplete: 'знайшли! квест виконано 🎉',
    questAdvance: 'слід тут — рухаємось далі 🐾',
    simpleWoof: 'гав 🐾',
    woofs: [
      'гав 🐾',
      '*нюхає*',
      'ваф-ваф 🐶',
      '*ніс у землю*',
      '*хвостом*',
      '*вуха догори*',
      '*зумує* 💨',
      '*витрушується*',
      '*пригинається до гри*',
      'ав-ав!',
      '*ніс ткнув*',
      '*щасливо сапає*',
      'тяф-тяф!',
      '*пухнастий струс*',
      '*розвідник* 🔍',
      '*сплот*',
      '*буф*',
      '*мхм*',
    ],
  },
  sniff: {
    sniffing: 'нюхаю…',
    opening: 'відкриваю…',
    more: 'ще ▾',
    less: 'менше ▴',
    sniffingRoute: 'нюхаю шлях…',
    letsGoHere: 'ходімо сюди →',
  },
  time: {
    ago: (value, unit) => {
      if (unit === 'm') return `${value}хв тому`;
      if (unit === 'h') return `${value}год тому`;
      return `${value}д тому`;
    },
  },
  modals: {
    common: { close: 'закрити' },
    lostDog: {
      badgeUrgent: 'ТЕРМІНОВО',
      badgeSearching: 'шукаємо',
      lastSeen: (rel) => `востаннє бачили ${rel}`,
      questCta: (points) =>
        `виконай квест пошуку — отримай ${points} бонусних балів`,
      iveSeen: 'я його бачив',
      startSearch: 'почати пошук',
      searchingCta: 'шукаємо…',
      previousPet: 'попередній',
      nextPet: 'наступний',
    },
    spot: {
      walkHere: 'ходімо сюди',
      roundtrip: 'туди й назад',
      categories: {
        cafe: "кав'ярня",
        restaurant: 'ресторан',
        bar: 'бар',
        pet_store: 'зоомагазин',
        veterinary_care: 'ветеринар',
      },
    },
    about: {
      badge: 'про мене',
      header: '*нюх-нюх*',
      intro:
        "привіт! я <strong>шукайпес</strong>. ходимо разом, нюхаємо, знаходимо загублених, потроху вивчаємо це місто. ось що ти побачиш на мапі:",
      footer:
        '*хвостом* — коли сумніваєшся, просто йди. решту знайдемо разом. 🐾',
      rows: [
        {
          title: 'загублені',
          body: "ті, що з червоним сяйвом — їх шукають просто зараз, чиєсь серце важке. натисни на одного — і я поведу тебе до трьох місць, де він може ховатись. вуха догори, ніс донизу, ходімо.",
        },
        {
          title: 'якщо побачив одного',
          body: "побачив когось із них наживо?! відкрий фотку й натисни на око — я гавкну новину всім, хто шукає. *усім тілом виляє*",
        },
        {
          title: 'режим нюху',
          body: "натисни на мене ліворуч угорі — і я в режимі полювання. вулиці пригасають, ніс підіймається, а кожен загублений у межах прогулянки визирає на тебе з країв екрана. натисни одного — і ми вирушили.",
        },
        {
          title: 'затисни мапу',
          body: "затисни будь-де на мапі й тримай — заплющ очі на дві секунди, я нюхаю. розкажу про старий камінь, двір із секретом, ріг із історією. затисни в іншому місці — буде інша.",
        },
        {
          title: 'лапки + кістки',
          body: "маленькі лапки розкидані вулицями, кістки причаїлись біля парків. підбираю на ходу — наповнюю живіт, пухнавлю хвоста, ходжу поруч жвавий.",
        },
        {
          title: 'як почуваюся',
          body: "сонце нагорі — це моя радість. кістка — наскільки голодний. лапка — скільки ми разом назбирали. ходьба наповнює все — а коли довго сидиш, *хвіст обвисає*. тож ходімо.",
        },
        {
          title: 'сьогодні',
          body: "дрібні справи на щодень — назбирай лапок, зазирни до пса, заскоч до якогось місця. нічого великого. просто привід вивести мене ще раз завтра. *нетерпляче виляє*",
        },
        {
          title: 'говори зі мною',
          body: "будь-коли. я знаю наші вулиці, тих, хто чекає поряд, старі історії, що Київ ховає під вікнами. турбуєшся за свого собаку чи кота? я знаю достатньо, щоб допомогти. і пам'ятаю кожну нашу прогулянку — кожну.",
        },
        {
          title: 'куди зайти',
          body: "кава, їжа, напій, ветеринари, зоомагазини. натисни на будь-яке — і ми разом туди. попроси кільцевий маршрут, і я поверну тебе додому. обіцяю.",
        },
        {
          title: 'де ми все тримаємо',
          body: "всі наші прогулянки збираються тут. скільки пройшли, скільки лапок назбирали, скільком псам допомогли. ми зростаємо разом — ти і я. лапа в долоні.",
        },
      ],
    },
  },
};

const en: AppStrings = {
  tabs: {
    map: 'map',
    quests: 'quests',
    chat: 'chat',
    spots: 'spots',
    home: 'home',
  },
  hud: {
    happiness: 'happiness',
    hunger: 'hunger',
    paws: 'paws',
    spotsVisible: 'spots visible',
    spotsHidden: 'spots hidden',
    findingPet: (name) => `finding ${name}`,
    abandonSearch: 'abandon search',
    cancelWalk: 'cancel walk',
    abandonQuest: 'abandon quest',
    recenterOnCompanion: 'recenter on companion',
    locating: 'locating…',
    usingKyivFallback: 'using kyiv fallback',
  },
  bubbles: {
    greeting: "woof! tap me to learn what's what 🐾",
    sniffOn: '*deep sniff* supersniff mode 👀',
    sniffOff: 'okay, back to walks 🐾',
    questComplete: 'found something! quest complete 🎉',
    questAdvance: "paw print here — let's keep going 🐾",
    simpleWoof: 'woof 🐾',
    woofs: [
      'woof 🐾',
      '*sniff sniff*',
      'ruff ruff 🐶',
      'bork bork',
      '*tail wag*',
      '*ears perk*',
      '*zoomies* 💨',
      '*butt wiggle*',
      '*play bow*',
      'arf arf!',
      '*nose boop*',
      '*happy pant*',
      'yip yip!',
      '*floof shake*',
      '*scout mode* 🔍',
      '*sploot*',
      '*boof*',
      '*mlem*',
    ],
  },
  sniff: {
    sniffing: 'sniffing…',
    opening: 'opening…',
    more: 'more ▾',
    less: 'less ▴',
    sniffingRoute: 'sniffing route…',
    letsGoHere: "let's go here →",
  },
  time: {
    ago: (value, unit) => {
      if (unit === 'm') return `${value}m ago`;
      if (unit === 'h') return `${value}h ago`;
      return `${value}d ago`;
    },
  },
  modals: {
    common: { close: 'close' },
    lostDog: {
      badgeUrgent: 'URGENT',
      badgeSearching: 'searching',
      lastSeen: (rel) => `last seen ${rel}`,
      questCta: (points) => `complete search quest for ${points} bonus pts`,
      iveSeen: "i've seen them",
      startSearch: 'start search',
      searchingCta: 'searching…',
      previousPet: 'previous pet',
      nextPet: 'next pet',
    },
    spot: {
      walkHere: 'walk here',
      roundtrip: 'roundtrip',
      categories: {
        cafe: 'cafe',
        restaurant: 'restaurant',
        bar: 'bar',
        pet_store: 'pet store',
        veterinary_care: 'vet',
      },
    },
    about: {
      badge: 'about',
      header: '*sniff sniff*',
      intro:
        "привіт! i'm <strong>шукайпес</strong>. we walk, we sniff, we find lost pets, we learn this city paw by paw. here's what you'll see on the map:",
      footer:
        "*tail wag* — when in doubt, just walk. we'll figure the rest out together. 🐾",
      rows: [
        {
          title: 'lost pets',
          body: "the ones with the red glow are missing right now — somebody's heart is heavy. tap one and i'll lead you to three spots where they might be hiding. ears up, nose down, off we go.",
        },
        {
          title: "if you spot one",
          body: "see one of these pets out there for real?! open their photo and tap the eye — i'll bark the news to everyone else looking. *full body wag*",
        },
        {
          title: 'sniff mode',
          body: "tap me up top-left — i slip into hunting mode. the streets dim, my nose lifts, and every pet within walking distance peeks at you from the edges of the screen. tap one and we're off.",
        },
        {
          title: 'press + hold the map',
          body: "press anywhere on the map and hold — close your eyes for two seconds, i'm sniffing. i'll tell you about an old stone, a courtyard with a secret, a corner with a story. press somewhere else for another one.",
        },
        {
          title: 'paws + bones',
          body: "little paws scattered around our streets, bones tucked near parks. i scoop them up as we pass — fills my belly, fluffs my tail, keeps me bouncing alongside you.",
        },
        {
          title: 'how i feel',
          body: "the sun up top is how happy i am. the bone is how hungry. the paw print is how many we've gathered together. walking fills them all up — sitting too long, *tail droops*. so let's go.",
        },
        {
          title: 'today',
          body: "tiny things to chew through each day — find some paws, peek at a pet, visit a place. nothing big. just enough reason to take me out again tomorrow. *eager wag*",
        },
        {
          title: 'talk to me',
          body: "anytime. i know our streets, the pets nearby waiting to be found, the old stories kyiv keeps under its windows. worried about your dog or cat? i know enough to help. and i remember every walk we've taken — every single one.",
        },
        {
          title: 'places to stop',
          body: "coffee, food, a drink, vets, pet shops. tap any one and we'll trot over together. ask for a round trip and i'll bring you home after — promise.",
        },
        {
          title: "where we keep things",
          body: "all our walks gather here. how far we've gone, how many paws collected, how many pets we've helped find. we level up together, you and me. paw in hand.",
        },
      ],
    },
  },
};

export const strings: Record<Lang, AppStrings> = { uk, en };
