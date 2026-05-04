# Technical Task — "Lost Pet Search Companion" mobile-web pilot

**Document type:** Request for Proposal (RFP) — scoping & estimation
**Project name:** *(working title)* шукайпес — lost pet search companion for Kyiv
**Document version:** v1, 2026-05-04
**Issued to:** prospective development studios
**Response format:** total budget + breakdown by phase, calendar timeline, team roster, list of clarifying questions

---

## 1. Executive summary

We want to build a **mobile-web application** that helps people in Kyiv find lost pets while walking around the city. The core idea is to **dress a real search-coordination utility as a friendly walking companion app**: every regular walk a user takes can passively contribute to the search effort, and any user can convert a lost-pet listing into an active 3-waypoint search quest.

The product is an **AI-driven pixel-art dog companion** that lives on a city map, accompanies the user on walks, picks up small in-game rewards (paws, bones), responds to natural-language chat, and surfaces real lost-pet listings aggregated from public Ukrainian sources (OLX, Telegram, Facebook). The game-layer (rewards, levels, daily tasks) is intentional retention design — the actual product utility is connecting nearby users with active lost-pet posts.

**Pilot scope:** web application installable as PWA on iOS + Android, working in Kyiv only, Ukrainian language UI. Native iOS/Android apps are explicitly out of scope for v1 and will be a follow-up phase.

**Why now:** the lost-pet ecosystem in Ukraine is fragmented across several social platforms with no aggregation layer. Real walkers in real neighbourhoods are the underused human resource. We want to test the core hypothesis ("a friendly app turns walking into search coordination") before committing to native development.

## 2. Target user + market

- **Primary user:** Kyiv resident who walks regularly (with or without their own dog), 18-45, smartphone-first.
- **Acquisition channel (out of scope of this build):** word-of-mouth from existing lost-pet community + organic from being shared in Ukrainian-language pet-loss social groups.
- **Initial city:** Kyiv only. Must be technically extensible to other Ukrainian cities later, but pilot is single-city.
- **Language:** Ukrainian primary, with light Russian language support in pet-listing data only (since source posts are in mixed languages).

## 3. Core user experience (the "magic moment")

A user opens the app while walking. They see a map with their position, a pixel-art dog companion that follows them, small game-currency icons (paws, bones) scattered around them which the companion auto-collects as they walk, and red/amber pin-icons for real lost pets reported in the area. Tapping a lost-pet pin opens a card with the pet's photo, last-known location, and a "start search" button. Tapping start-search plots a walking route through 3 waypoints near where the pet was last seen, and the AI companion narrates context-specific clues at each waypoint ("the owner saw them near the dumpsters here"). When the user reaches all 3 waypoints, they get a points reward and the search is logged.

The companion is **conversational** — the user can chat with it in natural Ukrainian, ask for walks, ask about nearby pets, ask about cafés/parks/vets, and the companion takes real actions in the app in response (plotting routes, opening pet cards, starting searches) instead of just narrating.

The whole experience runs in a **mobile browser or PWA**, looks like a polished pixel-art game, and works while the phone is in the user's pocket via background path tracking.

## 4. Functional requirements

### 4.1 Map + companion (the home screen)

- Full-screen map of Kyiv with a custom monochrome / muted style.
- Animated pixel-art dog companion that follows the user with realistic motion (walks, runs when chasing rewards, sits when idle, sniffs when collecting). Multiple animation states from a sprite sheet.
- User position dot.
- Game items scattered on the map within ~1km of the user: small "paw" icons (frequent) and "bone" icons (clustered around real city parks). User and companion auto-collect items they walk past, within a configurable distance threshold.
- Lost-pet pins coloured by urgency (red = urgent, amber = recent, grey = resolved). Pins cluster at lower zoom levels.
- Spot pins (cafés, vets, pet stores, parks, bars) sourced from Google Places, toggleable on/off.
- Floating HUD pills at the top showing: happiness meter (0–100%), hunger meter (0–100%), lifetime paws collected, spots-toggle.
- Bottom tab bar: Map, Quests, Chat, Spots, Profile.
- "Off-screen companion" indicator: when the user pans the map and the companion is off-screen, a small pill appears at the viewport edge pointing toward the companion; tapping it recenters.

### 4.2 Lost-pet pipeline

