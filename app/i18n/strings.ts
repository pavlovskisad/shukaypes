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
  // The door (D-69): registration before the map, for everybody.
  auth: {
    // At the gate, before anything else: does the dog know you?
    knowAsk: string;
    knowYes: string;
    knowNo: string;
    // The dog's line over the form.
    registerAsk: string;
    verifyAsk: string;
    loginAsk: string;
    forgotAsk: string;
    resetAsk: string;
    nicknameLabel: string;
    nicknamePlaceholder: string;
    petSection: string;
    speciesDog: string;
    speciesCat: string;
    petNameLabel: string;
    petNamePlaceholder: string;
    breedLabel: string;
    breedPlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    newPasswordLabel: string;
    consent: string;
    registerCta: string;
    haveAccount: string;
    loginCta: string;
    noAccount: string;
    forgotLink: string;
    forgotCta: string;
    forgotSent: string;
    resetCta: string;
    backToLogin: string;
    // Verify screen.
    verifySent: (email: string) => string;
    verifyNotSent: string;
    verifyCheck: string;
    verifyResend: string;
    verifyResent: string;
    verifyFixEmail: string;
    verifyStillNot: string;
    otherAccount: string;
    verified: string;
    linkExpired: string;
    working: string;
    // Profile.
    logout: string;
    // Logging out of an account that never registered loses it: the
    // first tap shows the warning and turns the link into the confirm.
    logoutAnonWarn: string;
    logoutConfirm: string;
    // «done» or a tap outside with unsaved edits: the second one closes.
    unsavedWarn: string;
    // The account sheet on the profile.
    editChip: string;
    editTitle: string;
    saveCta: string;
    saved: string;
    changePasswordLink: string;
    currentPasswordLabel: string;
    done: string;
    // The pet's portrait (D-72): the dog's two lines, the studio's
    // buttons, and the row on the edit sheet.
    // Three askings: a named pet, a pet with no name, and no pet at all —
    // the last is asked for their own photo (the model draws them as an
    // animal), because the portrait is for everybody on the map.
    avatarAsk: (pet: { name: string | null } | null) => string;
    avatarDoneAsk: string;
    avatarPick: string;
    avatarChange: string;
    avatarDraw: string;
    avatarDrawing: string;
    avatarKeep: string;
    avatarRetry: string;
    avatarLater: string;
    avatarNone: string;
    avatarPrivacy: string;
    avatarUnreadable: string;
    avatarSection: string;
    avatarEditDraw: string;
    avatarEditRedraw: string;
    avatarEditRemove: string;
    presenceSection: string;
    presenceVisibleOption: string;
    presenceHiddenOption: string;
    presenceHint: string;
    // Server error codes → sentences.
    errors: Record<string, string> & { generic: string };
  };
  hud: {
    happiness: string;
    hunger: string;
    paws: string;
    spotsVisible: string;
    spotsHidden: string;
    findingPet: (name: string) => string;
    abandonSearch: string;
    // The quest pill's × after one tap: a second tap within a few
    // seconds is what actually abandons the search (UX-7.1).
    abandonSearchArmed: string;
    // The walk pill. Walks have no arrival detection, so this is the
    // only way one ends — and ending a walk you completed is finishing
    // it, not cancelling it (UX-2.15).
    finishWalk: string;
    recenterOnCompanion: string;
    locating: string;
    usingKyivFallback: string;
    // GPS is being jammed (the fix landed outside the city) and the app
    // is standing on the last real position, or on Maidan if there never
    // was one. A status, not a button — nothing to do but wait (D-74).
    gpsHeld: string;
    // The map cannot be drawn here (no WebGL2 — an old iOS or Android
    // browser). Says what to do rather than leaving "locating…" up forever.
    mapUnsupported: string;
    // The map's style never arrived (network), or construction threw.
    mapLoadFailed: string;
    retry: string;
    // No real GPS fix — permission denied, or the browser never answered
    // — so the map is standing on the Kyiv fallback. A status chip in the
    // HUD, with the one thing that fixes it.
    noLocation: string;
    // The logo's accessible name. Names where the NEXT tap goes, not
    // where you are — the button's whole job is the thing it is about
    // to do.
    logoExplore: string;
    logoPlay: string;
    logoBack: string;
    // A meter pill read aloud: its name and how full it is.
    meterA11y: (label: string, pct: number) => string;
    // The pill that folds every opened spot cluster back up.
    restack: string;
  };
  // Distance units, for utils/geo formatDistance. Cyrillic in uk: a
  // Latin "m" in a Ukrainian sentence reads as a typo.
  units: {
    m: string;
    km: string;
  };
  // Words drawn on the map itself, next to the markers.
  map: {
    // Under a collapsed lost-pet cluster, and its accessible name.
    lostPetsCount: (n: number) => string;
    // Accessible names of the two pickups, and of a collapsed cluster
    // of places (a tap fans it out). Were hardcoded English.
    pawA11y: string;
    boneA11y: string;
    placesCount: (n: number) => string;
  };
  // The dog's questions during a search, and the answers under them.
  // Every decision point in supersniff is one of these.
  search: {
    confirm: (name: string) => string;
    confirmGo: string;
    confirmBack: string;
    leaveAsk: string;
    // The way back out of the leave question: the ✕ was brushed, the
    // search goes on.
    keepGoing: string;
    arrivedAsk: (name: string) => string;
    yes: string;
    no: string;
    thanksSeen: (paws: number) => string;
    thanksMissed: (paws: number) => string;
    // The sighting did not reach the server (offline, 5xx). Said
    // plainly, with a retry, rather than a "logged it" the owner never
    // receives.
    sendFailed: string;
    retry: string;
    contactAsk: string;
    contactOpen: string;
    contactLater: string;
    close: string;
    // Supersniff's deck with nothing in it: no pets within walking range,
    // or no connection to fetch them. Stands where the cards would be.
    emptyDeck: string;
    emptyDeckOffline: string;
  };
  bubbles: {
    greeting: string;
    // The dog explaining a jammed GPS on the way in, and the fix coming
    // back on the way out. Once each, not every tick.
    gpsJammed: string;
    gpsBack: string;
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
    // What the dog says back after "I've seen": the pin moved (a
    // trusted report), a plain sighting, no GPS to put it at, or the
    // request failed.
    sightingMoved: (name: string) => string;
    sightingLogged: string;
    sightingNoLocation: string;
    sightingFailed: string;
    // Walk-here / roundtrip from a spot card.
    walkNoLocation: string;
    walkingTo: (name: string) => string;
    roundtripTo: (name: string) => string;
    // Supersniff: the line as the dog takes a pet's trail, and the
    // barks when you are not closing the gap. One pool per language —
    // these used to be one mixed pool, so a uk user got English lines
    // at random.
    searchLead: (name: string) => string[];
    searchNudge: string[];
    searchNudgeNamed: (name: string) => string[];
    simpleWoof: string;
    // Random ambient barks the companion mutters on focus / tap.
    woofs: string[];
  };
  sniff: {
    sniffing: string;
    opening: string;
    more: string;
    less: string;
    // In-voice shrug when a landmark has neither a longer telling nor
    // an article behind "read more".
    nothingMore: string;
    // Label of the link to the Wikipedia article under its lead.
    wikipedia: string;
    // Accessible names of the heart on a landmark's bubble.
    save: string;
    saved: string;
    // Under the heart when the save (or the unsave) did not go through
    // and the heart has flipped back.
    saveFailed: string;
    sniffingRoute: string;
    letsGoHere: string;
    // The card a long-press leaves when there is nothing to tell here,
    // and when the request itself failed — the second is not the first,
    // or an offline walker learns the city is empty.
    nothingTitle: string;
    nothingStory: string;
    failedTitle: string;
    failedStory: string;
  };
  time: {
    // Compact relative-time label for "last seen": "5хв тому", "3h ago".
    ago: (value: number, unit: 'm' | 'h' | 'd') => string;
  };
  tasks: {
    dailyTasks: string;
    // The day's six (D-99). Each takes its own target, because the
    // numbers live in the server's balance file and the label must not
    // be able to disagree with the bar beside it.
    items: {
      searchQuests: (n: number) => string;
      bones: (n: number) => string;
      landmarks: (n: number) => string;
      /** Takes square kilometres, already converted and formatted. */
      landM2: (km2: string) => string;
      maxHappiness: string;
      spotVisits: string;
    };
    /** Paws a task pays, shown on its row. */
    reward: (paws: number) => string;
    /** Points a finished search quest paid, in the history. Not paws:
     *  a quest's reward goes to the points column, so it cannot borrow
     *  the 🐾 of `reward` above. */
    questPoints: (points: number) => string;
    /** The all-six bonus row. */
    bonusLabel: string;
    bonusHint: (paws: number) => string;
    lostPetsNearby: string;
    moreCount: (n: number) => string;
    showFewer: string;
    pastSearches: string;
    finished: string;
    abandoned: string;
    unknownPet: string;
    territoryBoard: string;
    happinessBoard: string;
    happinessHint: string;
    boardYou: string;
    boardEmpty: string;
    boardSeeAll: string;
    // Under the past searches on the lost-pets card; opens all of them.
    historySeeAll: string;
  };
  spots: {
    nearbySpots: string;
    // The spot deck's counter, which opens the whole category.
    seeAll: string;
    nearbyCategory: (category: string) => string;
    emptyAll: string;
    emptyFiltered: (category: string) => string;
    // The hearted landmarks, at the top of the tab.
    favourites: string;
    favouritesEmpty: string;
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
    timeTogether: (seconds: number) => string;
    luckyActive: string;
    luckyInactive: string;
    language: {
      label: string;
      uk: string;
      en: string;
    };
    sceneA11y: (mode: string) => string;
    // The dog in that scene, a button of its own: a tap makes it bark.
    barkA11y: string;
  };
  // The card behind a dog on the map (D-73).
  playerCard: {
    levelUnknown: string;
    bot: string;
    territory: string;
    noTerritory: string;
    poke: string;
    poked: string;
    // The wave did not reach the server — said instead of "waved!".
    pokeFailed: string;
    close: string;
    owner: (nick: string) => string;
  };
  // The toast when another dog waves at yours. The name and the verb
  // are separate so a long name ellipsizes without taking the verb.
  poke: {
    verb: string;
    nearby: string;
    wasNearby: string;
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
    // Same, for a walk that also passes landmarks worth stopping at.
    walkingToVia: (name: string, stops: number) => string;
    cantReachWalk: () => string;
    // The chat call itself failed (offline, 5xx). Not cantReachWalk:
    // most messages have nothing to do with a walk, and blaming the route
    // for a dropped connection sends the user looking in the wrong place.
    cantReachDog: string;
    // A start_quest action the server refused, or that never got there.
    // Said instead of "starting search…", and the map is not opened.
    couldntStartSearch: string;
    // Under the boot failure bubble: runs the history load again.
    retry: string;
    inputPlaceholder: string;
    // Accessible name of the → button.
    send: string;
  };
  // Shown by the connection banner when calls stop getting through.
  connection: {
    offline: string;
    slow: string;
    // A card whose fetch failed, in place of its content. Not the card's
    // empty state: "nothing nearby" said offline is a claim about the
    // city that the app never checked. The whole line is the retry.
    loadFailed: string;
  };
  modals: {
    common: {
      close: string;
      // A card deck, to a keyboard or screen reader (UX-14.6): where in
      // the deck you are and how to move through it.
      deckA11y: (i: number, n: number) => string;
      // The deck's "N / M" counter when it opens the whole list
      // (UX-14.14): what it opens, then the position it shows.
      deckCounterA11y: (label: string, i: number, n: number) => string;
    };
    lostDog: {
      badgeUrgent: string;
      badgeSearching: string;
      lastSeen: (rel: string) => string;
      questCta: (points: number) => string;
      iveSeen: string;
      // "I've seen" asks once before it files anything: the report is
      // a real person's sighting of their pet, at the walker's GPS
      // position, and it can move the pet's public pin.
      seenConfirm: (name: string) => string;
      seenConfirmYes: string;
      seenConfirmNo: string;
      startSearch: string;
      searchingCta: string;
      previousPet: string;
      nextPet: string;
      // Opens the owner's post inside the app.
      readPost: string;
      // Shown when the pin came from a model guess rather than from a
      // place named in the ad or a pin the owner dropped.
      approximate: string;
    };
    // The owner's post, read in-app instead of bouncing out to OLX.
    post: {
      title: string;
      titleNamed: (name: string) => string;
      loading: string;
      // The request failed — the retry button under it asks again, which
      // is NOT the same thing as an ad we never stored.
      failed: string;
      // We have no body for this pet: everything ingested before 17 Aug,
      // which is most of the base for weeks yet. Must read as "it lives
      // over there", never as a broken panel.
      notStored: string;
      // …and the original is behind the same sighting gate the contacts
      // are, so when there is no body AND no link this says what to do
      // instead of leaving an empty sheet.
      originalAfterSighting: string;
      // The way OUT — to the ad on OLX. Named "original" rather than
      // "open the post" because this modal IS the post now; the thing
      // on the other side of this button is the source it came from.
      openOriginal: string;
      contactsMaskedBySource: string;
      // Why the text has holes in it.
      contactsAfterSighting: string;
      // Under a failed load: asks again.
      retry: string;
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
    // The logo is the only control that changes what the whole screen
    // IS, and a brand mark in a corner gives no clue that it does
    // anything — so this one goes first, plainly.
    modes: string;
    longPressToSniff: string;
    supersniffIntro: string;
    // Way out of supersniff for users who arrived via the modal's
    // "start search" and never touched the logo.
    supersniffExit: string;
    // The quests and spots tabs are stacks of full-page cards; the first
    // page gives no sign that more sits under it.
    scrollMore: string;
    radialMenu: string;
    spotsToggle: string;
    hudMeters: string;
  };
  // The dog's front door. It asks once on entry and the answer picks
  // the mode. One word per option — they ride inside a 112px pill on
  // the ring, so anything longer gets clipped rather than wrapped.
  modes: {
    // The question in the dog's bubble while the ring is up.
    ask: string;
    lost: string;
    search: string;
    explore: string;
    play: string;
    // The dog's line over the walking level — three icons that do not
    // explain themselves, named in one breath.
    exploreAsk: string;
    // …and one for every level below it, so the icons are never a
    // guessing game and the whole descent reads as one conversation
    // rather than a menu that stops talking once you commit.
    walkDistanceAsk: string;
    // …and the same question for «meet», which is the same walk to a
    // different kind of place.
    meetDistanceAsk: string;
    // The leaf that draws a different three spots.
    visitRegenerate: string;
    visitCategoryAsk: string;
    // Said at the category level when the picked category has nothing
    // nearby; the ring stays on the categories (UX-2.17).
    visitCategoryEmpty: string;
    visitSpotAsk: string;
    // Said on entering the territory view, because nothing else explains
    // it: the mechanic is deliberately nameless and passive everywhere
    // else in the app (D-17), so this is the one place it gets spelled
    // out. An array so a regular player is not read the same sentence
    // every time.
    playIntro: string[];
    // Shown when the user picks "meet" in explore and there is nobody
    // around. Was hardcoded English in Companion.tsx.
    noWalkers: string;
    // The dog's own accessible name on the map: what a tap on it does.
    dogA11y: string;
    // Accessible names of the icon buttons under the dog.
    ring: {
      walk: string;
      visit: string;
      meet: string;
      close: string;
      far: string;
    };
    // The captions drawn UNDER those buttons. Nouns and short
    // adverbs, not the verbs above: a caption names the thing the disc
    // is, while the accessible name says what pressing it does.
    ringCaption: {
      walk: string;
      visit: string;
      meet: string;
      close: string;
      far: string;
    };
    // What the dog says as a ring leaf fires. Also hardcoded English
    // in Companion.tsx until the i18n sweep.
    noLostPetsYet: string;
    sniffedOut: (name: string) => string;
    meetSniffing: string;
    walkSniffing: (far: boolean) => string;
    walkNothing: string;
    meetTo: (name: string, stops: number) => string;
    walkTo: (far: boolean, name: string, stops: number) => string;
    spotGone: string;
    visitSpot: (name: string, icon: string) => string;
    comingSoon: (label: string) => string;
    // The "I lost a pet" sheet. Points at a DM with our bot, which is
    // the one path that actually puts a pet on the map today.
    lostSheet: {
      title: string;
      speciesDog: string;
      speciesCat: string;
      nameLabel: string;
      namePlaceholder: string;
      descLabel: string;
      descPlaceholder: string;
      phoneLabel: string;
      phonePlaceholder: string;
      // NO EMOJI IN THESE. They label buttons, and a button in this app
      // wears a drawn icon from the set or nothing at all — an OS emoji
      // is the one mark on the sheet nobody here drew, and it renders as
      // a different picture on every platform. There is no camera or dog
      // in components/ui/Icon.tsx, so those labels are plain text; the
      // place button gets the real `pin`.
      photoLabel: string;
      photoChange: string;
      // Takes the attached photo off the report again (UX-5.12).
      photoRemove: string;
      // The pin step: button that enters it, the instruction while the
      // map is being aimed, and the two bar actions.
      pickPin: string;
      pinPicked: string;
      pinHint: string;
      pinConfirm: string;
      pinBack: string;
      submit: string;
      submitting: string;
      doneTitle: string;
      doneBody: string;
      doneNoPhoto: string;
      doneShare: string;
      doneClose: string;
      // Secondary path: the bot DM still works and suits TG natives.
      botLine: string;
      botCta: string;
      // A photo the browser cannot decode — a HEIC straight off an
      // iPhone, or a file that arrived damaged. Without this the pick
      // silently does nothing at all.
      errPhoto: string;
      errShort: string;
      errNoPin: string;
      errLimit: string;
      errGeneric: string;
      close: string;
    };
  };
}

