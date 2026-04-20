# Claude Code Instructions

## Context

You're picking up a project that has been developed as a single-file HTML demo. Your job is to help transform it into a production React Native mobile app.

The demo file (`shukajpes-demo.html`) is a fully functional prototype — every feature in it works and has been tested on real iOS devices. It represents months of iterative design decisions. The goal is to preserve every UX detail while building proper architecture underneath.

---

## Required Reading (In Order)

1. `README.md` — project vision, core innovation, business context
2. `shukajpes-product-doc.docx` — **canonical product architecture document** (most important, read fully)
3. `TECHNICAL.md` — complete technical documentation of the demo
4. `TRANSFORMATION.md` — migration plan and target architecture
5. `PRODUCT_SPEC.md` — quick-reference summary of the product doc
6. `shukajpes-demo.html` — the actual demo source (read it, understand every piece)

The product doc (`shukajpes-product-doc.docx`) is the source of truth for product decisions. The demo HTML is the source of truth for UX implementation details.

---

## Key Concepts You Must Understand

### The Invisible Search Layer
The entire game economy is a search coordination layer for lost pets. Tokens, errand routes, companion food, and photo pop-ups all route users through search zones. Most users don't know they're searching. This is the core thesis of the product — every feature you build should maintain this property.

### The Companion IS the Interface
No menus, no search bars, no settings screens. Users interact with their dog. The radial menu, chat, and companion state ARE the UI. Don't add traditional app chrome.

### Prompt Assembly Architecture
Each Claude API call builds from 4 layers: core personality (~600 tok), user memory (~300-500), interaction context (~400-800), action schema (~300). Total 1,600-2,200 tokens. This is how the companion knows what's happening.

### Two AI Tiers
Sonnet for active interactions (user-initiated chat, quest briefings). Haiku for ambient messages (cheaper, 50-60% of calls).

---

## Working Style

### Pav's Communication Style
- Direct, concise, iterates fast
- Catches issues precisely — pixel-level details, stray artifacts
- Tests on real iOS devices (iPhone, Safari and Chrome)
- Provides screenshots to guide corrections
- Expects things to work on first try when possible

### Code Standards
- No AI-isms in copy ("that's the point," "bolted on") — flat engineering tone
- No hype language; concise but not dry
- TypeScript throughout
- Functional components with hooks
- Keep files small and focused

### What NOT to Do
- Don't use `sed` or regex on files with Unicode — use proper file I/O
- Don't assume viewport units (`svh`/`dvh`) work on iOS — use `position:fixed;inset:0`
- Don't expose API keys in client code
- Don't add unnecessary abstractions early
- Don't change UX patterns from the demo without discussing first
- Don't add traditional app chrome (hamburger menus, settings icons, etc.)

---

## Project Structure (Target)

```
shukajpes/
├── app/                    # Expo Router pages
│   ├── (tabs)/
│   │   ├── map.tsx        # Main map screen
│   │   ├── tasks.tsx      # Daily tasks
│   │   ├── chat.tsx       # Companion chat
│   │   ├── spots.tsx      # Nearby spots / partner spots
│   │   └── profile.tsx    # User profile, skins, stats
│   ├── _layout.tsx
│   └── index.tsx          # Splash/entry
├── components/
│   ├── map/
│   │   ├── Companion.tsx  # Companion overlay + roaming + aura
│   │   ├── TokenMarker.tsx
│   │   ├── FoodMarker.tsx
│   │   ├── DogPin.tsx     # Lost dog pins + search zones
│   │   ├── POIMarker.tsx
│   │   ├── UserMarker.tsx # Position + breathing ring
│   │   ├── RadialMenu.tsx # Primary + secondary NPC menus
│   │   └── PhotoPopup.tsx # Lost dog photo pop-ups
│   ├── ui/
│   │   ├── StatusBar.tsx  # Unified pill: hunger/happiness/tokens
│   │   ├── SpeechBubble.tsx
│   │   └── DogModal.tsx
│   └── chat/
│       ├── MessageList.tsx
│       └── ChatInput.tsx
├── hooks/
│   ├── useCompanion.ts    # Companion state, roaming, auto-collect
│   ├── useGameState.ts    # Points, hunger, happiness, levels
│   ├── useLocation.ts     # GPS tracking with battery optimization
│   ├── useChat.ts         # Claude API with prompt assembly
│   └── useQuests.ts       # Quest state machine
├── services/
│   ├── api.ts             # Backend API client
│   ├── claude.ts          # Chat proxy (Sonnet active, Haiku ambient)
│   ├── places.ts          # Google Places
│   └── scraper.ts         # Lost dog data pipeline interface
├── stores/
│   └── gameStore.ts       # Zustand: tokens, hunger, happiness, quests
├── constants/
│   ├── colors.ts          # Design tokens
│   ├── balance.ts         # Game balance numbers
│   └── prompts.ts         # Prompt templates (4 layers)
├── docs/                  # These docs + product doc
├── server/                # Backend API
└── shukajpes-demo.html    # Original demo (reference)
```

---

## Design Tokens

```typescript
export const colors = {
  black: '#1a1a1a',
  grey: '#777',
  greyLight: '#aaa',
  greyPale: '#ddd',
  greyBg: '#f0f0f0',
  white: '#fff',
  accent: '#c8ff00',      // Lime green
  red: '#e84040',
  redBg: '#fde8e8',
  amber: '#d9a030',
  amberBg: '#fdf3e0',
};

export const fonts = {
  heading: 'Caveat',       // Handwritten, companion personality
  body: 'DM Sans',         // Clean UI text
};
```

---

## Game Balance (Current Demo Values)

```typescript
export const balance = {
  hunger: { start: 80, decay: 2, interval: 8000 },
  happiness: { start: 60, decay: 1, interval: 8000 },
  bone: { hunger: 20, happiness: 8 },
  token: { hunger: 2, happiness: 5 },
  searchQuest: { happiness: 15 },
  walk: { happiness: 10 },
  lowThreshold: 30,        // bar turns red
  tokenCount: 30,
  bonusPerDog: 6,
  foodCount: 8,
  roamRadius: 0.001,       // ~111m
  autoCollectToken: 50,    // meters
  autoCollectFood: 40,     // meters
};
```

---

## First Session Priorities

1. **Read all docs** (especially `shukajpes-product-doc.docx`)
2. **Read the demo HTML source** — understand every piece
3. **Discuss architecture** — validate stack, identify concerns
4. **Initialize project** — Expo, TypeScript, navigation
5. **Port map screen** — this is 70% of the app
6. **Get companion rendering and roaming**

Don't build everything at once. Map + companion first, then layer features.

---

## Demo Behaviors That Took Many Iterations

These are the things that work and should be ported faithfully:

- Companion roaming algorithm (smooth orbit, organic feel)
- NPC radial menu (trig positioning, ghost-click prevention with pointer-events)
- Unified status bar pill (hunger/happiness fills with edge handling)
- POI tap → preview → route flow
- Screen slide-up animations
- Chat with web search and clickable links
- Token/food collection with companion auto-collect
- Header/nav layout with iOS safe areas
- B&W map via API stylers (not CSS filter)
- Breathing ring animations (subtle for user, visible for companion)