- Server-side scraper pulls listings hourly from **OLX** (search keywords for lost dogs/cats in Kyiv, ~14 query variants in Ukrainian + Russian).
- **Telegram channels** + **Facebook groups** scrapers as **future phases** (architecture must accommodate them, not in pilot).
- Each listing parsed into structured pet record: name, breed, last-seen location (geocoded), urgency tier, photo URL, reward, source URL.
- De-duplication by source ID — the same listing scraped twice updates instead of duplicating.
- Listings expire / mark resolved based on age + manual override (admin endpoint sufficient for pilot).
- Pets within ~5km of the user shown as map pins. Tap → modal with photo (large, prominent), badge, breed, time-since-last-seen, reward amount, and two action buttons: "I've seen them" (logs a sighting, optionally moves the pin) and "Start search" (begins a 3-waypoint quest).
- Modal supports prev/next navigation between nearby pets via on-screen chevrons + horizontal swipe gestures.

### 4.3 Search quests

- Quest = 3 walking waypoints near the pet's last-known location, with a custom walking-route polyline plotted on the map.
- AI generates 3 clue strings (one per waypoint) at quest start using the pet's listing context, a single AI call, stored in the database. Each waypoint reveals its clue when the user arrives.
- Reaching the final waypoint completes the quest: user receives points reward, companion happiness +25, narration message displayed.
- User can abandon a quest mid-flight.
- Quest history persisted; visible in the Quests tab as "past searches".
- Search-zone radius around the pet's last-known location grows automatically with days-since-last-seen (cron job) so older listings get a wider walkable circle.

### 4.4 AI companion conversation

- Dedicated Chat tab. Real conversation with the companion in Ukrainian.
- Underlying LLM: **Claude Haiku** (Anthropic SDK) — chosen for cost + latency at pilot scale.
- Companion has **memory across sessions**: a periodic summarisation call distills the recent conversation into a short note (≤500 chars) stored against the user's record and injected into the system prompt next session. The companion remembers prior walks, mentioned pets, user preferences.
- Companion can **take real actions**: replies may include structured action tags (e.g. `start a walk to a nearby café`, `open this pet's card`, `begin a search for that pet I mentioned`) which the client parses out of the reply text and dispatches to the same handlers used by the on-screen UI.
- System prompt teaches the companion: tone ("friendly walking dog"), what actions are available, when to use them, the pet name corpus available locally.
- One-tap quick-greet on every map-tab focus showing a randomised "woof" message (~18 variants).

### 4.5 Walks + visits

- **Radial action menu** on the companion sprite (2 levels deep):
  - Walk → Roundtrip / One-way → Close / Far → polyline plotted to a real café/park.
  - Visit → Category (café / restaurant / bar / pet shop / vet) → 3 closest spots by name → polyline plotted to chosen spot.
- Destination picker uses a "democratic" algorithm: weighted random across nearby spots, with a recent-visit penalty so the same café isn't picked twice in a row.
- Roundtrip walks plot a real triangular route (perpendicular nudge from the destination back to user, not retraced along the outbound).
- Walking polylines fit-to-screen on plot.
- Spots as walking destinations include real Kyiv parks, sourced from a curated polygon dataset.

### 4.6 Path collection (the "phone in pocket" feature)

- The map ping endpoint accepts a sequence of user positions even while the user isn't actively interacting.
- Server maintains a per-user "anchor" position in Redis. When a new ping arrives, server sweeps the line segment from anchor → new position and credits the user with any in-game items (paws, bones) within auto-collect distance of that line.
- 24-hour anchor TTL.
- Teleport guard: segments longer than 5 km treated as a teleport (anchor refreshed but no items credited).
- Architecture must port cleanly to native: native iOS Significant Location Changes + Android geofences would call the same endpoint at finer-grained intervals.

### 4.7 Game economy

- **Paws** = frequent small reward, scatter randomly within ~1.2 km of user, denser around parks. Auto-collected.
- **Bones** = larger reward, cluster around parks. Auto-collected.
- **Happiness meter (0–100)** decays over time via cron; bumped by collect / eat / advance-quest actions. Critical: cron must not pull happiness below the level it had immediately after a bump (every active interaction must reset the decay anchor).
- **Hunger meter (0–100)** same pattern.
- **Points** = currency earned from completing quests + sightings. Lifetime accumulator, displayed in profile.
- **Companion XP + level** (10 levels max), triangular curve. Visible XP bar in profile.
- **Daily tasks** = small loops resetting at midnight: collect 10 paws, feed 3 bones, check 2 lost pets, visit a spot, report a sighting. Progress server-backed.

