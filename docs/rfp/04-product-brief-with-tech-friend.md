# Lost-pet companion app — pilot brief

**For:** prospective development studios
**From:** the шукайпес team
**Asking for:** a fixed-budget proposal, calendar timeline, and your team
**Format:** ~3-page brief — we want studios to bring most of the engineering judgement, but a tech-savvy friend has helped us scope the high-level shape so we're not totally hand-waving.

---

## What we want to build

A **mobile-web app** that helps people in Kyiv find lost pets while they're out walking. The hook: a friendly **animated dog companion** lives on a city map, follows the user around, picks up little game-currency rewards as they walk, and surfaces real lost-pet listings from public sources (OLX, eventually Telegram + Facebook). Tapping a missing pet starts a small "search quest" — three waypoints near where the pet was last seen, with the companion narrating clues at each stop.

The game layer (rewards, levels, daily tasks) is intentional: it keeps walkers walking. The actual product is **turning ordinary walks into distributed search coordination** for the lost-pet community.

The pilot is **web only**, **PWA-installable** on iOS + Android, **Kyiv only**, **Ukrainian-language UI**.

## Who it's for

- Kyiv resident, 18–45, smartphone-first.
- Walks regularly (with or without their own pet).
- Cares about the pet-loss community or just enjoys a charming app on a walk.

## The user journey

