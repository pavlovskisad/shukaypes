# Lost-pet companion app — v1 brief

**For:** prospective development studios
**From:** the шукайпес team
**Asking for:** a fixed-budget proposal + timeline + your team
**Format:** ~3-page brief, not a tech spec — we want studios to bring the engineering judgement.

---

## What we want to build

A **mobile app + companion website** that helps people in Kyiv find lost pets while they're out walking. The hook: a friendly **animated dog companion** lives on a city map, follows the user around, picks up little game-currency rewards as they walk, and surfaces real lost-pet listings from public sources (OLX, Telegram, Facebook). Tapping a missing pet starts a small "search quest" — three waypoints near where the pet was last seen, with the companion narrating clues at each stop.

The game layer (rewards, levels, daily tasks) is intentional retention design. The actual product is **turning ordinary walks into distributed search coordination** for the lost-pet community.

**Form factor:** native iOS + Android apps + a PWA-installable web companion. **Cities:** Kyiv only. **Languages:** Ukrainian + English UI.

## Who it's for

- Kyiv resident, 18–45, smartphone-first.
- Walks regularly (with or without a pet).
- Cares about the pet-loss community or just enjoys a charming app on a walk.
- Acquisition is handled separately by us; you don't need to design for that.

## The user journey

1. User installs the iOS / Android app or adds the web app to their home screen.
2. They see a map of Kyiv with their position, a pixel-art dog companion, and red/amber pins for real missing pets.
3. As they walk, the companion auto-collects paws + bones; their distance counts even with the phone in their pocket.
4. Tap a missing pet → photo-first detail sheet → "Start search" plots a 3-waypoint walking route. The companion narrates AI-generated clues at each stop.
5. Reaching the third waypoint completes the quest, awards points + XP.
6. They can chat with the companion in Ukrainian or English; it actually does things in response (plots walks, opens pets, starts searches).
7. Their profile shows level, lifetime stats, and a small live diorama of the dog hanging out in a pixel-art park scene.
8. **They can upload a photo of their own dog** and the app generates a personalised pixel-art sprite to use as their companion.
9. **They can see other walkers nearby on the map** (privacy-respecting, opt-in) — turns the lonely walk into a quiet coop game.
10. **Push notifications** alert them when a new lost pet appears nearby or a quest waypoint is reached.

## Features

### Map view
- Full-screen city map with a custom muted style.
- User position dot.
- Animated companion that walks / runs / sniffs / sits / lies down with realistic motion.
- Paws (small reward, frequent, denser around parks) and bones (larger reward, in parks). Auto-collected.
- Lost-pet pins coloured by urgency.
- Spot pins (cafés, vets, pet stores, parks) with on/off toggle.
- **Other walkers' companions visible nearby** (opt-in, privacy-respecting — see Multiplayer below).
- Top of screen: small frosted-glass status pills (happiness, hunger, paws collected, spots toggle).
- Bottom: 5-tab dashboard (Map, Quests, Chat, Spots, Profile).

### Lost pets
- **Three sources running in production:** OLX (Ukrainian classifieds), Telegram channels, Facebook groups. We provide the credentials + curated channel/group lists.
- Each listing becomes a pinned pet on the map with a photo, urgency tier, last-known location, reward.
- Tap → photo-first detail sheet with prev/next navigation between nearby pets (chevrons + swipe).
- "I've seen them" updates the pin's location.
- "Start search" begins a 3-waypoint quest with AI-generated clues.

### Search quests
- Three walking waypoints near the pet's last location.
- AI generates clues at quest start (one model call, see Tech expectations).
- User walks to each waypoint; reaching one reveals the next clue.
- Completing all three awards points.
- Search radius grows with how long the pet has been missing.

### The dog companion
- Pixel-art sprite. We provide a base-character licensable asset pack (8-Bit Dogs by 14collective, white-with-spots variant).
- Seven animation states: walk, run, sit, lie, sniff, jump, crouch.
- Realistic pursuit behaviour. Sniffs when collecting, sits when idle, lies down after a long pause.
- A radial menu opens on tap with two-deep drilldowns: walk → roundtrip/oneway → close/far; visit → category → specific spot.
- Walks plot real walking polylines and fit-to-screen.

### Character variants + photo-to-pixel-dog engine
- A **gallery of dog skins** (different breeds, colours, accessories) the user can pick from.
- A **personal-dog upload flow:** the user takes / uploads a photo of their real dog → the app generates a personalised pixel-art sprite that represents them in the app. AI-driven image-to-pixel pipeline (we expect studios to propose the right tool — open-source SD pipeline, paid API like Replicate, or custom). Quality bar: recognisable as their dog, fits the 8-bit style of the rest of the app.
- Generated sprites become part of the user's collection; they can switch back to the base character at any time.