### 4.8 Profile tab

- Companion identity card (name, level, XP bar, mood/hunger/paws meters) with the **live animated pixel-art dog scene** as visual focus (see §6 below).
- Lifetime stats: days played, distance walked, paws collected, bones eaten, points, pets searched, sightings reported, completed quests, abandoned quests.
- "Helping pets" stats card.

### 4.9 Spots tab

- Horizontal filter chips: All / Café / Eat / Drink / Pet shop / Vet, each with a count.
- List of nearby spots within walking range with name, category, rating.
- Tap → SpotModal with primary action ("Walk here") that returns to the map and plots the route.
- Filter selection persists when navigating to the map.

### 4.10 PWA

- Install as standalone app on iOS + Android via "Add to Home Screen".
- App icon, splash screen, theme colour, status-bar style configured.
- `viewport-fit=cover` so the standalone app flows under the iPhone notch / home-indicator.
- Safe-area insets respected by all bottom sheets and the dashboard.

## 5. Technical requirements

### 5.1 Stack preference

We have a strong preference for:
- **Frontend:** React Native + Expo Router with web target via `react-native-web`. Same codebase ports to native later. TypeScript throughout.
- **Backend:** Fastify on Node.js, deployed on Fly.io.
- **Database:** Postgres + PostGIS (Supabase-managed).
- **Cache + queues:** Redis (Upstash).
- **Maps:** Google Maps JavaScript API (web).
- **AI:** Anthropic Claude Haiku via official SDK.
- **Migrations:** Drizzle ORM.
- **Deployment:** Vercel (web) + Fly (server).

Studios may propose alternatives, but should justify trade-offs in their proposal. Critical: the codebase must be portable to native iOS/Android in a follow-up phase without a rewrite.

### 5.2 Integrations

- Google Maps JS API (map render, Places autocomplete, Directions for walking routes).
- Google Places (spot data — cafés, vets, pet stores, restaurants, bars within radius).
- Anthropic Claude Haiku (chat replies, waypoint clue narration, memory summaries).
- OLX (HTML scraper, no public API — must respect robots.txt and rate limits).
- Telegram + Facebook scrapers (architecture only in pilot, not active integration).

### 5.3 Data model (high level)

- `users` — id, auth credentials, created_at, last_seen_position, total_distance_meters, points, level, xp.
- `lost_dogs` — id, source, source_external_id, name, breed, last_seen_position (PostGIS), urgency, photo_url, reward, scraped_at, expires_at.
- `quests` — id, user_id, dog_id, status, waypoints (JSONB array of {position, clue, reached_at}), started_at, finished_at.
- `companion_state` — user_id, name, hunger, happiness, last_decay_at, memory_notes.
- `daily_tasks` — user_id, date, counts (jsonb).
- `path_anchors` — Redis only, key `path:last:<user_id>`, 24h TTL.
- `tokens` (paws) + `food` (bones) spawned per-user-area with grid-keyed Redis sets.
- `sightings` — user_id, dog_id, position, reported_at, trusted (boolean).
- `quest_history` — same shape as `quests` for completed/abandoned.

### 5.4 Performance + scaling targets (pilot)

- 100–500 daily active users.
- 200–500 active lost-pet listings at any time.
- Map render: ≤16ms per frame on mid-range Android (Pixel 5 baseline).
- Server p95 latency ≤200ms for all sync/collect/feed/advance routes.
- Cold-start PWA on Safari mobile: ≤3s to first interaction.
- Vercel + Fly free/hobby tiers must carry pilot load.

### 5.5 Non-functional

- **Browsers:** latest 2 versions of Safari iOS, Chrome Android, Chrome desktop, Safari desktop, Firefox desktop. Edge as best-effort.
- **Devices:** iPhone SE (smallest viewport target), iPhone 14, Pixel 5, mid-range Android. Notched-iPhone PWA must respect safe-area insets.
- **Accessibility:** semantic HTML, aria-labels on all interactive elements, sufficient contrast for the colour palette.
- **Security:** standard web auth (sessions in HttpOnly cookies), no PII beyond name + email. Rate-limit critical endpoints (collect, advance-quest).
- **Privacy:** user position only persisted at the resolution needed for game logic + last-seen cache. Path data never logged beyond the rolling 24h Redis anchor.

## 6. UX + visual requirements

### 6.1 Aesthetic

