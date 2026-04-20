# Technical Documentation — шукайпес Demo

## Architecture

The demo is a **single HTML file** (`shukajpes-demo.html`, ~380KB) with embedded base64 logo assets. It runs entirely client-side in a mobile browser with two external API dependencies:

1. **Google Maps JavaScript API** — map rendering, Places search, Directions routing
2. **Anthropic Claude API** — companion chat (claude-sonnet-4-20250514, web search enabled)

No backend, no build step. Just open in a browser.

---

## Layout Architecture

### Container Strategy
- **Desktop**: Fixed 390×844px phone frame with border-radius and shadow
- **Mobile** (`max-width:430px`): `position:fixed;inset:0` — this is the ONLY reliable cross-browser approach for iOS. `100svh`/`100dvh` do NOT work reliably across iOS browsers.

### Z-Index Stack
| Layer | Z-Index | Element |
|-------|---------|---------|
| Map | 0 | `#mc` container |
| Screens (tabs) | 9 | `.scr` overlays |
| Header | 10 | `#hdr` |
| Nav bar | 20 | `#nav` |
| Dog modal | 50 | `#dm` |

### Safe Areas
- Header: `padding-top:max(env(safe-area-inset-top,8px),8px)`
- Nav: `padding-bottom:max(env(safe-area-inset-bottom,6px),6px)`
- Screens: `padding-top:105px` (below header), `padding-bottom:60px` (above nav)

### Screen Transitions
Screens slide up with `animation: scrSlide 0.3s cubic-bezier(0.4,0,0.2,1)` from `translateY(100%)`.

---

## Map & Styling

- **Greyscale**: Google Maps API stylers `{saturation:-100, lightness:5}` — pure B&W via Maps API, NOT CSS filter
- POI labels and transit hidden
- Zoom range: 14–19
- Area restriction around user position
- White status bar via `<meta name="theme-color" content="#ffffff">`

---

## Companion System

### Rendering
- 90px squiggle mark image (base64 embedded) as Google Maps `OverlayView` in `floatPane`
- Class: `CO extends google.maps.OverlayView`
- All menu buttons and speech bubbles are children of the companion's overlay div — they move WITH the map

### Roaming Behavior
The companion orbits the user position with smooth angle interpolation:
- `roamR = 0.001 + sin(t/7000) * 0.0003` (varying orbit radius)
- Angle drifts toward random targets, changes direction occasionally
- Sine wobble for organic feel
- Updates every 100ms
- Pauses when NPC menu is open
- **Auto-collects** tokens within 50m and food within 40m while roaming

### Visual Effects
- **Aura/Rings**: Two `::before`/`::after` pseudo-elements with `border:3px solid rgba(255,255,255,1)`, scale 1→8, fade out, 3s cycle, staggered 1.5s. Expanding ring animation.
- **Float**: Gentle bobbing via `cF` keyframe animation

### Speech Bubbles
- Dark bg, white text, `border-radius:18px 18px 18px 4px`
- Child of companion overlay div, positioned via CSS `left:50%;bottom:110%;transform:translateX(-50%)`
- Auto-dismiss after 3 seconds
- Occasional ambient messages every 40 seconds

---

## NPC Menu System

### Primary Menu
- Tap companion → `map.panTo(companion)` → 350ms delay → radial buttons appear
- 5 buttons: 🔍 search, 🚶 walk, 📍 visit, 👥 meet, 💬 chat
- Positioned in circle (R=95px) using trigonometry
- `pointer-events:none` when hidden (opacity:0), `pointer-events:auto` when `.show` class — fixes ghost click bug
- Black bg, white text, rounded pills

### Secondary Menus
- Also radial layout (R2=100px) around companion
- White bg, black text (inverted from primary)
- Staggered 40ms animation per button
- **Walk options**: 🔄 roundtrip close, 🔄 roundtrip far, ➡️ one-way close, ➡️ one-way far, 🏠 home
- **Visit options**: ☕ coffee, 🍹 drink, 🍜 eat, 🛒 groceries, 🐶 doggos
- **Search options**: Lists lost dogs by name with emoji

### Home Button
Stores user's initial GPS position as `startPos`. Routes back using Google Directions walking mode.

---

## Map Elements

### Tokens (🐾)
- 20px emoji with lime glow via `drop-shadow`
- Gentle float animation (2px vertical, 2% scale)
- 30 regular tokens + 6 per dog search zone
- Tappable or auto-collected by companion
- Each token: happiness +5, hunger +2

### Food (🦴)
- 8 bones scattered across map
- Warm orange glow
- Tappable or auto-collected by companion within 40m
- Each bone: hunger +20, happiness +8

### POIs (Points of Interest)
- 28px emoji (☕🍜🍹🐶⛑️) with blue glow
- Rendered in `floatPane` as OverlayView
- Tap → preview card appears as child div (z-index 9999)
- Tap preview → generates walking route to POI
- Auto-dismiss after 6 seconds