### Chat
- Real conversation with the companion in **Ukrainian or English** (auto-detected from device + user toggle).
- Powered by an LLM (we use Claude Haiku — happy to discuss alternatives).
- The companion **takes real actions** in response to chat. Replies can include structured action tags that the client parses and dispatches to the same handlers the on-screen UI uses (start a walk, route to a specific spot, open a pet's card, begin a search).
- The companion **remembers** across sessions — periodic summarisation distills recent chats into a short note injected into the system prompt next time.

### Profile + live dog scene
- Companion identity (name, level, XP bar, mood meters).
- Lifetime stats (days played, distance walked, paws, bones, points, pets searched).
- A **live pixel-art diorama at the top:** parallax backdrop with sky, trees, a lamppost, a bench, drifting clouds. Day/night theming auto-derived from local hour. Sun + clouds by day; moon + stars + lit lamppost cone by night. Ambient events drift through every 6–14 seconds: bird flocks (with flapping wings) by day, bats and fireflies at night. Tapping the dog → a bark bubble + a random reaction pose.

### Quests tab
- Daily tasks (5 small loops, midnight reset): collect paws, feed bones, check pets, visit a spot, report a sighting.
- Lost pets nearby — sorted by distance, tap-to-open with prev/next.
- Past searches (collapsible).

### Spots tab
- Filter chips by category (café / eat / drink / pet shop / vet) with counts.
- List of nearby spots with rating.
- Tap → "Walk here" plots the route.
- Filter selection persists when the user navigates back to the map.

### Multiplayer / co-op presence
- Other walkers' companions visible on the map (opt-in via profile setting; default off until the user is comfortable).
- See approximate position only (rounded to a block to protect privacy), not real-time precise tracking.
- Visual treatment: small ghost-companion sprite at each remote walker's last reported position.
- Tap → simple "wave" interaction (no chat between users in v1, just acknowledgement). The companion will mention them in chat sometimes ("I sniffed Бобик earlier").

### Push notifications
- Web Push for PWA + native push for iOS/Android (`expo-notifications`).
- **Triggers:**
  - New lost pet appears within ~2 km of the user.
  - Quest waypoint reached and a new clue is ready.
  - Daily-task reset reminder (opt-in, defaults off).
  - Friend / nearby walker started a search you might want to help with (opt-in).
- One-tap subscription flow on first quest completion.
- Per-notification-type opt-out in profile settings.
- Throttled (max 1 push / hour / user) to avoid spam.

### "Phone in pocket" walks
- Most users will lock the phone and walk. The app should **still credit them** for distance covered.
- Web: server sweeps the line between consecutive position pings.
- Native: iOS Significant Location Changes + Android geofences ping the same endpoint at finer-grained intervals.
- Includes basic anti-cheat (jumps over 5 km treated as teleport, items don't spawn inside the auto-collect bubble).

### Payments + subscriptions
- **Free tier** with the full search-and-walk loop, basic companion, default skin pack.
- **Pro subscription (~€2-3 / month, exact pricing TBD):**
  - Photo-to-pixel-dog upload (free tier limited to base-character gallery).
  - Premium skin pack (cosmetic only, no gameplay advantage).
  - Larger daily-task pool / 2× point multiplier.
  - Priority push for nearby pets.
  - Early access to new features.
- Standard payments setup: Stripe (web) + StoreKit (iOS) + Google Play Billing (Android).
- Subscription managed in profile; cancel anytime.
- No paywall on the search-coordination utility — finding lost pets is always free.

### Admin web UI
- Simple authenticated dashboard at a separate `/admin` route.
- Manage lost pets (manually add, edit, mark resolved).
- Moderate sightings (review user-reported "I've seen them" updates).
- View global stats (DAU, scrapers per source, pet volume, completed quests).
- Trigger manual scraper runs.
- Bulk-export listings for analysis.
- Auth via shared password / single-admin email — full multi-user admin not needed in v1.

### PWA + native apps
- **Native iOS + Android apps** distributed via App Store + Play Store. Custom icons, splash screens, push capability, native location services for background tracking.
- **Web app + PWA** as a low-friction entry point — installable via "Add to Home Screen" on iOS / Android, opens as standalone (no browser chrome). Custom icon, splash, theme colour.
- **Same codebase** across all three (web + iOS + Android) so feature work happens once and ships everywhere.

## The vibe

- **Pixel-art, retro, warm.** The companion + game items + profile diorama are 8-bit. The UI chrome is **frosted glass** — soft, modern, layered.
- **Tone:** the companion writes in lowercase Ukrainian (or lowercase English when EN is selected), dog-like, friendly, mix of plain speech + *italic action notes* + woof sounds.
- The product should feel like a charming companion app you'd want to open on a walk, not a utility you have to use. Think more "tamagotchi meets walking buddy" and less "Uber for pets".
- **Custom hand-drawn icon set** replaces emoji where it matters most — HUD pills, tab bar, map markers, profile meters. Studio sources via Flaticon Premium or commissions; we cover the license cost.
- **Microcopy is friendly but not infantilising.** Bug states say "couldn't find that one — try again" not "Oh no! 🥺".

## What's still out of scope (v1)

We are **not** asking for any of these in this build:

- Multi-city — Kyiv only. The architecture should make adding a second city a single configuration change later, but v1 ships Kyiv-only.
- Languages other than Ukrainian + English in the UI.
- Full multi-user admin with roles, audit log, moderation queues.
- In-app messaging between walkers (the "wave" is the only interaction in v1).
- Custom waypoint editing — the AI picks the 3 search waypoints, the user can't manually move them.
- Reverse search ("I lost my pet, post a listing") — listings come from external sources only in v1.
- Marketplace / pet-supply store integrations.

## Tech expectations

We're **not the tech team** — you choose the stack. A few constraints:

- We need a **single codebase that ships to web + iOS + Android** so we're not maintaining three apps. React Native + Expo is the obvious answer; alternatives need a strong reason.
- The product is **paid + free tiered**. Whatever you choose, infrastructure cost at 1,000–5,000 daily active users should fit reasonable cost (under ~$500/month is a soft target).
- We need **Postgres with geographic queries** (PostGIS or equivalent) for the lost-pet location data, multi-walker presence, geofencing on push triggers.
- The AI integration uses **Claude Haiku** (Anthropic) for chat + waypoint clue generation + memory summarisation. Open to alternatives.
- The photo-to-pixel-dog engine is its own AI integration — propose your approach.
- Maps: **Google Maps JS API** for web, **react-native-maps** (or similar) for native, with custom styling. Walking routes from Directions API.
- **Push:** Web Push API (web) + `expo-notifications` (native).
- **Payments:** Stripe (web) + StoreKit (iOS) + Play Billing (Android), unified server-side subscription state.
- Code lives in **GitHub** in our org (we'll provide access).
- **Pilot scale:** 1,000–5,000 daily active users (we're past pure MVP — these features assume the product loop already validates).

Beyond that: pick what your team is fastest in.

## Timeline

We're aiming for a **~5-month calendar window** from kick-off to production launch (web + native). Suggested milestones:

- **Months 1–2:** foundation + core loops. Map view, companion follows user, paws + bones, basic walk routing, lost-pet pipeline (OLX live), search quests, chat with action dispatch. End of month 2 = playable on web.
- **Month 3:** profile + live dog scene, custom icons, daily tasks, spots tab, multiplayer presence, admin UI, i18n (UA + EN), payments + subscriptions plumbing.
- **Month 4:** Telegram + Facebook scrapers, push notifications (web + native), photo-to-pixel-dog engine, App Store + Play Store native builds.
- **Month 5:** cross-device polish + bug bash + App Store / Play Store submission + post-launch monitoring setup.

End of month 2 = first internal demo (you can walk and the dog chases paws + the search loop works). End of month 4 = feature-complete on all three surfaces. Month 5 = polish + stores.

±3 weeks flexibility on the calendar.

## What we provide

- GitHub org access.
- All accounts: domain, hosting, database, AI, maps API, Stripe, Apple Developer Program ($99/yr), Google Play Console ($25 one-time). We pay all infrastructure + AI + service costs during the build.
- The dog sprite pack (commercial-use license).
- Curated Kyiv parks dataset (GeoJSON).
- OLX query strategy + Telegram channel list + Facebook group list with credentials.
- Brand assets (name, logo, palette, icon set).
- A Ukrainian-speaking product owner on our side for tone review on every microcopy decision (UA + EN).
- Weekly 1-hour sync; async Slack during Kyiv business hours.

## What we want in your proposal

1. **Total fixed budget** (EUR or USD, VAT treatment specified).
2. **Phase-by-phase breakdown** of cost + duration.
3. **Team roster** — named people, seniority, FTE per phase.
4. **Stack choices** + a sentence each on why (single-codebase web+native, AI for chat, AI for photo-to-pixel, payments).
5. **Approach to the photo-to-pixel-dog engine** — this is the most novel piece; tell us how you'd build it (model choice, hosted vs self-run, expected cost-per-generation).
6. **Two reference projects** at similar scope (mobile apps with native + web from one codebase, ideally with payments + push + AI integration), with live URLs / store links.
7. **Risks** you see in the brief + how you'd mitigate them.
8. **Estimated monthly infrastructure cost** at 1,000 / 5,000 / 25,000 daily active users (so we can plan post-launch).
9. **Your QA approach** — manual passes, automated tests, accessibility audit, App Store + Play Store submission process.
10. **Day rates** for any post-pilot extension work.

## How we evaluate

In rough order of weight:

1. Reference work quality, especially apps shipped to App Store + Play Store from a single codebase.
2. Realistic, specific budget + timeline (we discount unrealistically low quotes as inexperience).
3. Sharpness of the clarifying questions.
4. Cultural fit — async-friendly, English-fluent tech lead, Kyiv time-zone overlap, weekly-ship cadence.
5. Stack judgement — what you chose and why.
6. Total cost.

## Submission

PDF or Notion link to **[email]** by **[date]**. Shortlisted studios get a 30-min intro call the following week. Contract awarded by **[date + 4 weeks]**.

---

*Not a binding agreement. Selected studio signs a formal SOW derived from their accepted proposal.*
