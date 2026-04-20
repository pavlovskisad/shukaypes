# шукайпес (shukajpes)

**AI-powered geo-quest mobile app for dog owners and lovers.**

The core concept: an AI companion dog NPC *is* the entire user interface. No menus, no search bars, no settings screens. Users open the app and talk to their dog. Everything — quests, navigation, lost dog searches, partner spot visits, social interactions — flows through the companion character on an interactive map.

"шукайпес" means "search for a dog" in Ukrainian.

---

## The Core Innovation

The entire game economy functions as a **search coordination layer for lost pets**. Every mechanic in the game does two jobs at once: keep the player engaged, and put eyes on areas that need them.

The system runs as a four-step pipeline:

1. **Aggregate.** Auto-scrape lost dog reports from social networks, shelters, local groups. Parse with AI, geocode, feed into the system.
2. **Generate.** Each report becomes a story. The AI builds the dog's name, what happened, who's looking, and wraps it into search zones, waypoints, and a quest sequence.
3. **Distribute.** Route coverage through the full game economy. Tokens, errands, companion food, and photo pop-ups move users through areas that need eyes.
4. **Accumulate.** Every report, sighting, and confirmation feeds back. More data, tighter coverage.

### The Invisible Search Layer

Most users don't know they're searching. The reward distribution IS the search coordination layer:

- **Tokens** drop at higher density near search zones. Users in passive auto-collect mode drift toward coverage gaps.
- **Errand routes** pass through search zones when routing users to coffee shops, groceries, or partner spots.
- **Companion food** spawns near priority areas. Users feeding their companion cover search zones through the tamagotchi layer.
- **Photo pop-ups** appear for any user near a search zone — "I've seen this dog" button triggers sighting reports.
- **Detective quests** are the explicit opt-in. The visible layer. Tip of the iceberg.

### Conceptual Parallel: Halter

Halter ($2B valuation, $220M raise led by Founders Fund, March 2026) makes AI-powered collars that route cattle through geographic zones using sound and vibration. шукайпес does the same thing for humans. Our "collars" are game mechanics. Our "vibrations" are token density and companion food spawns. Users opt in because it's fun.

---

## Market Position

The app sits at the intersection of three markets:
- Pet tech ($15–20B, 12–16% CAGR)
- Location-based gaming (Pokémon GO: $8B+ lifetime)
- AI consumer products

No existing product combines all three. шукайпес adds on top of existing pet tech audiences rather than competing with them.

---

## Funding Structure

**Pre-seed ($50K) — 9 months:**
- Months 1–4: Build MVP (companion, tokens, quests, data pipeline, social, skins)
- Months 5–7: Kyiv pilot targeting 500–1,000 MAU
- Months 8–9: Metrics compilation, seed raise preparation

**Seed ($250–400K) — 12–15 months:**
- V2 build: multi-language, IAP, visual evolution, global data pipeline
- Global launch on App Store and Play Store
- Growth to Series A trigger metrics (10K+ MAU, retention curves, found-dog stories)

**Series A ($3–5M)** — after 6+ months of global data across multiple markets.

---

## Team
- **Pav** (technical founder): Builds the product using AI coding tools. Senior dev friends available to consult.
- **Partners**: Handle fundraising and business development.

---

## Repo Contents

- `shukajpes-demo.html` — Fully functional single-file prototype (live Google Maps, live Claude API, all game mechanics)
- `docs/` — Project documentation:
  - `README.md` — This file
  - `TECHNICAL.md` — Complete technical documentation of the demo
  - `TRANSFORMATION.md` — Migration plan: demo → production app
  - `CLAUDE_CODE_INSTRUCTIONS.md` — Instructions for Claude Code sessions
  - `PRODUCT_SPEC.md` — Full V1 product specification
  - `shukajpes-product-doc.docx` — Canonical product architecture document