The product has a deliberate **8-bit pixel-art aesthetic** for the companion + game items, layered with **soft frosted-glass UI chrome** for HUD pills + modals. The intent is "warm, retro game" not "slick fintech" or "playful illustration".

### 6.2 Companion sprite

- Single dog character (white-with-spots variant from the licensable "8-Bit Dogs" pack by 14collective is acceptable; designer may propose alternatives at similar fidelity).
- 7+ animation states: walking, running, sitting, lying, sniffing, jumping, crouched. All from horizontal sprite strips at 64×64 native frame size.
- Renders crisply at 2× scale (`image-rendering: pixelated`).

### 6.3 Profile hero scene

The profile tab is one of the **major delight surfaces**. The dog appears in a small live diorama:
- Pixel-art parallax backdrop with sky, foreground (grass), trees, lamppost, bench.
- Three parallax layers (far / mid / near) translate at different rates in response to the dog's horizontal motion.
- **Day/night theming** auto-derived from the user's local hour. Day uses bright sky + spring-green grass; night uses deep blue + lit lamppost cone + moon + stars + scattered cloud silhouettes.
- **Ambient events** trigger every 6–14 seconds: bird flock with animated wing-flapping (day), butterfly (day), falling leaf (day), bat (night), fireflies near the lamp (night), shooting star (night).
- **Dog state machine** cycles weighted-randomly between sit/lie/walk/run/sniff with non-repeating consecutive picks.
- **Tap interactions:** tap dog → random reaction pose (jumping / crouched / sitting) + speech bubble with a randomised "woof"; tap background → toggle day/night manually for testing.

### 6.4 Modals

Three modal sheets, all sharing a slide-up family animation:
- **Lost-pet modal:** photo-first, ~300px banner at the top with smart object-fit, side-by-side action pills, slide-in animation when navigating between pets, big chevrons over the photo, swipe-cycle support.
- **Spot modal:** photo + name + category + rating + "walk here" primary action.
- **About modal:** triggered from a top-left logo tap; per-row icon + title + body explaining each surface of the app.

All sheets must respect HUD reserve at the top + dashboard reserve at the bottom + iPhone home-indicator safe-area.

### 6.5 Icon set

- A custom icon set (hand-drawn or pixel-art) replaces emoji in the HUD pills, bottom tab bar, paw/bone map markers, profile companion-card meters. Studio to source via Flaticon Premium or commission from designer; commercial-use license required.
- Surfaces still on system emoji in v1 (acceptable): radial menu category icons, lost-pet badges, spot category pins, dynamic chat narration text.

### 6.6 Tone of voice

- Companion writes in **lowercase Ukrainian**, warm, dog-like. Mix of plain speech, *italic action notes* (`*sniff sniff*`, `*tail wag*`), and woof sounds.
- Microcopy is friendly but not infantilising. Bug-error states say "couldn't find that one — try again" not "Oh no, something went wrong! 🥺".

## 7. Out of scope (v1)

The following are explicitly **NOT in this build** and will be quoted separately as a follow-up phase:

- **Native iOS / Android apps.** Web pilot only. Architecture must support port, not actually port.
- **Push notifications.** Foundation (PWA manifest, service worker scaffold) in place; trigger logic + VAPID + subscription flow is phase 2.
- **Multi-walker visibility.** Other users' companions / paths are not shown. v1 is single-player co-op via the lost-pet pipeline.
- **Skins / character variants.** Single dog character.
- **Photo upload from sightings.** "I've seen them" logs a position update, doesn't accept user photos.
- **Shelter-registry adapters.** OLX only in v1.
- **Active Telegram + Facebook scraping.** Architecture must accommodate; pilot ships with adapters disabled until per-source secrets are configured.
- **Multi-city.** Kyiv-only. Geographic configuration must be a single point of change for later cities.
- **Admin dashboard.** Direct database / SQL access is sufficient for the pilot. No admin web UI.
- **i18n beyond Ukrainian.** Russian text appears only in scraped pet data; UI is Ukrainian-only.
- **Firebase Auth** or other 3rd-party auth providers.
- **Payments / subscriptions / monetisation.** Free product in pilot.

## 8. Deliverables

Upon completion the studio delivers:

1. **Source code** in a Git repository (we provide GitHub org), monorepo layout: `app/` (frontend), `server/` (backend), `shared/` (types / constants).
2. **Two deployed environments:**
   - Production: app on Vercel custom domain, server on Fly.
   - Staging: separate Vercel preview + Fly app for QA.
