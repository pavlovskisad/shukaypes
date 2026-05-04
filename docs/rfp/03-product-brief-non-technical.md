# Lost-pet companion app — pilot brief

**For:** prospective development studios
**From:** the шукайпес team
**Asking for:** a fixed-budget proposal + timeline + your team
**Format:** ~2-page brief, not a tech spec — we want studios to bring the engineering judgement

---

## What we want to build

A **mobile-web app** that helps people in Kyiv find lost pets while they're out walking. The hook: a friendly **animated dog companion** lives on a city map, follows the user around, picks up little game-currency rewards as they walk, and surfaces real lost-pet listings from public sources (OLX, eventually Telegram + Facebook). Tapping a missing pet starts a small "search quest" — three waypoints near where the pet was last seen, with the companion narrating clues at each stop.

The game layer (rewards, levels, daily tasks) is intentional: it's there to keep walkers walking. The actual product is **turning ordinary walks into distributed search coordination** for the lost-pet community.

The pilot is **web only**, **PWA-installable** on iOS + Android, **Kyiv only**, **Ukrainian-language UI**.

## Who it's for

- Kyiv resident, 18–45, smartphone-first.
- Walks regularly (with or without a pet).
- Cares about the pet-loss community or just enjoys a charming app on a walk.
- Acquisition is handled separately by us; you don't need to design for that.

## The user journey

