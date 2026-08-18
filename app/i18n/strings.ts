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
  // The dog's questions during a search, and the answers under them.
  // Every decision point in supersniff is one of these.
  search: {
    confirm: (name: string) => string;
    confirmGo: string;
    confirmBack: string;
    leaveAsk: string;
    arrivedAsk: (name: string) => string;
    yes: string;
    no: string;
    thanksSeen: (paws: number) => string;
    thanksMissed: (paws: number) => string;
    contactAsk: string;
    contactOpen: string;
    contactLater: string;
    close: string;
  };
  bubbles: {
    greeting: string;
    // Varied "leaving supersniff" lines so repeated toggles don't feel canned.
    backToWalks: string[];
    // Varied "entering supersniff" lines for repeat entries. The FIRST entry
    // per session is announced by the intro hint (swipe/tap how-to) instead.
    supersniffOn: string[];
    // Territory: the dog announcing a fresh claim, and the two reasons it
    // won't bother right now.
    marked: string[];
    // A third mark near two others: the dots become a piece of the city.
    enclosed: string[];
    // Marked on ground we already hold — the claim gets harder to take.
    renewed: string[];
    // Marked over someone else's ground: weakened it, or took it outright.
    contested: string[];
    captured: string[];
    tooHungryToMark: string[];
    tooGlumToMark: string[];
    // Standing on ground we already hold, so there is nothing to mark.
    // Without this the dog just silently stops marking once its range
    // closes around where you walk, which reads as broken rather than as
    // "go somewhere new".
    alreadyOursHere: string[];
    // Someone marked over ours while we weren't there. {name} is the
    // raider; the killed variant is for when we actually lost ground.
    raided: string[];
    raidedLost: string[];
    // Stepping onto our own ground — where the paws are thicker and the
    // dog is relaxed. Said on arrival only, never while we're standing
    // in it.
    homeGround: string[];
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
  tasks: {
    dailyTasks: string;
    items: {
      collectTokens: string;
      feedBones: string;
      checkLostPets: string;
      visitSpot: string;
      reportSighting: string;
    };
    lostPetsNearby: string;
    moreCount: (n: number) => string;
    showFewer: string;
    badgeSearching: string;
    badgeUrgent: string;
    pastSearches: string;
    finished: string;
    abandoned: string;
    unknownPet: string;
    territoryBoard: string;
    boardYou: string;
    boardEmpty: string;
    boardSeeAll: string;
  };
  spots: {
    nearbySpots: string;
    nearbyCategory: (category: string) => string;
    emptyAll: string;
    emptyFiltered: (category: string) => string;
    filters: {
      all: string;
      cafe: string;
      eat: string;
      drink: string;
      pet_shop: string;
      vet: string;
    };
  };
  profile: {
    level: (n: number) => string;
    max: string;
    xpProgress: (xp: number, nextXp: number) => string;
    a11yMaxLevel: string;
    a11yXpProgress: (xp: number, nextXp: number) => string;
    stats: {
      walksTogether: string;
      daysPlayed: string;
      distanceWalked: string;
      pawsCollected: string;
      bonesEaten: string;
      points: string;
      helpingPets: string;
      petsSearched: string;
      searchesCompleted: string;
      sightingsReported: string;
      companionStats: string;
      luckyPaw: string;
      // Territory card: how much ground you hold and where that puts you.
      territory: string;
      territoryArea: string;
      territoryRank: string;
      territoryTop: string;
    };
    // Rank shown as "#3"; null rank (outside the board) reads as a dash.
    rankValue: (n: number) => string;
    unranked: string;
    // Area in square kilometres to two decimals, always — one unit down
    // the whole column so two rows compare without arithmetic, and the
    // unit spelled out because the superscript glyph is missing from the
    // app's font and silently turned areas into distances.
    areaValue: (m2: number) => string;
    luckyActive: string;
    luckyInactive: string;
    language: {
      label: string;
      uk: string;
      en: string;
    };
    sceneA11y: (mode: string) => string;
  };
  chat: {
    needLocation: string;
    noNearbySpots: string;
    nothingAtDistance: string;
    couldntPlotRoute: string;
    lostTrackOfSpot: string;
    startingSearch: string;
    showingSpot: string;
    walkingTo: (name: string) => string;
    cantReachWalk: () => string;
    inputPlaceholder: string;
  };
  // Shown by the connection banner when calls stop getting through.
  connection: {
    offline: string;
    slow: string;
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
      // Opens the owner's post inside the app.
      readPost: string;
    };
    // The owner's post, read in-app instead of bouncing out to OLX.
    post: {
      title: string;
      titleNamed: (name: string) => string;
      loading: string;
      // The request failed — "try again", which is NOT the same thing as
      // an ad we never stored.
      failed: string;
      // We have no body for this pet: everything ingested before 17 Aug,
      // which is most of the base for weeks yet. Must read as "it lives
      // over there", never as a broken panel.
      notStored: string;
      // …and the original is behind the same sighting gate the contacts
      // are, so when there is no body AND no link this says what to do
      // instead of leaving an empty sheet.
      originalAfterSighting: string;
      // Why the text has holes in it.
      contactsAfterSighting: string;
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
  // One-shot user-facing hints. Each appears once per device
  // (gated by useHint) and never repeats. Keep them short — they
  // ride in the dog's SpeechBubble or a tiny callout, not a
  // tutorial modal.
  hints: {
    longPressToSniff: string;
    supersniff: string;
    supersniffIntro: string;
    // Way out of supersniff for users who arrived via the modal's
    // "start search" and never touched the logo.
    supersniffExit: string;
    swipeCards: string;
    radialMenu: string;
    spotsToggle: string;
    hudMeters: string;
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
  search: {
    confirm: (name) => `йдемо шукати ${name}?`,
    confirmGo: 'го, шукати →',
    confirmBack: 'ще подивлюсь',
    leaveAsk: 'закінчуємо пошук. бачив когось схожого?',
    arrivedAsk: (name) => `ми на місці! бачив ${name} десь тут?`,
    yes: 'так, бачив',
    no: 'ні, нікого',
    thanksSeen: (paws) => `записав! +${paws} лапок 🐾`,
    thanksMissed: (paws) => `теж важливо — тепер знаємо, що тут порожньо. +${paws} лапок 🐾`,
    contactAsk: 'показати оголошення? там є контакти власника',
    contactOpen: 'відкрити оголошення',
    contactLater: 'пізніше',
    close: 'завершити',
  },
  bubbles: {
    greeting: 'гав! натисни на мене — розкажу, що до чого 🐾',
    backToWalks: [
      'добре, повертаємось гуляти 🐾',
      'ніс відпочине — просто гуляємо 🐕',
      'супернюх вимкнено, йдемо неквапом',
      'окей, звичайна прогулянка 🌳',
      'досить нюхати, розімнемо лапи!',
    ],
    supersniffOn: [
      '*вжух* ніс увімкнено 🐽',
      'супернюх! чую всіх навколо 👃',
      'ніс до землі — працюємо 🐾',
      '*принюхується* хто тут загубився?',
      'нюх на максимум, погнали!',
    ],
    marked: [
      '*позначив* це наше 🐾',
      'записав цей кут на нас',
      '*лапу вгору* моє!',
      'тепер тут пахне нами 🐽',
      'ще шматок нашої вулиці',
      '*мітка* хай знають, хто тут ходить',
    ],
    enclosed: [
      'три мітки — і цей шматок наш! 🐾',
      '*обнюхав кути* тепер це наша земля',
      'ділянка наша — все між мітками 🔵',
    ],
    renewed: [
      '*освіжив* тут наш запах тримається 🐾',
      'оновив мітку — тепер її так просто не зітруть',
      '*ще раз* наше міцніше стало 💪',
      'цей кут ми тримаємо давно 🐽',
    ],
    contested: [
      '*гарчить* тут хтось чужий мітив 😾',
      'перебив чужу мітку 🐾',
      '*фиркає* пахло не нами. вже пахне',
      'посунули сусіда трохи',
    ],
    captured: [
      '*відвоював* цей кут тепер наш! 🔵',
      'чужа мітка стерта — земля наша 🐾',
      '*тріумфально* забрали шматок!',
    ],
    tooHungryToMark: [
      'нічим мітити — я порожній 🦴',
      'спочатку кістку, потім мітки',
      '*бурчить животом* не до міток',
    ],
    tooGlumToMark: [
      'настрою мітити нема… 🐕',
      'щось не хочеться. пограймось?',
      '*зітхає* не той день для міток',
    ],
    alreadyOursHere: [
      'тут уже наше — ходімо далі 🐾',
      '*нюхає* свій же запах. далі!',
      'тут нема чого мітити. на край?',
    ],
    raided: [
      '{name} нюхає нашу територію! 😾',
      '*гарчить* {name} мітив на нашому',
      'чуєш? {name} ходив по нашому 🐽',
    ],
    raidedLost: [
      '{name} забрав наш кут! 😾',
      '*виє* ми втратили шматок — це {name}',
      '{name} стер нашу мітку. йдемо повертати 🐾',
    ],
    homeGround: [
      '*розслабляється* тут усе наше 🏠',
      'ми вдома — тут і лапок більше 🐾',
      '*вдихає* знайомий запах. наша земля',
      'на своєму завжди спокійніше 🐽',
    ],
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
  tasks: {
    dailyTasks: 'щоденні квести',
    items: {
      collectTokens: 'збери 10 лапок',
      feedBones: 'погодуй 3 кістки',
      checkLostPets: 'переглянь 2 загублених',
      visitSpot: 'зайди в якесь місце',
      reportSighting: 'повідом, що бачив пса',
    },
    lostPetsNearby: 'загублені',
    moreCount: (n) => `+ ще ${n}`,
    showFewer: 'показати менше',
    badgeSearching: 'шукаємо',
    badgeUrgent: 'терміново',
    pastSearches: 'минулі пошуки',
    finished: 'завершено',
    abandoned: 'припинено',
    unknownPet: 'невідомий пес',
    territoryBoard: 'хто тримає місто',
    boardYou: 'ти',
    boardEmpty: 'місто ще нічиє — познач перший',
    boardSeeAll: 'показати всіх',
  },
  spots: {
    nearbySpots: 'місця поряд',
    nearbyCategory: (category) => `${category} поряд`,
    emptyAll: 'поки нічого поряд — посунь мапу в нове місце, я понюхаю ще',
    emptyFiltered: (category) => `${category} поряд немає — спробуй інший фільтр`,
    filters: {
      all: 'усі',
      cafe: "кав'ярні",
      eat: 'поїсти',
      drink: 'випити',
      pet_shop: 'зоомагазин',
      vet: 'ветеринари',
    },
  },
  profile: {
    level: (n) => `рівень ${n}`,
    max: 'макс',
    xpProgress: (xp, nextXp) => `${xp} / ${nextXp} досвіду`,
    a11yMaxLevel: 'максимальний рівень',
    a11yXpProgress: (xp, nextXp) => `${xp} з ${nextXp} досвіду до наступного рівня`,
    stats: {
      walksTogether: 'разом гуляли',
      daysPlayed: 'днів разом',
      distanceWalked: 'пройдено',
      pawsCollected: 'лапок назбирано',
      bonesEaten: "кісток з'їдено",
      points: 'балів',
      helpingPets: 'допомагаємо псам',
      petsSearched: 'псів шукали',
      searchesCompleted: 'пошуків завершено',
      sightingsReported: 'повідомлень про знахідки',
      companionStats: 'твій пес',
      luckyPaw: 'лапка на удачу',
      territory: 'наша територія',
      territoryArea: 'площа',
      territoryRank: 'місце',
      territoryTop: 'тримає найбільше',
    },
    rankValue: (n) => `#${n}`,
    unranked: '—',
    // ONE UNIT, ALWAYS, AND NO SUPERSCRIPT.
    //
    // Two decimals of km² even when that reads 0.00. It used to drop into
    // m² below 0.01 km², which is right in isolation and wrong in a
    // column: the board came out as a stack of "0.16" with a "2 856"
    // among them, and two numbers in different units cannot be compared
    // at a glance, which is the entire job of a leaderboard. A row reading
    // 0.00 is not a failure to inform — it says you are on the board and
    // hold almost nothing yet, in the same shape as every row above it.
    //
    // "кв. км" rather than "км²" because the ² was not rendering on
    // device: the app's face has no U+00B2, so it dropped silently and an
    // AREA read as a DISTANCE — "0.16 км" is a number you could walk.
    // Spelled out, it cannot fail on a font.
    areaValue: (m2) => `${(m2 / 1_000_000).toFixed(2)} кв. км`,
    luckyActive: 'активна',
    luckyInactive: 'щастя ≥ 70%',
    language: {
      label: 'мова',
      uk: 'українська',
      en: 'english',
    },
    sceneA11y: (mode) =>
      `сцена: ${mode}. натисни на тло — змінити час; натисни на пса — гавкне.`,
  },
  chat: {
    needLocation: 'потрібна твоя геолокація',
    noNearbySpots: 'поряд поки нічого',
    nothingAtDistance: 'на такій відстані нічого нема',
    couldntPlotRoute: 'не зміг прокласти маршрут',
    lostTrackOfSpot: 'загубив це місце — спробуй ще раз',
    startingSearch: 'починаємо пошук…',
    showingSpot: 'показую місце…',
    walkingTo: (name) => `йдемо до ${name}`,
    // NO INTERPOLATED ERROR. This used to end with `(${err})`, which after
    // the API layer started prefixing status codes meant the dog said
    // things like "(500 /quests/start: {...})" out loud in its speech
    // bubble. The detail belongs in the crash report, not in the mouth of
    // a cartoon dog talking to somebody looking for a lost pet.
    cantReachWalk: () => '*нюх-нюх* — зараз не дістаємось до маршруту, спробуймо ще раз',
    inputPlaceholder: 'скажи що хочеш…',
  },
  connection: {
    offline: 'звʼязку немає — мапа зачекає',
    slow: 'звʼязок повільний…',
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
      readPost: 'читати оголошення',
    },
    post: {
      title: 'оголошення',
      // Name first, separated — «оголошення про {name}» would need the
      // accusative («про Мухтара», «про Лялю») and pet names decline every
      // which way. A separator sidesteps the case entirely.
      titleNamed: (name) => `${name} · оголошення`,
      loading: 'відкриваю…',
      failed: 'не вдалося завантажити. спробуй ще раз.',
      notStored:
        'повного тексту цього оголошення в нас немає — воно з’явилось раніше, ніж ми почали їх зберігати.',
      originalAfterSighting:
        'позначиш, що бачив цю тваринку — відкрию оригінал з контактами власника.',
      contactsAfterSighting:
        'контакти власника зʼявляться тут, щойно ти позначиш, що бачив цю тваринку.',
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
  hints: {
    longPressToSniff: 'затисни карту щоб понюхати 🐾',
    supersniff: 'торкнись мене вгорі ліворуч — це супернюх: так винюхую загублених псів 👀',
    supersniffIntro: 'супернюх увімкнено! гортай — наступний пес, тисни — беру слід 🐾',
    supersniffExit: 'щоб повернутись до прогулянок — тисни лого вгорі ліворуч ↖️',
    swipeCards: 'гортай вбік — там ще',
    radialMenu: 'тут усе наше: знайти пса, погуляти, зайти кудись, привітатись, побалакати 🐾',
    spotsToggle: 'шпилька вгорі — показати чи сховати місця 📍',
    hudMeters: 'вгорі: сонце — мій настрій, кістка — голод, лапки — скільки назбирали 🐾',
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
  search: {
    confirm: (name) => `go looking for ${name}?`,
    confirmGo: "let's go →",
    confirmBack: 'still browsing',
    leaveAsk: 'wrapping up. did you see anyone like them?',
    arrivedAsk: (name) => `we're here! did you see ${name} around?`,
    yes: 'yes, I did',
    no: 'no, nobody',
    thanksSeen: (paws) => `logged it! +${paws} paws 🐾`,
    thanksMissed: (paws) => `still useful — now we know this patch is empty. +${paws} paws 🐾`,
    contactAsk: 'open the original post? the owner left their contact there',
    contactOpen: 'open the post',
    contactLater: 'later',
    close: 'finish',
  },
  bubbles: {
    greeting: "woof! tap me to learn what's what 🐾",
    backToWalks: [
      'okay, back to walks 🐾',
      'nose off duty — just strolling now 🐕',
      'supersniff off, taking it easy',
      'alright, normal walk 🌳',
      'enough sniffing, let\'s stretch our legs!',
    ],
    supersniffOn: [
      '*fwoosh* nose is on 🐽',
      'supersniff! I smell everyone around 👃',
      'nose to the ground — working 🐾',
      '*sniffs* who got lost out here?',
      'sniffer at full power, let\'s go!',
    ],
    marked: [
      '*marked it* this one\'s ours 🐾',
      'put this corner down as ours',
      '*leg up* mine!',
      'smells like us here now 🐽',
      'another piece of our street',
      '*mark* let them know who walks here',
    ],
    enclosed: [
      'three marks — this patch is ours! 🐾',
      '*sniffed the corners* this is our land now',
      'the ground between them is ours 🔵',
    ],
    renewed: [
      '*freshened it up* our scent holds here 🐾',
      'topped up the mark — harder to wipe now',
      '*again* this one\'s solid 💪',
      'we\'ve held this corner a long time 🐽',
    ],
    contested: [
      '*growls* someone else marked here 😾',
      'marked right over theirs 🐾',
      '*snorts* smelled like them. not any more',
      'pushed the neighbour back a bit',
    ],
    captured: [
      '*took it back* this corner\'s ours now! 🔵',
      'their mark\'s gone — the ground is ours 🐾',
      '*triumphant* we grabbed a piece!',
    ],
    tooHungryToMark: [
      'nothing left to mark with — I\'m empty 🦴',
      'bone first, territory after',
      '*stomach rumbles* not in marking shape',
    ],
    tooGlumToMark: [
      'not in the mood to mark… 🐕',
      'don\'t feel like it. play with me?',
      '*sighs* wrong day for marking',
    ],
    alreadyOursHere: [
      'already ours here — let\'s go on 🐾',
      '*sniffs* that\'s my own scent. onward!',
      'nothing to mark here. to the edge?',
    ],
    raided: [
      '{name} is sniffing round our turf! 😾',
      '*growls* {name} marked on ours',
      'smell that? {name} walked our streets 🐽',
    ],
    raidedLost: [
      '{name} took our corner! 😾',
      '*howls* we lost a piece — that\'s {name}',
      '{name} wiped our mark. let\'s go take it back 🐾',
    ],
    homeGround: [
      '*relaxes* this is all ours 🏠',
      'we\'re home — more paws around here 🐾',
      '*breathes in* familiar smell. our ground',
      'always easier on our own turf 🐽',
    ],
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
  tasks: {
    dailyTasks: 'daily tasks',
    items: {
      collectTokens: 'collect 10 tokens',
      feedBones: 'feed 3 bones',
      checkLostPets: 'check 2 lost pets',
      visitSpot: 'visit a spot',
      reportSighting: "report you've seen a pet",
    },
    lostPetsNearby: 'lost pets',
    moreCount: (n) => `+ ${n} more`,
    showFewer: 'show fewer',
    badgeSearching: 'searching',
    badgeUrgent: 'urgent',
    pastSearches: 'past searches',
    finished: 'finished',
    abandoned: 'abandoned',
    unknownPet: 'unknown pet',
    territoryBoard: 'who holds the city',
    boardYou: 'you',
    boardEmpty: 'nobody holds the city yet — go and mark',
    boardSeeAll: 'see all',
  },
  spots: {
    nearbySpots: 'nearby spots',
    nearbyCategory: (category) => `nearby ${category}`,
    emptyAll: "nothing nearby yet — pan the map somewhere new and i'll sniff again",
    emptyFiltered: (category) => `no ${category} nearby — try another filter`,
    filters: {
      all: 'all',
      cafe: 'cafe',
      eat: 'eat',
      drink: 'drink',
      pet_shop: 'pet shop',
      vet: 'vet',
    },
  },
  profile: {
    level: (n) => `level ${n}`,
    max: 'max',
    xpProgress: (xp, nextXp) => `${xp} / ${nextXp} xp`,
    a11yMaxLevel: 'max level',
    a11yXpProgress: (xp, nextXp) => `${xp} of ${nextXp} experience to next level`,
    stats: {
      walksTogether: 'walks together',
      daysPlayed: 'days played',
      distanceWalked: 'distance walked',
      pawsCollected: 'paws collected',
      bonesEaten: 'bones eaten',
      points: 'points',
      helpingPets: 'helping pets',
      petsSearched: 'pets searched',
      searchesCompleted: 'searches completed',
      sightingsReported: 'sightings reported',
      companionStats: 'your pet',
      luckyPaw: 'lucky paw',
      territory: 'our territory',
      territoryArea: 'area held',
      territoryRank: 'rank',
      territoryTop: 'holds the most',
    },
    rankValue: (n) => `#${n}`,
    unranked: '—',
    areaValue: (m2) => `${(m2 / 1_000_000).toFixed(2)} sq km`,
    luckyActive: 'active',
    luckyInactive: 'happiness ≥ 70%',
    language: {
      label: 'language',
      uk: 'українська',
      en: 'english',
    },
    sceneA11y: (mode) =>
      `scene mode: ${mode}. tap background to toggle, tap dog to bark.`,
  },
  chat: {
    needLocation: 'need your location first',
    noNearbySpots: 'no nearby spots yet',
    nothingAtDistance: 'nothing at that distance',
    couldntPlotRoute: "couldn't plot that route",
    lostTrackOfSpot: 'lost track of that spot — try again',
    startingSearch: 'starting search…',
    showingSpot: 'showing spot…',
    walkingTo: (name) => `walking to ${name}`,
    cantReachWalk: () => "*sniff sniff* — can't reach the walk right now, let's try again",
    inputPlaceholder: 'say anything…',
  },
  connection: {
    offline: 'no connection — the map will wait',
    slow: 'connection is slow…',
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
      readPost: 'read the post',
    },
    post: {
      title: 'the post',
      titleNamed: (name) => `${name} · the post`,
      loading: 'opening…',
      failed: "couldn't load that. try again.",
      notStored:
        "we don't have the full text of this one — it was posted before we started keeping them.",
      originalAfterSighting:
        "mark that you've seen this pet and i'll open the original, contact and all.",
      contactsAfterSighting:
        "the owner's contact appears here once you mark that you've seen this pet.",
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
  hints: {
    longPressToSniff: 'hold the map and i\'ll have a sniff 🐾',
    supersniff: 'tap me up in the corner — that\'s supersniff: how i hunt for lost dogs 👀',
    supersniffIntro: 'supersniff on! swipe for the next dog, tap to pick up the trail 🐾',
    supersniffExit: 'to get back to walks — tap the logo top-left ↖️',
    swipeCards: 'swipe sideways — there\'s more',
    radialMenu: 'this is all of us: find a pet, take a walk, drop by a place, say hi, or chat 🐾',
    spotsToggle: 'the pin up top — show or hide places 📍',
    hudMeters: "up top: sun's my mood, bone's hunger, paws are what we've found 🐾",
  },
};

export const strings: Record<Lang, AppStrings> = { uk, en };