// "зупинка" in the case Ukrainian wants after a number. Slavic plurals
// are three-way and the walk-stop counts here are 1–5, so the general
// rule is written out rather than special-cased: 1, 21, 31 take the
// singular; 2–4 the paucal; everything else (including the 11–14 band,
// which is why the mod-100 test comes first) the genitive plural.
function ukStops(n: number): string {
  return ukPlural(n, 'зупинка', 'зупинки', 'зупинок');
}

// The same three-way rule for any noun: `one` for 1/21/31, `few` for
// 2–4, `many` for the rest.
function ukPlural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const uk: AppStrings = {
  tabs: {
    map: 'мапа',
    quests: 'квести',
    chat: 'чат',
    spots: 'місця',
    home: 'дім',
  },
  auth: {
    knowAsk: 'нюх-нюх! ми знайомі?',
    knowYes: 'так, ти шо не впізнав?',
    knowNo: 'ні, давай познайомимось!',
    registerAsk: 'люблю знайомитись! як тебе звати і чи є в тебе хтось хвостатий?',
    verifyAsk: 'я надіслав листа. знайди його — може, у спамі — і натисни посилання. тоді гуляємо.',
    loginAsk: 'з поверненням. нагадай, хто ти?',
    forgotAsk: 'забув пароль? буває. кажи пошту — надішлю новий.',
    resetAsk: "придумай новий пароль. цього разу запам'ятай.",
    nicknameLabel: 'твій нік',
    nicknamePlaceholder: 'як тебе звати на мапі',
    petSection: 'твій улюбленець (якщо є)',
    speciesDog: 'пес',
    speciesCat: 'кіт',
    petNameLabel: 'як звати',
    petNamePlaceholder: 'Мухтар',
    breedLabel: 'порода',
    breedPlaceholder: 'або дворняга',
    emailLabel: 'пошта',
    emailPlaceholder: 'ти@пошта.com',
    passwordLabel: 'пароль',
    passwordPlaceholder: 'не менше 8 символів',
    newPasswordLabel: 'новий пароль',
    consent:
      'я згоден, що шукайпес зберігає мій нік, пошту та маршрути прогулянок, бо інакше він не працює',
    registerCta: 'зареєструватися',
    haveAccount: 'вже є акаунт?',
    loginCta: 'увійти',
    noAccount: 'ще немає акаунта?',
    forgotLink: 'забув пароль',
    forgotCta: 'надіслати',
    forgotSent: 'якщо така пошта в нас є — лист уже летить. посилання живе годину.',
    resetCta: 'зберегти пароль',
    backToLogin: 'назад до входу',
    verifySent: (email) => `лист пішов на ${email}. посилання живе добу. не бачиш — глянь у спам.`,
    verifyNotSent: 'лист не надіслався. спробуй ще раз за хвилину.',
    verifyCheck: 'я підтвердив',
    verifyResend: 'надіслати ще раз',
    verifyResent: 'надіслав ще раз. перевір спам також.',
    verifyFixEmail: 'не та пошта? виправити',
    verifyStillNot: 'поки що не бачу підтвердження. перевір спам або натисни «надіслати ще раз».',
    otherAccount: 'увійти в інший акаунт',
    verified: 'пошта підтверджена. гуляємо!',
    linkExpired: 'це посилання вже не діє. попроси нове.',
    working: 'секунду…',
    logout: 'вийти з акаунта',
    logoutAnonWarn: 'ти не зареєстрований: після виходу лапки й історія цього акаунта пропадуть назавжди.',
    logoutConfirm: 'все одно вийти',
    unsavedWarn: 'зміни не збережено. натисни «зберегти» або ще раз «готово», щоб їх скинути.',
    editChip: 'змінити',
    editTitle: 'про тебе і твого улюбленця',
    saveCta: 'зберегти',
    saved: 'збережено.',
    changePasswordLink: 'змінити пароль',
    currentPasswordLabel: 'поточний пароль',
    done: 'готово',
    avatarAsk: (pet) =>
      pet?.name
        ? `а покажи мені ${pet.name}! я намалюю портрет для мапи. тільки знай: у нас звірячий всесвіт — якщо на фото людина, перетворю її на звіра, який їй пасує.`
        : pet
          ? 'а покажи мені свого хвостатого! я намалюю портрет для мапи. тільки знай: у нас звірячий всесвіт — якщо на фото людина, перетворю її на звіра, який їй пасує.'
          : 'а покажи мені себе! я намалюю портрет для мапи. у нас звірячий всесвіт — тож на мапі ти будеш звіром, який тобі пасує.',
    avatarDoneAsk: 'ось! схожий? якщо ні — спробуємо ще раз.',
    avatarPick: 'вибрати фото',
    avatarChange: 'інше фото',
    avatarDraw: 'намалювати',
    avatarDrawing: 'малюю… секунд десять',
    avatarKeep: 'супер, лишаємо',
    avatarRetry: 'спробувати ще',
    avatarLater: 'потім',
    avatarNone: 'краще без портрета',
    avatarPrivacy: 'фото нікуди не зберігається — залишається тільки малюнок. людина на фото стане звіром: тут звірячий всесвіт.',
    avatarUnreadable: 'не можу прочитати це фото. спробуй інше (jpg або png).',
    avatarSection: 'портрет улюбленця',
    avatarEditDraw: 'намалювати портрет',
    avatarEditRedraw: 'перемалювати',
    avatarEditRemove: 'прибрати',
    presenceSection: 'видимість на мапі',
    presenceVisibleOption: 'видно іншим',
    presenceHiddenOption: 'приховано',
    presenceHint: 'діє одразу. коли приховано — інші не бачать тебе на мапі, а ти бачиш усіх.',
    errors: {
      generic: 'щось пішло не так. спробуй ще раз.',
      nickname_invalid: 'нік: від 2 до 24 символів, літери й цифри.',
      nickname_taken: 'такий нік уже є на мапі. вибери інший.',
      email_invalid: 'це не схоже на пошту.',
      email_taken: 'ця пошта вже зареєстрована — увійди.',
      password_missing: 'потрібен пароль.',
      password_short: 'пароль закороткий: не менше 8 символів.',
      password_long: 'пароль задовгий.',
      consent_required: 'без згоди не вийде.',
      species_invalid: 'пес чи кіт?',
      pet_name_invalid: "ім'я улюбленця: до 40 символів.",
      breed_invalid: 'порода: до 60 символів.',
      bad_credentials: 'пошта або пароль не підходять.',
      token_invalid: 'посилання пошкоджене.',
      token_expired: 'це посилання вже не діє. попроси нове.',
      resend_cooldown: 'зачекай хвилину перед наступним листом.',
      already_registered: 'цей акаунт уже зареєстровано.',
      sessions_unconfigured: 'вхід тимчасово недоступний.',
      password_wrong: 'поточний пароль не підходить.',
      not_registered: 'спершу зареєструйся.',
      not_verified: 'спершу підтверди пошту.',
      photo_invalid: 'це не схоже на фото (jpg, png або webp, до 5 МБ).',
      avatar_unconfigured: 'малювати поки не вмію — спробуй пізніше.',
      avatar_failed: 'не вийшло намалювати. спробуй інше фото або трохи пізніше.',
      avatar_refused: 'з цим фото не вийде. спробуй інше.',
      avatar_daily_limit: 'на сьогодні досить малювання — завтра ще.',
      avatar_unstored: 'малюнок не зберігся. спробуй ще раз.',
      network: "немає зв'язку. перевір інтернет.",
    },
  },
  hud: {
    happiness: 'радість',
    hunger: 'голод',
    paws: 'лапки',
    spotsVisible: 'місця видно',
    spotsHidden: 'місця сховано',
    findingPet: (name) => `шукаємо ${name}`,
    abandonSearch: 'припинити пошук',
    abandonSearchArmed: 'точно? ще раз',
    finishWalk: 'завершити прогулянку',
    recenterOnCompanion: 'повернутись до пса',
    locating: 'шукаю себе…',
    usingKyivFallback: 'опускаюсь на Київ',
    gpsHeld: 'gps глушать — стоїмо тут',
    mapUnsupported:
      'цей браузер не вміє малювати мапу. онови систему або відкрий шукайпес у свіжому Chrome чи Safari',
    mapLoadFailed: 'мапа не довантажилась. перевір звʼязок',
    retry: 'спробувати ще',
    noLocation: 'не бачу, де ти — увімкни геолокацію',
    logoExplore: 'показати район',
    logoPlay: 'увімкнути супернюх',
    logoBack: 'назад до прогулянок',
    meterA11y: (label, pct) => `${label}: ${pct}%`,
    restack: 'згорнути всі розкриті купки місць',
  },
  units: {
    m: 'м',
    km: 'км',
  },
  map: {
    lostPetsCount: (n) => `${n} ${ukPlural(n, 'загублений', 'загублені', 'загублених')}`,
    pawA11y: 'лапка',
    boneA11y: 'кісточка',
    placesCount: (n) => `${n} ${ukPlural(n, 'місце', 'місця', 'місць')} поруч — розгорнути`,
  },
  search: {
    confirm: (name) => `йдемо шукати ${name}?`,
    confirmGo: 'го, шукати →',
    confirmBack: 'ще подивлюсь',
    leaveAsk: 'закінчуємо пошук. бачив когось схожого?',
    keepGoing: 'шукаємо далі',
    arrivedAsk: (name) => `ми на місці! бачив ${name} десь тут?`,
    yes: 'так, бачив',
    no: 'ні, нікого',
    thanksSeen: (paws) => `записав! +${paws} лапок 🐾`,
    thanksMissed: (paws) => `теж важливо — тепер знаємо, що тут порожньо. +${paws} лапок 🐾`,
    sendFailed: 'не вийшло надіслати — власник поки нічого не отримав',
    retry: 'ще раз',
    contactAsk: 'показати оголошення? там усе, що написав власник',
    contactOpen: 'відкрити оголошення',
    contactLater: 'пізніше',
    close: 'завершити',
    emptyDeck: 'поряд ніхто не загубився. добре 🐾',
    emptyDeckOffline: 'звʼязку немає — не бачу, хто загубився',
  },
  bubbles: {
    greeting: 'гав! натисни на мене — розкажу, що до чого 🐾',
    gpsJammed:
      'gps зараз глушать, тож я не бачу, де ми. постоїмо тут, поки не повернеться — все інше працює 🐾',
    gpsBack: 'о, gps повернувся! йдемо далі 🐕',
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
    // Name after a colon: pet names decline every which way, and
    // «пін Мухтара» would need the genitive of a name we cannot decline.
    sightingMoved: (name) => `дякую — пін перенесено: ${name} 📍`,
    sightingLogged: 'дякую — записав 👀',
    sightingNoLocation: 'не бачу, де ти — увімкни геолокацію 📍',
    sightingFailed: 'не вийшло надіслати — спробуй ще раз',
    walkNoLocation: 'не знаю, де ми — так не погуляємо',
    walkingTo: (name) => `йдемо: ${name} 🚶`,
    roundtripTo: (name) => `туди й назад: ${name} 🚶`,
    searchLead: (name) => [
      `беремо слід ${name}! ходімо 🐾`,
      `шукаємо ${name} — за мною!`,
      `${name} десь тут… чую запах 🐽`,
      `на пошук ${name}, тримайся поруч!`,
    ],
    searchNudge: [
      'сюди! 🐾',
      'ходімо, ніс не бреше!',
      'давай, за мною!',
      'нюхом чую, туди!',
      'майже там, не відставай! 🐕',
      'слід свіжий, швидше!',
      'туди-туди, ще трохи!',
      'не зупиняйся, я веду!',
      'ще пару кроків, ходімо 🐽',
    ],
    searchNudgeNamed: (name) => [
      `${name} десь поруч — за мною! 🐾`,
      `нюхаю ${name}, сюди!`,
      `не губи слід ${name}!`,
      `${name} чекає — ходімо!`,
    ],
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
    more: 'ще',
    less: 'менше',
    nothingMore: '*чухає за вухом* більше не пригадую — тільки те, що сказав.',
    wikipedia: 'вікіпедія ↗',
    save: 'зберегти місце',
    saved: 'збережено — натисни, щоб прибрати',
    saveFailed: 'не вийшло — спробуй ще',
    sniffingRoute: 'нюхаю шлях…',
    letsGoHere: 'ходімо сюди →',
    nothingTitle: 'тут поки тиша',
    nothingStory: '*ніс у землю* нічого знайомого. далі від цього кутка є щось — спробуй там.',
    failedTitle: 'нюх збився',
    failedStory: '*чхає* не вийшло понюхати — звʼязок підвів. затисни ще раз.',
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
      searchQuests: (n) => `заверши ${n} пошук`,
      bones: (n) => `з'їж ${n} кістки`,
      landmarks: (n) => `обнюхай ${n} місця`,
      // «кв. км», not «км²» — the superscript does not render in
      // this font, which the standing's areaValue already found out.
      landM2: (km2) => `познач ${km2} кв. км`,
      maxHappiness: 'щастя на максимум',
      // «ти», like the other five — the dog does not switch to the
      // formal plural for one line.
      spotVisits: 'проклади маршрут і дійди',
    },
    reward: (paws) => `+${paws} 🐾`,
    questPoints: (points) => `+${points} ${ukPlural(points, 'бал', 'бали', 'балів')}`,
    bonusLabel: 'усе за день',
    bonusHint: (paws) => `+${paws} 🐾 за всі шість`,
    lostPetsNearby: 'загублені',
    moreCount: (n) => `+ ще ${n}`,
    showFewer: 'показати менше',
    pastSearches: 'минулі пошуки',
    finished: 'завершено',
    abandoned: 'припинено',
    unknownPet: 'невідомий пес',
    territoryBoard: 'хто тримає цей район',
    happinessBoard: 'індекс щастя',
    happinessHint:
      'і хто тут в нас найщасливіший?! індекс рахує, чий пес був на високих відмітках показника щастя найдовше: добре їж, більше збирай, більше шукай, більше гуляй — і все буде добре!',
    boardYou: 'ти',
    boardEmpty: 'місто ще нічиє — познач перший',
    boardSeeAll: 'показати всіх',
    historySeeAll: 'показати всі',
  },
  spots: {
    nearbySpots: 'місця поряд',
    seeAll: 'показати всі',
    nearbyCategory: (category) => `${category} поряд`,
    emptyAll: 'поки нічого поряд — посунь мапу в нове місце, я понюхаю ще',
    emptyFiltered: (category) => `${category} поряд немає — спробуй інший фільтр`,
    favourites: 'улюблені місця',
    favouritesEmpty:
      'поки порожньо. натисни сердечко на місці, яке я винюхав, — і воно чекатиме тут.',
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
    // Minutes under an hour, hours after — «0 год разом» reads as nothing.
    timeTogether: (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} хв разом` : `${Math.floor(s / 3600)} год разом`),
    luckyActive: 'активна',
    luckyInactive: 'щастя ≥ 70%',
    language: {
      label: 'мова',
      uk: 'українська',
      en: 'english',
    },
    sceneA11y: (mode) => `сцена: ${mode}`,
    barkA11y: 'пес — гавкнути',
  },
  playerCard: {
    levelUnknown: 'рівень невідомий',
    bot: 'сусідський пес',
    territory: 'територія',
    noTerritory: 'ще без території',
    poke: 'помахати 👋',
    poked: 'помахали!',
    pokeFailed: 'не вийшло помахати',
    close: 'закрити',
    owner: (nick) => `господар ${nick}`,
  },
  poke: {
    verb: 'махає тобі! 👋',
    nearby: '🐾 поруч — натисни, щоб знайти',
    wasNearby: '🐾 гуляли поруч',
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
    walkingToVia: (name, stops) =>
      `йдемо до ${name} — ${stops} ${ukStops(stops)} по дорозі`,
    // NO INTERPOLATED ERROR. This used to end with `(${err})`, which after
    // the API layer started prefixing status codes meant the dog said
    // things like "(500 /quests/start: {...})" out loud in its speech
    // bubble. The detail belongs in the crash report, not in the mouth of
    // a cartoon dog talking to somebody looking for a lost pet.
    cantReachWalk: () => '*нюх-нюх* — зараз не дістаємось до маршруту, спробуймо ще раз',
    cantReachDog: '*нюх-нюх* — не чую тебе, звʼязок загубився. спробуй ще раз',
    couldntStartSearch: 'не вийшло почати пошук — спробуй ще раз',
    retry: 'ще раз',
    inputPlaceholder: 'скажи що хочеш…',
    send: 'надіслати',
  },
  connection: {
    offline: 'звʼязку немає — наздоженемо, щойно зʼявиться',
    slow: 'звʼязок повільний…',
    loadFailed: 'не вдалося завантажити — натисни, щоб спробувати ще',
  },
  modals: {
    common: {
      close: 'закрити',
      deckA11y: (i, n) => `картки, ${i} з ${n}. стрілки вліво і вправо гортають`,
      deckCounterA11y: (label, i, n) => `${label} (${i} з ${n})`,
    },
    lostDog: {
      badgeUrgent: 'терміново',
      badgeSearching: 'шукаємо',
      lastSeen: (rel) => `востаннє бачили ${rel}`,
      questCta: (points) =>
        `виконай квест пошуку — отримай ${points} бонусних балів`,
      iveSeen: 'я його бачив',
      seenConfirm: (name) => `бачив ${name} тут, щойно?`,
      seenConfirmYes: 'так, щойно',
      seenConfirmNo: 'ні',
      startSearch: 'почати пошук',
      searchingCta: 'шукаємо…',
      previousPet: 'попередній',
      nextPet: 'наступний',
      readPost: 'читати оголошення',
      approximate: 'місце приблизне — дивись оголошення',
    },
    post: {
      title: 'оголошення',
      // Name first, separated — «оголошення про {name}» would need the
      // accusative («про Мухтара», «про Лялю») and pet names decline every
      // which way. A separator sidesteps the case entirely.
      titleNamed: (name) => `${name} · оголошення`,
      loading: 'відкриваю…',
      failed: 'не вдалося завантажити.',
      notStored:
        'повного тексту цього оголошення в нас немає — воно з’явилось раніше, ніж ми почали їх зберігати.',
      originalAfterSighting:
        'позначиш, що бачив цю тваринку — відкрию оригінал оголошення.',
      openOriginal: 'оригінал',
      contactsAfterSighting:
        'позначиш, що бачив цю тваринку — покажу оголошення повністю і відкрию оригінал.',
      contactsMaskedBySource:
        'номер сховала сама olx — вона показує його лише після натискання. відкрий оригінал і тисни «показати телефон».',
      retry: 'спробувати ще',
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
        "привіт! я <strong>шукайпес</strong>. ходимо разом, нюхаємо, знаходимо загублених, потроху вивчаємо це місто. ось як це в нас влаштовано:",
      footer:
        '*хвостом* — коли сумніваєшся, просто йди. решту знайдемо разом. 🐾',
      rows: [
        {
          title: 'шо ти?',
          body: "я питаю це щоразу, коли ти заходиш. чотири відповіді: загубив друга, я шукайпес, хочу погуляти, хто тримає цей район. натисни на мене будь-коли — і ми знову тут, звідки все починається.",
        },
        {
          title: 'загубив друга',
          body: "найважче. розкажи мені: фото, імʼя, який на вигляд, і вкажи на мапі, де востаннє бачили. пін стане відразу — його побачить кожен, хто зараз гуляє поруч. оголошення я ще перешлю в наш канал і в районні групи. *ніс до землі*",
        },
        {
          title: 'я шукайпес',
          body: "вулиці пригасають, ніс підіймається — і всі загублені поблизу лягають переді мною колодою карток. гортай — наступний. натисни — і ми на сліді, я веду тебе просто до нього. натисни на фото ще раз — відкрию оголошення власника.",
        },
        {
          title: 'якщо побачив',
          body: "побачив когось із них наживо?! відкрий картку й натисни «я його бачив» — я гавкну новину всім, хто шукає. і «нікого не бачив» теж важливо: тепер знаємо, що тут порожньо. *усім тілом виляє*",
        },
        {
          title: 'хочу погуляти',
          body: "туди й назад чи в один бік, тут поруч чи заберемось далі — проведу. по дорозі щось розкажу, десь зупинимось. попроси кільцевий — і я поверну тебе додому. обіцяю.",
        },
        {
          title: 'куди зайти',
          body: "кава, їжа, напій, ветеринари, зоомагазини — шпилька вгорі показує їх і ховає. натисни на будь-яке, і ми разом туди.",
        },
        {
          title: 'хто тримає цей район',
          body: "поки ми йдемо, я мічу землю за нами — сам, завжди, навіть коли ти цього не бачиш. кольори — чиїсь райони; пройдемо чужим, і я перемічу його на нас. хто скільки тримає — видно в «сьогодні».",
        },
        {
          title: 'затисни мапу',
          body: "затисни будь-де на мапі й тримай — заплющ очі на пару секунд, я нюхаю. розкажу про старий камінь, двір із секретом, ріг із історією. затисни в іншому місці — буде інша.",
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
          body: "дрібні справи на щодень — назбирай лапок, зазирни до пса, заскоч до якогось місця. там же й загублені поблизу, і хто скільки тримає землі. нічого великого. просто привід вивести мене ще раз завтра. *нетерпляче виляє*",
        },
        {
          title: 'говори зі мною',
          body: "будь-коли. я знаю наші вулиці, тих, хто чекає поряд, старі історії, що Київ ховає під вікнами. турбуєшся за свого собаку чи кота? я знаю достатньо, щоб допомогти. і пам'ятаю кожну нашу прогулянку — кожну.",
        },
        {
          title: 'де ми все тримаємо',
          body: "всі наші прогулянки збираються тут. скільки пройшли, скільки лапок назбирали, скільком псам допомогли, скільки землі тримаємо. ми зростаємо разом — ти і я. лапа в долоні.",
        },
      ],
    },
  },
  hints: {
    modes: 'тисни лого вгорі ліворуч — воно перемикає режими 🔄',
    longPressToSniff: 'затисни карту щоб понюхати 🐾',
    supersniffIntro: 'супернюх увімкнено! гортай — наступний пес, тисни — беру слід 🐾',
    supersniffExit: 'щоб повернутись до прогулянок — тисни лого вгорі ліворуч ↖️',
    scrollMore: 'гортай вниз — там ще',
    radialMenu: 'тут усе наше: знайти пса, погуляти, зайти кудись, привітатись, побалакати 🐾',
    spotsToggle: 'шпилька вгорі — показати чи сховати місця 📍',
    hudMeters: 'вгорі: сонце — мій настрій, кістка — голод, лапки — скільки назбирали 🐾',
  },
  modes: {
    ask: 'нюх-нюх! шо ти?',
    lost: 'загубив друга\u00a0:\u2060(',
    search: 'я шукайпес!',
    explore: 'хочу погуляти',
    play: 'хто тримає цей район?',
    // Shown while the walking verbs are on the ring — three icons that
    // do not explain themselves, so the dog names them.
    exploreAsk: 'просто пройтись, заскочити по каву чи в зоомагазин, чи з кимось познайомитись?',
    walkDistanceAsk: 'тут поруч чи заберемось далі?',
    meetDistanceAsk: 'пошукати поруч чи далі?',
    visitRegenerate: 'інші',
    visitCategoryAsk: 'кава, поїсти, бар, зоомагазин чи ветеринар?',
    visitCategoryEmpty: 'такого поруч немає — обери інше',
    visitSpotAsk: 'ось що поруч — куди йдемо?',
    playIntro: [
      'ось наша земля. я мічу її сам, поки ми йдемо — просто гуляй, і її більшатиме 🐾',
      'кольори — це чиїсь райони. пройдемо чужим, і я перемічу його на нас',
      'що більше тримаємо, то густіші тут лапки. і мені спокійніше на своєму',
    ],
    noWalkers: 'поки нікого поруч 👥',
    dogA11y: 'пес — поговорити',
    ring: {
      walk: 'погуляти',
      visit: 'зайти кудись',
      meet: 'познайомитись',
      close: 'поруч',
      far: 'далі',
    },
    ringCaption: {
      walk: 'прогулянка',
      visit: 'місця',
      meet: 'зустрічі',
      close: 'поряд',
      far: 'подалі',
    },
    noLostPetsYet: 'поряд поки ніхто не загубився',
    sniffedOut: (name) => `винюхав: ${name} 🔍`,
    meetSniffing: 'нюхаю, де гуляють пси 🐕',
    walkSniffing: (far) => `${far ? 'довга' : 'коротка'} прогулянка, нюхаю шлях 🚶`,
    walkNothing: 'на такій відстані нема куди йти — спробуй іншу',
    meetTo: (name, stops) =>
      stops
        ? `${name} — там гуляють пси. ${stops} ${ukStops(stops)} по дорозі 🐾`
        : `${name} — там гуляють пси 🐕`,
    walkTo: (far, name, stops) =>
      stops
        ? `${far ? 'довга' : 'коротка'} прогулянка: ${name} — ${stops} ${ukStops(stops)} по дорозі 🐾`
        : `${far ? 'довга' : 'коротка'} прогулянка: ${name} 🚶`,
    spotGone: 'не знаходжу це місце — його вже нема',
    visitSpot: (name, icon) => `зазирнемо: ${name} ${icon}`,
    comingSoon: (label) => `${label} — скоро буде 🐾`,
    lostSheet: {
      title: 'загубився друг?',
      speciesDog: 'пес',
      speciesCat: 'кіт',
      nameLabel: 'імʼя',
      namePlaceholder: 'як звати',
      descLabel: 'опис',
      descPlaceholder: 'який на вигляд, де і коли загубився, як реагує на людей…',
      phoneLabel: 'телефон',
      phonePlaceholder: 'для тих, хто побачить',
      photoLabel: 'додати фото',
      photoChange: 'інше фото',
      photoRemove: 'прибрати фото',
      pickPin: 'вказати місце',
      pinPicked: 'місце вибрано',
      pinHint: 'наведи центр мапи на місце, де востаннє бачили',
      pinConfirm: 'тут',
      pinBack: 'назад',
      submit: 'поставити на мапу',
      submitting: 'ставлю на мапу…',
      doneTitle: 'вже на мапі 🐾',
      doneBody: 'кожен, хто зараз гуляє поруч, побачить пін. я також переслав оголошення в наш канал і районні групи.',
      doneNoPhoto: 'фото не вдалося прикріпити — оголошення на мапі без нього.',
      doneShare: 'переслати',
      doneClose: 'готово',
      botLine: 'зручніше в телеграмі? напиши боту — фото, район, коли бачили.',
      botCta: 'написати боту',
      errPhoto: 'не вдалося прочитати це фото — спробуй інше',
      errShort: 'опиши трохи докладніше — хоча б кілька слів.',
      errNoPin: 'спершу вкажи місце на мапі.',
      errLimit: 'на сьогодні ліміт оголошень вичерпано.',
      errGeneric: 'не вдалося поставити на мапу. спробуй ще раз.',
      close: 'потім',
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
  auth: {
    knowAsk: 'sniff sniff! do we know each other?',
    knowYes: 'yes, don\'t you recognise me?',
    knowNo: 'no, let\'s get acquainted!',
    registerAsk: 'i love meeting people! what is your name, and is there somebody with a tail?',
    verifyAsk: 'i sent a letter. find it — check spam too — and tap the link. then we walk.',
    loginAsk: 'welcome back. remind me who you are?',
    forgotAsk: 'forgot the password? happens. tell me the e-mail — i will send a new one.',
    resetAsk: 'pick a new password. remember it this time.',
    nicknameLabel: 'your nickname',
    nicknamePlaceholder: 'what to call you on the map',
    petSection: 'your pet (if any)',
    speciesDog: 'dog',
    speciesCat: 'cat',
    petNameLabel: 'name',
    petNamePlaceholder: 'Mukhtar',
    breedLabel: 'breed',
    breedPlaceholder: 'or a mutt',
    emailLabel: 'e-mail',
    emailPlaceholder: 'you@mail.com',
    passwordLabel: 'password',
    passwordPlaceholder: 'at least 8 characters',
    newPasswordLabel: 'new password',
    consent:
      'i agree that шукайпес keeps my nickname, e-mail and walking routes, because it does not work otherwise',
    registerCta: 'sign up',
    haveAccount: 'already have an account?',
    loginCta: 'log in',
    noAccount: 'no account yet?',
    forgotLink: 'forgot password',
    forgotCta: 'send',
    forgotSent: 'if we know that e-mail, the letter is on its way. the link lives for an hour.',
    resetCta: 'save password',
    backToLogin: 'back to login',
    verifySent: (email) => `the letter went to ${email}. the link lives for a day. not there? check spam.`,
    verifyNotSent: 'the letter did not send. try again in a minute.',
    verifyCheck: 'i confirmed it',
    verifyResend: 'send again',
    verifyResent: 'sent again. check spam too.',
    verifyFixEmail: 'wrong e-mail? fix it',
    verifyStillNot: 'no confirmation yet. check spam, or tap "send again".',
    otherAccount: 'log into another account',
    verified: 'e-mail confirmed. let us walk!',
    linkExpired: 'this link no longer works. ask for a new one.',
    working: 'one second…',
    logout: 'log out',
    logoutAnonWarn: 'you are not registered: after logging out, this account\'s paws and history are gone for good.',
    logoutConfirm: 'log out anyway',
    unsavedWarn: 'changes not saved. tap "save", or "done" again to drop them.',
    editChip: 'edit',
    editTitle: 'about you and your pet',
    saveCta: 'save',
    saved: 'saved.',
    changePasswordLink: 'change password',
    currentPasswordLabel: 'current password',
    done: 'done',
    avatarAsk: (pet) =>
      pet?.name
        ? `now show me ${pet.name}! i will draw a portrait for the map. fair warning: this is an animal world — a human in the photo gets turned into the animal that suits them.`
        : pet
          ? 'now show me your tailed one! i will draw a portrait for the map. fair warning: this is an animal world — a human in the photo gets turned into the animal that suits them.'
          : "now show me you! i will draw a portrait for the map. this is an animal world — so on the map you'll be the animal that suits you.",
    avatarDoneAsk: 'there! a likeness? if not, we try again.',
    avatarPick: 'pick a photo',
    avatarChange: 'another photo',
    avatarDraw: 'draw',
    avatarDrawing: 'drawing… ten seconds or so',
    avatarKeep: 'great, keep it',
    avatarRetry: 'try again',
    avatarLater: 'later',
    avatarNone: 'better without a portrait',
    avatarPrivacy: 'the photo is not stored anywhere — only the drawing stays. a human in the photo becomes an animal: this is an animal world.',
    avatarUnreadable: 'i cannot read that photo. try another (jpg or png).',
    avatarSection: 'pet portrait',
    avatarEditDraw: 'draw a portrait',
    avatarEditRedraw: 'redraw',
    avatarEditRemove: 'remove',
    presenceSection: 'visibility on the map',
    presenceVisibleOption: 'visible to others',
    presenceHiddenOption: 'hidden',
    presenceHint: 'applies right away. when hidden, others can\'t see you on the map — you still see everyone.',
    errors: {
      generic: 'something went wrong. try again.',
      nickname_invalid: 'nickname: 2 to 24 characters, letters and digits.',
      nickname_taken: 'that nickname is already on the map. pick another.',
      email_invalid: 'that does not look like an e-mail.',
      email_taken: 'that e-mail is already registered — log in.',
      password_missing: 'a password is needed.',
      password_short: 'password too short: at least 8 characters.',
      password_long: 'password too long.',
      consent_required: 'it does not work without consent.',
      species_invalid: 'dog or cat?',
      pet_name_invalid: 'pet name: up to 40 characters.',
      breed_invalid: 'breed: up to 60 characters.',
      bad_credentials: 'e-mail or password do not match.',
      token_invalid: 'the link is damaged.',
      token_expired: 'this link no longer works. ask for a new one.',
      resend_cooldown: 'wait a minute before the next letter.',
      already_registered: 'this account is already registered.',
      sessions_unconfigured: 'login is temporarily unavailable.',
      password_wrong: 'the current password does not match.',
      not_registered: 'register first.',
      not_verified: 'confirm your e-mail first.',
      photo_invalid: 'that does not look like a photo (jpg, png or webp, up to 5 MB).',
      avatar_unconfigured: 'i cannot draw yet — try later.',
      avatar_failed: 'the drawing did not work. try another photo, or a little later.',
      avatar_refused: 'that photo will not do. try another.',
      avatar_daily_limit: 'enough drawing for today — more tomorrow.',
      avatar_unstored: 'the drawing was not saved. try again.',
      network: 'no connection. check the internet.',
    },
  },
  hud: {
    happiness: 'happiness',
    hunger: 'hunger',
    paws: 'paws',
    spotsVisible: 'spots visible',
    spotsHidden: 'spots hidden',
    findingPet: (name) => `finding ${name}`,
    abandonSearch: 'abandon search',
    abandonSearchArmed: 'sure? tap again',
    finishWalk: 'finish walk',
    recenterOnCompanion: 'recenter on companion',
    locating: 'locating…',
    usingKyivFallback: 'using kyiv fallback',
    gpsHeld: 'gps jammed — standing here',
    mapUnsupported:
      'this browser cannot draw the map. update your system, or open шукайпес in a recent Chrome or Safari',
    mapLoadFailed: 'the map did not load. check your connection',
    retry: 'try again',
    noLocation: "can't see where you are — turn on location",
    logoExplore: 'show the district',
    logoPlay: 'turn supersniff on',
    logoBack: 'back to walking',
    meterA11y: (label, pct) => `${label} ${pct} percent`,
    restack: 'restack all expanded spot clusters',
  },
  units: {
    m: 'm',
    km: 'km',
  },
  map: {
    lostPetsCount: (n) => `${n} lost ${n === 1 ? 'pet' : 'pets'}`,
    pawA11y: 'paw',
    boneA11y: 'bone',
    placesCount: (n) => `${n} ${n === 1 ? 'place' : 'places'} nearby — expand`,
  },
  search: {
    confirm: (name) => `go looking for ${name}?`,
    confirmGo: "let's go →",
    confirmBack: 'still browsing',
    leaveAsk: 'wrapping up. did you see anyone like them?',
    keepGoing: 'keep searching',
    arrivedAsk: (name) => `we're here! did you see ${name} around?`,
    yes: 'yes, I did',
    no: 'no, nobody',
    thanksSeen: (paws) => `logged it! +${paws} paws 🐾`,
    thanksMissed: (paws) => `still useful — now we know this patch is empty. +${paws} paws 🐾`,
    sendFailed: "couldn't send it — the owner hasn't got anything yet",
    retry: 'try again',
    contactAsk: "show the post? everything the owner wrote is in it",
    contactOpen: 'open the post',
    contactLater: 'later',
    close: 'finish',
    emptyDeck: 'nobody lost nearby. good 🐾',
    emptyDeckOffline: "no connection — can't see who's lost",
  },
  bubbles: {
    greeting: "woof! tap me to learn what's what 🐾",
    gpsJammed:
      "gps is being jammed right now, so I can't tell where we are. we'll stand here until it comes back — everything else works 🐾",
    gpsBack: 'oh, gps is back! onwards 🐕',
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
    sightingMoved: (name) => `thanks — moved ${name}'s pin 📍`,
    sightingLogged: 'thanks — sighting logged 👀',
    sightingNoLocation: "i can't see where you are — turn location on 📍",
    sightingFailed: "couldn't report that one — try again",
    walkNoLocation: "can't walk without knowing where we are",
    walkingTo: (name) => `walking to ${name} 🚶`,
    roundtripTo: (name) => `roundtrip to ${name} 🚶`,
    searchLead: (name) => [
      `on the trail of ${name} — this way! 🐾`,
      `looking for ${name} — follow me!`,
      `${name} is around here… i can smell it 🐽`,
      `off to find ${name}, stay close!`,
    ],
    searchNudge: [
      'this way! 🐾',
      'come on, the nose never lies!',
      'this way — I caught a scent!',
      'keep up — the trail is warm! 🐾',
      'almost there — stay with me!',
      'the trail is fresh, faster!',
      "don't stop, i'm leading!",
      'a few more steps, come on 🐽',
    ],
    searchNudgeNamed: (name) => [
      `${name} is close — follow me! 🐾`,
      `i can smell ${name}, this way!`,
      `closing in on ${name} — this way!`,
      `${name} is waiting — let's go!`,
    ],
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
    more: 'more',
    less: 'less',
    nothingMore: "*scratches behind the ear* that's all I remember — just what I said.",
    wikipedia: 'wikipedia ↗',
    save: 'save this place',
    saved: 'saved — tap to remove',
    saveFailed: "didn't go through — try again",
    sniffingRoute: 'sniffing route…',
    letsGoHere: "let's go here →",
    nothingTitle: 'quiet here for now',
    nothingStory: "*nose to the ground* nothing i know. there's something further from this corner — try there.",
    failedTitle: 'lost the scent',
    failedStory: "*sneezes* couldn't sniff that — the connection let us down. press and hold again.",
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
      searchQuests: (n) => `finish ${n} search quest`,
      bones: (n) => `eat ${n} bones`,
      landmarks: (n) => `sniff ${n} landmarks`,
      landM2: (km2) => `mark ${km2} sq km`,
      maxHappiness: 'reach max happiness',
      spotVisits: 'build a route and finish it',
    },
    reward: (paws) => `+${paws} 🐾`,
    questPoints: (points) => `+${points} pts`,
    bonusLabel: 'the whole day',
    bonusHint: (paws) => `+${paws} 🐾 for all six`,
    lostPetsNearby: 'lost pets',
    moreCount: (n) => `+ ${n} more`,
    showFewer: 'show fewer',
    pastSearches: 'past searches',
    finished: 'finished',
    abandoned: 'abandoned',
    unknownPet: 'unknown pet',
    territoryBoard: 'who holds this district',
    happinessBoard: 'happiness index',
    happinessHint:
      'so who is the happiest one here?! the index counts whose dog stayed high on the happiness meter the longest: eat well, collect more, search more, walk more — and all will be well!',
    boardYou: 'you',
    boardEmpty: 'nobody holds the city yet — go and mark',
    boardSeeAll: 'see all',
    historySeeAll: 'see all',
  },
  spots: {
    nearbySpots: 'nearby spots',
    seeAll: 'see all',
    nearbyCategory: (category) => `nearby ${category}`,
    emptyAll: "nothing nearby yet — pan the map somewhere new and i'll sniff again",
    emptyFiltered: (category) => `no ${category} nearby — try another filter`,
    favourites: 'favourite places',
    favouritesEmpty: "empty so far. tap the heart on a place i've sniffed out and it'll wait for you here.",
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
    timeTogether: (s) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min together` : `${Math.floor(s / 3600)} h together`),
    luckyActive: 'active',
    luckyInactive: 'happiness ≥ 70%',
    language: {
      label: 'language',
      uk: 'українська',
      en: 'english',
    },
    sceneA11y: (mode) => `scene: ${mode}`,
    barkA11y: 'your dog — bark',
  },
  playerCard: {
    levelUnknown: 'level unknown',
    bot: 'neighbourhood dog',
    territory: 'territory',
    noTerritory: 'no territory yet',
    poke: 'wave 👋',
    poked: 'waved!',
    pokeFailed: "couldn't wave",
    close: 'close',
    owner: (nick) => `owner ${nick}`,
  },
  poke: {
    verb: 'waved at you! 👋',
    nearby: '🐾 nearby — tap to find them',
    wasNearby: '🐾 they were nearby',
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
    walkingToVia: (name, stops) =>
      `walking to ${name} — ${stops} ${stops === 1 ? 'stop' : 'stops'} on the way`,
    cantReachWalk: () => "*sniff sniff* — can't reach the walk right now, let's try again",
    cantReachDog: "*sniff sniff* — can't hear you, the connection dropped. try again",
    couldntStartSearch: "couldn't start the search — try again",
    retry: 'try again',
    inputPlaceholder: 'say anything…',
    send: 'send',
  },
  connection: {
    offline: "no connection — we'll catch up when it's back",
    slow: 'connection is slow…',
    loadFailed: "couldn't load — tap to try again",
  },
  modals: {
    common: {
      close: 'close',
      deckA11y: (i, n) => `cards, ${i} of ${n}. left and right arrows flip`,
      deckCounterA11y: (label, i, n) => `${label} (${i} of ${n})`,
    },
    lostDog: {
      badgeUrgent: 'urgent',
      badgeSearching: 'searching',
      lastSeen: (rel) => `last seen ${rel}`,
      questCta: (points) => `complete search quest for ${points} bonus pts`,
      iveSeen: "i've seen them",
      seenConfirm: (name) => `saw ${name} here, just now?`,
      seenConfirmYes: 'yes, just now',
      seenConfirmNo: 'no',
      startSearch: 'start search',
      searchingCta: 'searching…',
      previousPet: 'previous pet',
      nextPet: 'next pet',
      readPost: 'read the post',
      approximate: 'rough location — check the post',
    },
    post: {
      title: 'the post',
      titleNamed: (name) => `${name} · the post`,
      loading: 'opening…',
      failed: "couldn't load that.",
      notStored:
        "we don't have the full text of this one — it was posted before we started keeping them.",
      originalAfterSighting:
        "mark that you've seen this pet and i'll open the original post.",
      openOriginal: 'original',
      contactsAfterSighting:
        "mark that you've seen this pet and i'll show the whole post and open the original.",
      contactsMaskedBySource:
        'olx hid the number itself — it only shows in full after a tap. open the original and tap "show phone".',
      retry: 'try again',
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
        "привіт! i'm <strong>шукайпес</strong>. we walk, we sniff, we find lost pets, we learn this city paw by paw. here's how it all works:",
      footer:
        "*tail wag* — when in doubt, just walk. we'll figure the rest out together. 🐾",
      rows: [
        {
          title: "what's up?",
          body: "i ask it every time you come in. four answers: lost a friend, i'm a pet finder, let's just walk, who holds this patch. tap me any time and we're back here, where everything starts.",
        },
        {
          title: 'lost a friend',
          body: "the hardest one. tell me: a photo, a name, what they look like, and point on the map at where they were last seen. the pin goes up straight away — everyone walking nearby will see it. i'll forward the post to our channel and the local groups too. *nose to the ground*",
        },
        {
          title: "i'm a pet finder",
          body: "the streets dim, my nose lifts, and every missing pet nearby lands in front of me as a deck of cards. swipe for the next one. tap and we're on the trail — i'll walk you straight to them. tap the photo again and i'll open the owner's post.",
        },
        {
          title: 'if you spot one',
          body: "see one of these pets out there for real?! open their card and tap “i've seen them” — i'll bark the news to everyone else looking. “nobody here” matters too: now we know this patch is empty. *full body wag*",
        },
        {
          title: "let's just walk",
          body: "there and back or one way, close by or further out — i'll lead. i'll tell you things on the way, and we'll stop somewhere. ask for a round trip and i'll bring you home after — promise.",
        },
        {
          title: 'places to stop',
          body: "coffee, food, a drink, vets, pet shops — the pin up top shows them and hides them. tap any one and we'll trot over together.",
        },
        {
          title: 'who holds this patch',
          body: "as we walk i mark the ground behind us — by myself, always, even when you can't see it. the colours are somebody's patches; walk through one and i'll mark it back over to us. who holds how much is in “today”.",
        },
        {
          title: 'press + hold the map',
          body: "press anywhere on the map and hold — close your eyes for a couple of seconds, i'm sniffing. i'll tell you about an old stone, a courtyard with a secret, a corner with a story. press somewhere else for another one.",
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
          body: "tiny things to chew through each day — find some paws, peek at a pet, visit a place. the missing pets nearby are in there too, and who holds how much ground. nothing big. just enough reason to take me out again tomorrow. *eager wag*",
        },
        {
          title: 'talk to me',
          body: "anytime. i know our streets, the pets nearby waiting to be found, the old stories kyiv keeps under its windows. worried about your dog or cat? i know enough to help. and i remember every walk we've taken — every single one.",
        },
        {
          title: "where we keep things",
          body: "all our walks gather here. how far we've gone, how many paws collected, how many pets we've helped find, how much ground we hold. we level up together, you and me. paw in hand.",
        },
      ],
    },
  },
  hints: {
    modes: 'tap the logo top-left — it changes modes 🔄',
    longPressToSniff: 'hold the map and i\'ll have a sniff 🐾',
    supersniffIntro: 'supersniff on! swipe for the next dog, tap to pick up the trail 🐾',
    supersniffExit: 'to get back to walks — tap the logo top-left ↖️',
    scrollMore: 'scroll down — there\'s more',
    radialMenu: 'this is all of us: find a pet, take a walk, drop by a place, say hi, or chat 🐾',
    spotsToggle: 'the pin up top — show or hide places 📍',
    hudMeters: "up top: sun's my mood, bone's hunger, paws are what we've found 🐾",
  },
  modes: {
    ask: 'sniff-sniff! so what is it?',
    lost: 'lost my friend\u00a0:\u2060(',
    search: "i'm a pet-finder!",
    explore: 'i want a walk',
    play: 'who holds this district?',
    exploreAsk: 'just a stroll, a coffee or a pet shop, or shall we go and meet somebody?',
    walkDistanceAsk: 'close by, or shall we go further?',
    meetDistanceAsk: 'look nearby, or further out?',
    visitRegenerate: 'others',
    visitCategoryAsk: 'coffee, food, a bar, a pet shop, or the vet?',
    visitCategoryEmpty: 'nothing like that nearby — pick another',
    visitSpotAsk: "here's what's nearby — where are we headed?",
    playIntro: [
      "this is our ground. i mark it myself as we walk — just walk, and it grows 🐾",
      "the colours are other people's districts. walk through one and i'll mark it over to us",
      'the more we hold, the thicker the paws here. and i rest easier on our own',
    ],
    noWalkers: 'nobody around just yet 👥',
    dogA11y: 'your dog — talk',
    ring: {
      walk: 'walk',
      visit: 'visit',
      meet: 'meet',
      close: 'close by',
      far: 'far',
    },
    ringCaption: {
      walk: 'walk',
      visit: 'places',
      meet: 'meet-ups',
      close: 'close by',
      far: 'farther',
    },
    noLostPetsYet: 'no lost pets in range yet',
    sniffedOut: (name) => `sniffed out ${name} 🔍`,
    meetSniffing: 'sniffing out where the dogs are 🐕',
    walkSniffing: (far) => `${far ? 'long' : 'short'} walk, sniffing the way 🚶`,
    walkNothing: 'nothing worth walking to at that distance — try the other one',
    meetTo: (name, stops) =>
      stops
        ? `${name} — dogs walk there. ${stops} ${stops === 1 ? 'stop' : 'stops'} on the way 🐾`
        : `${name} — dogs walk there 🐕`,
    walkTo: (far, name, stops) =>
      stops
        ? `${far ? 'long' : 'short'} walk to ${name} — ${stops} ${stops === 1 ? 'stop' : 'stops'} on the way 🐾`
        : `${far ? 'long' : 'short'} walk to ${name} 🚶`,
    spotGone: "can't find that one anymore",
    visitSpot: (name, icon) => `let's check out ${name} ${icon}`,
    comingSoon: (label) => `${label}! coming soon 🐾`,
    lostSheet: {
      title: 'lost a friend?',
      speciesDog: 'dog',
      speciesCat: 'cat',
      nameLabel: 'name',
      namePlaceholder: 'their name',
      descLabel: 'description',
      descPlaceholder: 'what they look like, where and when they went missing, how they react to people…',
      phoneLabel: 'phone',
      phonePlaceholder: 'for whoever spots them',
      photoLabel: 'add a photo',
      photoChange: 'different photo',
      photoRemove: 'remove photo',
      pickPin: 'point on the map',
      pinPicked: 'spot picked',
      pinHint: 'aim the map centre at where they were last seen',
      pinConfirm: 'here',
      pinBack: 'back',
      submit: 'put on the map',
      submitting: 'putting on the map…',
      doneTitle: 'on the map 🐾',
      doneBody: "everyone walking nearby will see the pin. i've also forwarded the post to our channel and district groups.",
      doneNoPhoto: "the photo didn't attach — the pin is up without it.",
      doneShare: 'share',
      doneClose: 'done',
      botLine: 'prefer telegram? message the bot — a photo, the district, when you saw them.',
      botCta: 'message the bot',
      errPhoto: "couldn't read that photo — try another one",
      errShort: 'tell a little more — at least a few words.',
      errNoPin: 'pick the spot on the map first.',
      errLimit: "that's the report limit for today.",
      errGeneric: "couldn't put it on the map. try again.",
      close: 'later',
    },
  },
};

export const strings: Record<Lang, AppStrings> = { uk, en };