### Lost Dogs
- 3 dogs: Barsik (🐕, medium urgency), Luna (🐺, urgent), Mochi (🐶, urgent)
- White circle pins with urgency-colored shadow
- Search zone circles on map
- Tapping opens slide-up modal with details, reward info, and "join search" button
- Joining a search activates quest, spawns bonus tokens in the zone

### Dog Walkers
- Semi-transparent emoji avatars (🐕, 🐩, 🐕‍🦺)
- Tapping triggers "friendly!" bubble and +1 point

### Routes
- Google Directions walking mode
- `DirectionsRenderer` with `preserveViewport:true` (no zoom on route)
- Dark polyline

---

## User Position

- Black dot marker with white stroke
- GPS circle: radius 60m, very subtle fill (0.04 opacity)
- **Breathing ring**: Single ring animation, `scale(4)↔scale(4.5)`, opacity 0.12↔0.06, 8s cycle, very light grey `rgba(160,160,160,0.1)`. Almost static, very subtle.

---

## Hunger & Happiness System

### UI: Unified Status Bar
Single black pill in header top-right containing three sections:
- 🦴 Hunger section with green fill
- ☀️ Happiness section with green fill
- 🐾 Token counter with number

Fill implementation: absolute positioned `.ub-fill` divs with `left:-12px` extension to cover rounded edges. Parent `.ubar` has `overflow:hidden` + `border-radius:22px` for clipping. Width calculated in pixels: `Math.round(sectionWidth * value / 100) + 12`.

### Mechanics
| Action | Hunger | Happiness |
|--------|--------|-----------|
| Eat bone (🦴) | +20 | +8 |
| Collect token (🐾) | +2 | +5 |
| Start search quest | — | +15 |
| Go for walk | — | +10 |
| Time decay (every 8s) | -2 | -1 |

- Green fill (`--ac: #c8ff00`) when above 30%
- Red fill (`--red: #e84040`) when below 30%
- Companion auto-eats nearby food while roaming

---

## Chat System

- Live Claude API (`claude-sonnet-4-20250514`) with `web_search` tool enabled
- System prompt: dog personality, 1-2 sentences, casual lowercase, aware of points/quest state
- `max_tokens: 300`
- Typing indicator: "sniffing..." with animated dots
- URLs in messages converted to clickable `<a>` tags
- Last 10 messages sent as context
- Chat auto-starts with greeting when first opened

---

## Screen Tabs

### Map (default)
Full-screen map with all overlays. Header visible with logo and status bar.

### Tasks
Daily task list with progress bars:
- 🚶 Walk 1km
- 🐾 Collect 10 tokens (updates live)
- 📍 Check lost dog
- 👋 Wave at walker

### Chat
Claude-powered conversation. Input at bottom, messages scroll.

### Spots
Google Places API nearby search. Categories: cafe, restaurant, bar, pet_store, veterinary_care.
**Tapping a spot switches to map and generates walking route.**

### Profile
Walker avatar, stats (distance, tokens, quests), companion skins grid (6 skins, most locked).

### Navigation
- Nav bar always visible (z-index 20, above all screens)
- Header visible on all tabs
- No back buttons — just tap another tab
- Screens slide up from bottom

---

## Pinch Zoom Prevention
- Multi-touch prevented on app container (not map)
- `gesturestart`/`gesturechange` prevented
- Double-tap zoom prevented on non-map areas
- `touch-action: manipulation` on app container

---

## Key Technical Learnings

1. **`100svh`/`100dvh` don't work** reliably across iOS browsers. `position:fixed;inset:0` is the only reliable approach.
2. **Google Maps overlay elements** in the same pane share stacking context — z-index between siblings works but not across panes.
3. **PNG logos with transparent padding** need negative margins to align visually.
4. **`env(safe-area-inset-top/bottom)`** works in padding but needs `max()` wrapper for fallback.
5. **Map `{stylers:[{saturation:-100}]}`** is the most reliable B&W approach — CSS filter overlays too aggressively.
6. **NPC buttons at `opacity:0` still receive clicks** — must use `pointer-events:none`.
7. **Never use `sed` or regex** on JS files containing Unicode escape sequences — use Python `readlines()`/`writelines()` with line-number targeting.
8. **Keyboard handling**: `interactive-widget=resizes-content` viewport meta + visual viewport resize listener.

---

## API Keys (Demo Only)
- Google Maps: `AIzaSyBpqM8DobD-CRDYkK_IwbMI1VSmvRWMaPM`
- Anthropic: `<REDACTED — old key was pushed to a public repo and has been revoked. New key goes into server/.env only.>`

These were demo-only keys exposed in client-side code. Production app uses the backend proxy in `server/` — no client-side Anthropic key, ever.

---

## Asset Dependencies
- **Fonts**: Caveat (handwritten, for headings/companion), DM Sans (UI body)
- **Logo**: Hand-drawn white dog in rounded square with Cyrillic text (base64 embedded, multiple variants)
- **Companion mark**: Squiggle/calligraphy-style dog silhouette (base64 embedded)
