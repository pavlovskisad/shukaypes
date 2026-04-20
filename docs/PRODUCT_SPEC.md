# V1 Product Specification — шукайпес

> This is a summary for quick reference. The canonical source is `shukajpes-product-doc.docx`.

---

## AI Companion Architecture

The companion is a full LLM agent powered by Claude API. It's the interface, not a chatbot embedded in one.

### Prompt Assembly (4 layers per API call)

| Layer | Size | Persistence | Content |
|-------|------|-------------|---------|
| Core personality | ~600 tokens | Static | Voice, character rules, response format |
| User memory | ~300–500 tokens | Persistent, evolving | Preferences, inside jokes, walking habits |
| Interaction context | ~400–800 tokens | Fresh each call | GPS, POIs, lost dogs, spots, walkers, quests |
| Action schema | ~300 tokens | Static | Structured output format for map actions |

Total: 1,600–2,200 tokens/call. Target response time: under 2 seconds.

### Companion Modes

**Passive:** Follows user on map, auto-collects tokens, ambient messages (max 1 per 2 min, 10 per session). Silence is valid.

**Active:** User taps companion or opens chat. Full context read (GPS, POIs, lost dogs, history, time, weather). Can trigger actions: start quest, set waypoint, highlight spot, collect reward.

### Personality
- Name in V1: шукайпес
- Adapts to user's communication style over time
- Short, lowercase, spoken-feel text
- Never says "as an AI," never lectures, never uses bullet points
- Can be meta/self-aware for humor

### Pet Knowledge Layer
The companion doubles as a pet advisor with curated veterinary knowledge:
- Breed traits, nutrition, training, behavior interpretation
- Health triage ("my dog ate chocolate" → calm, breed-aware guidance)
- Emergency guidance with nearest vet routing
- Creates 24/7 retention — useful at midnight on the couch

---

## Companion Interaction UX

### Radial Menu (Tap Companion)

**Primary:** Quest, Chat, Feed, Stats
**Secondary (context):** Search (near lost dogs), Spot (near partners), Social (near walkers)

### Hunger & Happiness

| Meter | Emoji | Decay | Refill |
|-------|-------|-------|--------|
| Hunger | 🦴 | Slow over time | Bones/treats, tokens |
| Happiness | ☀️ | Through neglect | Walking, quests, social, feeding |

No punishment. Low hunger = sleepy. Low happiness = quiet. Gentle pull, no anxiety.

---

## Quest System

- **Detective Quests**: AI-generated narrative from real lost dog data with waypoints
- **Errand Routes**: User says needs → AI chains partner spots, routes through search zones
- **Exploration Walks**: AI generates novel routes avoiding previously walked areas
- **City Quests**: Educational walks with local history/culture (V1 feature)
- **Social Walks**: See other walkers, poke/wave interactions

---

## The Invisible Search Layer

Token density, errand routes, companion food, and photo pop-ups all route users through search zones. Most users don't know they're searching. The reward distribution IS the search coordination layer.

---

## Lost Dog Pipeline

**Primary**: Auto-scraping (Telegram, Facebook, forums, shelters, municipal registries)
**Secondary**: In-app reporting (conversational flow through companion)
**Photo pop-ups**: Any user near search zone sees lost dog photo + "I've seen this dog" button

---

## Skin System (Behavior-Gated)

Detective, Explorer, Hero (found a real dog), Social, Seasonal. Visible to other users on map.

---

## Partner Spots

Pull model. $50–200/month. Real discounts with points. No intrusive ads. Integrated into errand routes.

---

## Tech Stack & Costs

React Native + Google Maps SDK + Claude API (Sonnet active, Haiku ambient) + Node.js + PostgreSQL + Redis.
API cost per session: $0.04–0.06 pilot, $0.02–0.03 at scale.

---

## V1 Scope

Everything above ships in pilot. V2 adds: visual evolution, IAP, multi-language, global launch. Post-launch: companion room, minigames, data insights B2B.