1. User installs the PWA, sees a map of Kyiv with their position.
2. A pixel-art dog companion follows them around. Paws and bones are scattered nearby; the companion auto-collects them as the user walks past.
3. Red and amber pins on the map are real missing pets. User taps one → a sheet pops up with the photo, the urgency, where the pet was last seen, the reward, and two buttons: "I've seen them" and "Start search".
4. "Start search" plots a walking route through three nearby waypoints. The companion sends a clue at each stop (AI-generated). Reaching the third waypoint completes the quest, awards points, and logs the result.
5. The companion is conversational — the user can chat with it in Ukrainian and **it actually does things in response** ("let's walk somewhere close" plots a real walk; "show me that тімка you mentioned" opens the dog's card).
6. The user's profile shows their level, lifetime stats, and a small live diorama of the dog hanging out in a pixel-art park scene with day/night, drifting clouds, ambient birds — pure delight, no functional purpose.

## Features

### Map view
- Full-screen city map with a custom muted style.
- User position + animated companion that walks / runs / sniffs / sits / lies down with realistic motion.
- Paws (small, frequent, denser around parks) and bones (larger, in parks). Auto-collected as the user walks past.
- Lost-pet pins coloured by urgency.
- Spot pins (cafés, vets, pet stores, parks) with on/off toggle.
- Top of screen: small frosted-glass status pills (happiness, hunger, paws collected, spots toggle).
- Bottom: 5-tab dashboard (Map, Quests, Chat, Spots, Profile).

### Lost pets pipeline
- Server scraper pulls listings hourly from OLX (Ukrainian classifieds). Architecture should accommodate Telegram + Facebook scrapers as a phase-2; you don't need to ship those, but the pluggable shape should be there.
- Each listing becomes a pinned pet on the map with photo, urgency, last-known location, reward.
- Tap → photo-first detail sheet with prev/next navigation between nearby pets (chevrons + swipe).
- "I've seen them" updates the pin's location.
- "Start search" begins a 3-waypoint quest with AI-generated clues.

### Search quests
- Three waypoints near the pet's last location.
- AI generates one clue per waypoint at quest start (single model call — we don't want a model call on every advance).
- User walks to each; reaching one reveals the next clue.
- Completing all three awards points + small happiness bumps along the way.
- Search radius around the pet grows over time so older listings get a wider walkable circle.

### The dog companion
- Pixel-art sprite (we have a licensable asset pack: "8-Bit Dogs" by 14collective, white-with-spots variant).
- Seven animation states: walk, run, sit, lie, sniff, jump, crouch.
- Realistic pursuit behaviour — runs after far rewards, sniffs after collecting, sits when idle, lies down after a long pause.
- A radial menu opens on companion tap with two-deep drilldowns: walk → roundtrip/oneway → close/far; visit → category → specific spot.
- Walks plot real walking polylines and fit-to-screen.

### Chat
- Real conversation with the companion in Ukrainian — lowercase, dog-like, friendly.
- Powered by an LLM.
- The companion **takes real actions** in response: replies can include structured action tags that the client parses out and dispatches to the same handlers the on-screen UI uses (start a walk, open a pet's card, begin a search, etc.). Same code path, no duplication.
- The companion **remembers across sessions** — periodically summarises recent chats into a short note that's injected into the system prompt next time.

### Profile + live dog scene
- Companion identity (name, level, XP bar, mood meters).
- Lifetime stats (days played, distance walked, paws, bones, points, pets searched).
- A **live pixel-art diorama at the top:** parallax backdrop with sky, trees, a lamppost, a bench, drifting clouds. Day/night theming auto-derived from the user's local hour. Sun + clouds by day; moon + stars + lit lamppost cone by night. Ambient events drift through every 6–14 seconds: bird flocks (with flapping wings) by day, bats and fireflies at night. Tap the dog → bark bubble + random reaction pose. Tap the background → manual day/night toggle.

### Quests, Spots, Daily tasks
- **Quests tab:** today's daily tasks (5 small loops, midnight reset), lost pets nearby (sorted by distance, tap-to-open, prev/next), past searches.
- **Spots tab:** filter chips by category (café / eat / drink / pet shop / vet) with counts. List of nearby spots. Tap → "Walk here" plots route. Filter persists when navigating back to the map.

### Phone-in-pocket walks
- Most users will lock the phone and walk. The app should still credit them for distance covered.
- This works by sending the user's positions to the server periodically; the server connects consecutive positions and credits any in-game items along the line.
- Includes basic anti-cheat (jumps over 5km treated as teleport, items don't spawn inside the auto-collect bubble).

### PWA
- Installable as a standalone app on iOS + Android.
- Custom app icon, splash screen, theme colour.
- Respects iPhone notch + home-indicator safe areas throughout.

## Architecture pointers (from a tech-friend consultation)

We're not engineers, but we ran the shape past a developer friend and they suggested a few anchor points. Treat these as **defaults, not requirements** — push back in your proposal if you'd do something different.

- **One codebase that can port to native later** (React Native + Expo is the obvious answer). The pilot is web, but we don't want a rewrite when we go native in 6–12 months.
- **PostgreSQL with PostGIS** for the geographic queries — distances, polygons, "pets within 5 km". We'll use Supabase (managed Postgres), but you can run your own if you prefer.
- **A small Node.js backend** for the scrapers, AI calls, game-state mutations, and crons. Our friend suggested **Fastify on Fly.io** — small managed VM, auto-deploy from GitHub. Open to alternatives.
- **Redis** for short-lived state (the path-tracking anchor, rate limits). We'll use Upstash; their free tier covers pilot.
- **AI = Anthropic Claude Haiku** for chat + clue generation + memory summaries. Cheapest + fastest model that's smart enough for the conversational job. Open to alternatives if you make a case.
- **Maps = Google Maps JS API** with custom styling. Walking routes from the Directions API.
- **A single bulk "sync everything" endpoint** for the map view, so we're not making 4 round-trips on every refresh. Battery + bandwidth matter on phones.
- **Server-side anti-cheat** for the game economy — never trust the client. Distance gates on collect, segment-length caps on path collection, etc.
- **Monorepo with `app/`, `server/`, `shared/`** so types + constants don't drift.
- **GitHub Actions for CI** running typecheck on every PR; auto-deploy on merge to `main`.
- **Hosting:** Vercel for web (hobby tier carries pilot), Fly for server. Total infrastructure cost should fit comfortably in free / hobby tiers at 100–500 daily users.

Beyond these defaults: pick what your team is fastest in. We care about ship velocity + code quality, not religious framework choices.

## The vibe

- **Pixel-art, retro, warm.** The companion + game items + profile diorama are 8-bit. The UI chrome is **frosted glass** — soft, modern, layered.
- **Tone:** the companion writes in lowercase Ukrainian, dog-like, friendly. Mix of plain speech, *italic action notes* (`*sniff sniff*`, `*tail wag*`), and woof sounds.
- The product should feel like a charming companion app you'd want to open on a walk, not a utility you have to use. Think "tamagotchi meets walking buddy".
- A **custom hand-drawn icon set** replaces emoji where it matters most — HUD pills, tab bar, map markers, profile meters. Studio sources via Flaticon Premium or commissions; we cover the license cost.
- **Microcopy is friendly but not infantilising.** Bug states say "couldn't find that one — try again" not "Oh no! 🥺".

## What's out of scope (v1)

We are **not** asking for any of these:

- Native iOS or Android apps (web pilot only).
- Push notifications (foundation OK, trigger logic is phase 2).
- Multi-walker visibility (no other users' companions on the map).
- Multiple dog skins / variants — single character.
- User photo upload from sightings.
- Active Telegram + Facebook scrapers (architecture only, not running).
- Multi-city (Kyiv only, but city should be a single config point).
- Admin web UI (direct DB access is fine for pilot).
- Languages other than Ukrainian in the UI.
- Payments / subscriptions / monetisation.

## Pilot scale

- 100–500 daily active users.
- 200–500 active lost-pet listings at any time.
- Infrastructure should run comfortably on free / hobby tiers; we're targeting under $200/month run cost in the pilot.

## Timeline

We're aiming for **~3 months** from kick-off to production launch. ±2 weeks flexibility. Suggested milestones:

- **Month 1:** foundation, map, companion follows user, paws + bones, basic walk loop.
- **Month 2:** lost-pet pipeline, search quests, chat with action dispatch, profile + live dog scene.
- **Month 3:** remaining tabs, custom icons, performance, PWA polish, cross-device bug bash.

End of month 1 = first internal demo (walk and the dog chases paws). End of month 2 = feature-complete. Month 3 = polish.

## What we provide

- GitHub org access.
- All accounts (domain, hosting, database, AI, maps API) — we pay all infrastructure + AI costs during the build.
- The dog sprite pack with commercial-use license.
- Curated Kyiv parks dataset (GeoJSON).
- Brand assets (name, logo, palette).
- A Ukrainian-speaking product owner on our side for tone review on all microcopy.
- Weekly 1-hour sync; async Slack during Kyiv business hours.

## What we want in your proposal

1. **Total fixed budget** (EUR or USD, VAT treatment specified).
2. **Phase-by-phase cost + duration breakdown.**
3. **Team roster** — named people, seniority, FTE per phase.
4. **Stack choices** + a sentence each on why (push back on our defaults if you disagree).
5. **Two reference projects** at similar scope, with live URLs.
6. **Risks** you see in the brief + how you'd mitigate them.
7. **Estimated monthly infrastructure cost** at 100 / 1,000 / 5,000 daily active users.
8. **Your QA approach** — manual cross-device passes, automated tests, accessibility audit.
9. **Clarifying questions** — these tell us as much about your team as your reference work does.
10. **Day rates** for any post-pilot extension work.

## How we evaluate

In rough order of weight:

1. Reference work quality (we'll inspect live URLs).
2. Realistic, specific budget + timeline (we discount unrealistically low quotes as inexperience).
3. Sharpness of the clarifying questions.
4. Cultural fit — async-friendly, English-fluent tech lead, Kyiv time-zone overlap, weekly-ship cadence.
5. Stack judgement — what you chose and why.
6. Total cost.

## Submission

PDF or Notion link to **[email]** by **[date — recommend 2-3 weeks from issue]**. Shortlisted studios get a 30-min intro call the following week. Contract awarded by **[date + 4 weeks]**.

---

*Not a binding agreement. Selected studio signs a formal SOW derived from their accepted proposal.*