1. User installs the PWA, sees a map of Kyiv with their position.
2. A pixel-art dog companion follows them around. Paws and bones are scattered nearby; the companion auto-collects them as the user walks past.
3. Red and amber pins on the map are real missing pets. User taps one → a sheet pops up with the photo, the urgency, where the pet was last seen, and two buttons: "I've seen them" and "Start search".
4. "Start search" plots a walking route through three nearby waypoints. The companion sends a clue at each stop (AI-generated). Reaching the third waypoint completes the quest, awards points, and logs the result.
5. The companion is conversational — the user can chat with it in Ukrainian and it actually does things in response ("let's walk somewhere close" plots a real walk; "show me that тімка you mentioned" opens the dog's card).
6. The user's profile shows their level, lifetime stats, and a small live diorama of the dog hanging out in a pixel-art park scene with day/night, drifting clouds, ambient birds — pure delight, no functional purpose.

## Features

### Map view
- Full-screen city map with a custom muted style.
- User position dot.
- Animated companion that walks / runs / sniffs / sits / lies down with realistic motion.
- Paws (small reward, frequent, denser around parks) and bones (larger reward, in parks). Auto-collected.
- Lost-pet pins coloured by urgency.
- Spot pins (cafés, vets, pet stores, parks) with on/off toggle.
- Top of screen: small frosted-glass status pills (happiness, hunger, paws collected, spots toggle).
- Bottom: 5-tab dashboard (Map, Quests, Chat, Spots, Profile).

### Lost pets
- A scraper pulls listings hourly from OLX (the popular Ukrainian classifieds). The architecture should accommodate Telegram + Facebook scrapers as a phase-2 — those will be wired later but you don't need to ship them now.
- Each listing becomes a pinned pet on the map with a photo, urgency tier, last-known location, reward.
- Tap → photo-first detail sheet with prev/next navigation between nearby pets (chevrons + swipe).
- "I've seen them" updates the pin's location.
- "Start search" begins a 3-waypoint quest with AI-generated clues.

### Search quests
- Three walking waypoints near the pet's last location.
- AI (Claude Haiku — see below) generates clues at quest start, one model call.
- User walks to each waypoint; reaching one reveals the next clue.
- Completing all three awards points.
- Search radius grows with how long the pet has been missing.

### The dog companion
- Pixel-art sprite (we have a licensable asset pack — "8-Bit Dogs" by 14collective, white-with-spots variant).
- Seven animation states: walk, run, sit, lie, sniff, jump, crouch.
- Follows the user with realistic pursuit behaviour. Runs after far rewards, sniffs after collecting one, sits when idle, lies down after a long pause.
- A radial menu opens on tap with two-deep drilldowns: walk → roundtrip/oneway → close/far; visit → category → specific spot.
- Walks plot real walking polylines from Google Directions and fit-to-screen.

### Chat
- Real conversation with the companion in Ukrainian. Lowercase, dog-like, friendly.
- Powered by an LLM (we use Claude Haiku — happy to discuss alternatives).
- The companion **takes real actions** in response to chat. Replies can include structured action tags that the client parses out of the message and dispatches to the same handlers the on-screen UI uses (start a walk, open a pet's card, begin a search, etc.). Same code path, no duplication.
- The companion **remembers** across sessions — periodically summarises recent chats into a short note that's injected into the system prompt next time.

### Profile (and the live dog scene)
- Companion identity (name, level, XP bar, mood meters).
- Lifetime stats (days played, distance walked, paws, bones, points, pets searched).
- A **live pixel-art diorama at the top**: parallax backdrop with sky, trees, a lamppost, a bench, drifting clouds. Day/night theming auto-derived from the user's local hour (sun by day, moon + stars + lit lamppost cone at night). Ambient events drift through every 6–14 seconds: bird flocks (with flapping wings) by day, bats and fireflies at night. Tapping the dog → a bark bubble + a random reaction pose (jump / crouch / sit). The user can tap the background to manually toggle day/night.

### Quests tab
- Daily tasks (5 small loops, midnight reset): collect paws, feed bones, check pets, visit a spot, report a sighting.
- Lost pets nearby — sorted by distance, tap-to-open with prev/next.
- Past searches (collapsible).

### Spots tab
- Filter chips by category (café / eat / drink / pet shop / vet) with counts.
- List of nearby spots with rating.
- Tap → "Walk here" plots the route.
- Filter selection persists when the user navigates back to the map.

### "Phone in pocket" walks
- Most users will lock the phone and walk. The app should **still credit them** for distance covered.
- This works by sending the user's positions to the server periodically, and the server sweeps the line between consecutive positions — any in-game items along that line get credited.
- Includes basic anti-cheat (jumps over 5 km treated as teleport, items don't spawn inside the auto-collect bubble).
- This architecture should port cleanly to native (iOS Significant Location Changes + Android geofences) for the eventual native app.

### PWA
- Installable as standalone app on iOS + Android.
- Custom app icon, splash screen, theme colour.
- Respects iPhone notch + home-indicator safe areas throughout.

## The vibe

- **Pixel-art, retro, warm.** The companion + game items + profile diorama are 8-bit. The UI chrome is **frosted glass** — soft, modern, layered.
- **Tone:** the companion writes in lowercase Ukrainian, dog-like, friendly, mix of plain speech + *italic action notes* (`*sniff sniff*`, `*tail wag*`) + woof sounds.
- The product should feel like a charming companion app you'd want to open on a walk, not a utility you have to use. Think more "tamagotchi meets walking buddy" and less "Uber for pets".
- **Custom hand-drawn icon set** replaces emoji where it matters most — HUD pills, tab bar, map markers, profile meters. Studio sources via Flaticon Premium or commissions; we cover the license cost.
- **Microcopy is friendly but not infantilising.** Bug states say "couldn't find that one — try again" not "Oh no! 🥺".

## What's out of scope (v1)

We are **not** asking for any of these in this build:

- Native iOS or Android apps. Web-only pilot. Codebase should be reasonably portable later, but the port itself is a separate phase.
- Push notifications.
- Other walkers visible on the map (multi-player).
- Multiple dog skins / character variants — single dog only.
- User photo upload from sightings.
- Telegram + Facebook scrapers actually running (the architecture should accommodate, but they'll be wired up later when we have the right secrets).
- Multi-city. Kyiv only — but we'd like the city to be a single configuration point so we can extend later.
- Admin web UI. Direct database access is fine for the pilot.
- Any language other than Ukrainian in the UI.
- Payments / subscriptions / monetisation.

## Tech expectations

We're **not the tech team** — you choose the stack. A few constraints to be aware of:

- We want a **single codebase that can later be ported to native iOS + Android** without a rewrite. React Native + Expo is the obvious answer but we're open to alternatives if you have a strong reason.
- The product is **free** in pilot. Whatever you choose, infrastructure cost at 100–500 daily active users should fit comfortably in free / hobby tiers (think Vercel hobby, a small Fly.io machine, Supabase free / pro, an Upstash free tier).
- We need **Postgres with geographic queries** (PostGIS or equivalent) for the lost-pet location data.
- The AI integration uses **Claude Haiku** (Anthropic) for the chat companion + waypoint clue generation + memory summarisation. We're open to other LLMs if you make a case.
- Maps: **Google Maps JS API** for web, with custom styling. Walking routes from Directions API.
- Code lives in **GitHub** in our org (we'll provide access).
- **Pilot scale:** 100–500 daily active users, 200–500 active lost-pet listings.

Beyond that: pick what your team is fastest in.

## Timeline

We're aiming for a **~3-month calendar window** from kick-off to production launch. We're flexible by ±2 weeks. Suggested milestones:

- ~Month 1: foundation, map view, companion follows user, paws + bones, basic walk loop.
- ~Month 2: lost-pet pipeline, search quests, chat with action dispatch, profile + live dog scene.
- ~Month 3: remaining tabs, custom icons, performance, PWA polish, cross-device bug bash.

End of month 1 = first internal demo (you can walk and the dog chases paws). End of month 2 = feature-complete. Month 3 = polish.

## What we provide

- GitHub org access.
- All accounts: domain, hosting, database, AI, maps API. We pay all infrastructure + AI costs during the build.
- The dog sprite pack (commercial-use license).
- Curated Kyiv parks dataset (GeoJSON).
- Brand assets (name, logo, palette).
- A Ukrainian-speaking product owner on our side for tone review on every microcopy decision.
- Weekly 1-hour sync; async Slack during Kyiv business hours.

## What we want in your proposal

1. **Total fixed budget** (EUR or USD, VAT treatment specified).
2. **Phase-by-phase breakdown** of cost + duration.
3. **Team roster** — named people, seniority, FTE per phase.
4. **Stack choices** + a sentence each on why.
5. **Two reference projects** at similar scope, with live URLs.
6. **Risks** you see in the brief + how you'd mitigate them.
7. **Estimated monthly infrastructure cost** at 100 / 1,000 / 5,000 daily active users (so we can plan post-launch).
8. **Your QA approach** — manual passes, automated tests, accessibility audit.
9. **Clarifying questions** — these tell us as much about your team as your reference work does.
10. **Day rates** for any post-pilot extension work.

## How we evaluate

In rough order of weight:

1. Reference work quality.
2. Realistic, specific budget + timeline (we discount unrealistically low quotes as inexperience).
3. Sharpness of the clarifying questions.
4. Cultural fit — async-friendly, English-fluent tech lead, Kyiv time-zone overlap, weekly-ship cadence.
5. Stack judgement — what you chose and why.
6. Total cost.

## Submission

PDF or Notion link to **[email]** by **[date]**. Shortlisted studios get a 30-min intro call the following week. Contract awarded by **[date + 4 weeks]**.

---

*Not a binding agreement. Selected studio signs a formal SOW derived from their accepted proposal.*
