# Lost-pet companion app — v1 brief

**For:** prospective development studios
**From:** the шукайпес team
**Asking for:** a fixed-budget proposal + timeline + your team
**Format:** ~3-page brief, not a tech spec — we want studios to bring the engineering and design judgement.

---

## What we want to build

A **mobile app + companion website** that helps people in Kyiv find lost pets while they're out walking. The hook: a friendly **animated dog companion** lives on a city map, follows the user around, picks up small game-currency rewards as they walk, and surfaces real lost-pet listings from public sources (OLX, Telegram, Facebook). Tapping a missing pet starts a small "search quest" — a few waypoints near where the pet was last seen, with the companion narrating clues at each stop.

The game layer (rewards, levels, daily tasks) is intentional retention design. The actual product is **turning ordinary walks into distributed search coordination** for the lost-pet community.

**Form factor:** native iOS + Android apps + a web companion. **Cities:** Kyiv only. **Languages:** Ukrainian + English UI.

## Who it's for

- Kyiv resident, 18–45, smartphone-first.
- Walks regularly (with or without a pet).
- Cares about the pet-loss community or just enjoys a charming app on a walk.
- Acquisition is handled separately by us; you don't need to design for that.

## The user journey

1. User installs the app on their phone or visits the website.
2. They see a map of Kyiv with their position, an animated dog companion, and pinned missing pets.
3. As they walk, the companion auto-collects little rewards along the way; their distance counts even with the phone in their pocket.
4. They tap a missing pet, see its photo and where it was last seen, and start a small search.
5. The app sends them through a few waypoints near where the pet was last seen; the companion narrates AI-generated clues at each stop.
6. Reaching the end of the search awards points and progress.
7. They can chat with the companion in Ukrainian or English; it actually does things in response (starts walks, opens pets, starts searches).
8. Their profile shows level, lifetime stats, and a small live diorama of the dog hanging out.
9. **They can upload a photo of their own dog** and the app generates a personalised pixel-art version to use as their companion.
10. **They can see other walkers nearby on the map** — privacy-respecting, opt-in. Turns the lonely walk into a quiet co-op game.
11. **Push notifications** alert them when a new lost pet appears nearby or a clue in their active search is ready.

## Features

### Map view
- Full-screen city map.
- The user's position + their animated dog companion that follows them with realistic motion.
- Game rewards scattered around (one common, one rarer, with denser clusters near parks). Auto-collected as the user walks past.
- Lost-pet pins coloured by urgency (urgent / recent / older).
- Spot pins for cafés, vets, pet stores, parks. Toggleable.
- Other walkers' companions visible nearby (opt-in).
- Status indicators at the top (mood, hunger, paws collected, layer toggle).
- A small navigation strip at the bottom with the main app surfaces.

### Lost pets
- Three sources running in production: OLX, Telegram, Facebook. We provide credentials + curated channel/group lists.
- Each listing becomes a pinned pet with photo, urgency, last-known location, reward.
- Tap → a detail sheet, photo first.
- "I've seen them" updates the pin's location.
- "Start search" begins a quest with AI-generated clues.

### Search quests
- A few walking waypoints near the pet's last location.
- AI generates clues at quest start.
- User walks to each waypoint; reaching one reveals the next clue.
- Completing the search awards points.
- Search radius grows the longer the pet has been missing.

### The dog companion
- Pixel-art aesthetic. We have a base-character licensable asset pack we'll provide.
- Realistic animation states (walking, running, sniffing, idle, etc.).
- Realistic pursuit + behaviour while following the user.
- Natural quick-action menu accessible from the companion sprite, two levels deep — for things like "let's walk somewhere close" or "let's visit a café".

### Character variants + photo-to-pixel-dog engine
- A gallery of dog skins (different breeds, colours, accessories) the user can pick from.
- A **personal-dog upload flow:** the user uploads a photo of their real dog → the app generates a personalised pixel-art version that fits the rest of the visual style. Recognisable as their dog. Studio proposes the technical approach — open-source pipeline, paid API, custom — we don't dictate it.

### Chat
- Real conversation with the companion in Ukrainian or English (auto-detected, manual toggle available).
- Powered by an LLM.
- The companion **takes real actions** in response to chat — same handlers the on-screen UI uses, so "let's walk to that café" actually plots a real walk.
- The companion **remembers** across sessions, so it can reference previous walks and pets.

### Profile + live dog scene
- Companion identity (name, level, mood).
- Lifetime stats (days played, distance walked, rewards collected, pets searched, etc.).
- A small live animated scene of the dog hanging out — visible delight, no functional purpose. Studio proposes the form.

### Quests tab
- Daily tasks (small loops with a midnight reset).
- Lost pets nearby (sorted by distance, tap-to-open).
- Past searches.

### Spots tab
- Filter by category. List nearby spots with category, name, rating.
- Tap → walk-here primary action.
- Filter selection persists across the app.

### Multiplayer / co-op presence
- Other walkers' companions visible on the map (opt-in, default off).
- Approximate position only — privacy-respecting, not real-time precise tracking.
- Tap → simple acknowledgement / "wave" interaction (no direct messaging in v1).

### Push notifications
- Web push (web) + native push (iOS / Android).
- Triggers: new pet appears near you, search clue ready, daily-task reminder (opt-in), nearby-walker activity (opt-in).
- One-tap subscription flow at a natural moment in the user journey.
- Per-trigger-type opt-out in settings.
- Throttled to avoid spam.

### "Phone in pocket" walks
- The walker locks their phone and just walks — the app still credits them for distance covered and rewards passed.
- Includes basic anti-cheat (teleport detection, etc.).

### Payments + subscriptions
- **Free tier:** the full search-and-walk loop, the base companion + default skins.
- **Pro tier (~€2–3 / month):** photo-to-pixel-dog upload, premium skin pack, larger daily-task pool, point multiplier, priority alerts, early access to new features.
- Standard subscription setup: web payments + iOS in-app + Android in-app.
- Cancel anytime, manage from profile.
- No paywall on the search-coordination utility — finding lost pets is always free.

### Admin web UI
- Simple authenticated dashboard for us (the team) to manage the system.
- Manually add / edit / resolve lost-pet listings.
- Moderate user-reported sightings.
- Global stats (DAU, source health, pet volume, completed searches).
- Trigger scraper runs manually.
- Single-admin auth is fine (no roles / multi-user).

### Mobile app + web
- Native iOS + Android apps in the App Store and Play Store. Background-friendly location handling for the phone-in-pocket flow.
- Web app installable on iOS / Android home screens, opens as standalone (no browser chrome).
- Same codebase across all three so feature work happens once and ships everywhere.

## Submission

PDF or Notion link to **[email]** by **[date]**. Shortlisted studios get a 30-min intro call the following week. Contract awarded by **[date + 4 weeks]**.

---

*Not a binding agreement. Selected studio signs a formal SOW derived from their accepted proposal.*
