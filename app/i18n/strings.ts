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
};

export const strings: Record<Lang, AppStrings> = { uk, en };