3. **CI/CD:** GitHub Actions pipeline running typecheck on every PR; auto-deploy on merge to `main`.
4. **Database migrations** versioned via Drizzle, runnable via `pnpm migrate` (or equivalent).
5. **Seed data** for development: 10 example lost pets, 50 example spots, test user.
6. **README** in each repo subdirectory: quick-start, environment variables, common dev workflows.
7. **Architecture document** (1 page) describing module boundaries, data flow, deploy topology.
8. **API documentation** (auto-generated from route definitions or hand-rolled OpenAPI) for the public server endpoints.
9. **Hand-off session** (2 hours) walking us through the deploy pipeline + monitoring + how to run the OLX scraper + how to roll a new lost-pet entry manually.
10. **30 days of post-launch defect support** (P1/P2 only) at no additional cost.

## 9. Timeline expectations

We expect a **~3-month calendar window** from kick-off to production launch, broken into:

- **Weeks 1–2:** Foundation. Repos, deploy pipeline, auth, stores, environments live.
- **Weeks 3–6:** Core loops. Map + companion sprite + walk routing + paws + bones + lost-pet pipeline + LostDogModal + quest system. End of week 6 = first internal demo with a real Kyiv lost pet completable.
- **Weeks 7–9:** Companion AI + tabs + profile scene + custom icons + spots tab + daily tasks. End of week 9 = feature-complete.
- **Weeks 10–11:** Performance + crons + PWA hardening.
- **Weeks 12–13:** Cross-device polish + bug bash + hand-off.

Studios should propose adjustments based on team size + their real velocity. We're flexible on +/- 2 weeks.

## 10. What we provide

- GitHub organisation + repos.
- Domain registration + Vercel/Fly/Supabase/Upstash/Anthropic accounts (we cover all infra + AI costs during build).
- Google Cloud project for Maps + Places API keys.
- Curated Kyiv parks polygon dataset (GeoJSON).
- Pet-loss listings access — we'll share OLX query strategy + manual examples.
- Brand: name (шукайпес), logo nose icon, primary palette (frosted-white + retro-pixel companion), tone-of-voice samples.
- Reference imagery for the parallax backdrop aesthetic.
- 8-Bit Dogs sprite pack + commercial-use license proof.
- A fluent Ukrainian-speaking PM on our side for tone review of all microcopy.
- Weekly 1-hour sync; ad-hoc Slack access during business hours Kyiv time.

## 11. What we ask the studio to provide in their proposal

1. **Total budget** in EUR or USD, with VAT treatment specified.
2. **Phase-by-phase breakdown** of cost + duration per phase 1–6 above.
3. **Team roster** with named individuals, seniority levels, FTE allocation per role per phase.
4. **Hourly / day rates** per role for any post-pilot extension work.
5. **Tech stack alternatives** (if any) the studio recommends instead of our preferred stack, with trade-off justification.
6. **List of clarifying questions** about anything in this document the studio finds underspecified.
7. **Two reference projects** of similar scope the team has shipped, with live URLs or App Store links.
8. **Risks + dependencies** the studio sees that could affect timeline or quality.
9. **Indicative monthly run cost** of the deployed infrastructure at 100 / 1000 / 5000 daily active users (so we can plan post-launch).
10. **Approach to QA** — manual cross-device passes, automated tests, Lighthouse / accessibility audit.

## 12. Selection criteria

We will evaluate proposals on (in order of weight):

1. **Demonstrated experience** with React Native + Expo + Postgres + LLM-integrated apps.
2. **Quality of reference work** — we will inspect live URLs.
3. **Realism of the timeline + budget** vs. scope. Wildly low quotes will be discounted as inexperience signals.
4. **Quality of clarifying questions** — the best questions usually come from the studios that genuinely understand the work.
5. **Cultural fit** — async-friendly, Kyiv-time-zone overlap, English-fluent tech lead, comfortable with weekly ship cadence.
6. **Total cost.**

## 13. Submission

Please submit your proposal as a single PDF or Notion link by **[date — recommend 2-3 weeks from issue]** to **[contact email]**. We expect to have an introductory call with shortlisted studios in the following week and award the contract by **[date + 4 weeks]**.

---

*This document does not constitute a binding agreement. The selected studio will sign a formal Statement of Work derived from their accepted proposal.*
