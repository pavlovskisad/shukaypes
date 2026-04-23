# Transformation Plan — Demo → Production App

> **State as of 2026-04-23:** Phases 1–4 + Phase 5 slices 1–4 are merged to `main`. Map, companion, server-authoritative state, Claude chat proxy, lost-pet pipeline with OLX auto-ingestion, and the first UI surface (pins + zones + modal + pet-photo avatars + wander + SOS beep) are all live at https://shukaypes.vercel.app. See the session-recovery plan at `/root/.claude/plans/dont-worry-sir-we-ll-polished-biscuit.md` for the full PR timeline, lessons, and next-slice queue.

## Target Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React Native + Expo (managed workflow) |
| Map | Google Maps SDK via react-native-maps |
| AI Companion | Claude API — Sonnet for active, Haiku for ambient (via backend proxy) |
| Backend | Node.js (Express/Fastify) + PostgreSQL + PostGIS + Redis |
| Real-time | WebSocket (companion sync, other walkers, tokens) |
| Auth | Firebase Auth |
| Push | Firebase Cloud Messaging |
| Storage | AWS S3 / CloudFlare R2 |
| Language | TypeScript throughout |

---

## V1 Feature Set (Pilot — Months 1–4)

### Core Map
- [ ] Real-time GPS with battery optimization
- [ ] B&W map styling (API stylers, consistent cross-platform)
- [ ] Companion overlay with roaming orbit
- [ ] Token spawning (server-controlled, weighted toward search zones)
- [ ] Food spawning (denser near search zones)
- [ ] POI integration (Google Places)
- [ ] Walking route generation (Directions API)

### Companion AI
- [ ] Claude API via backend proxy (never expose key)
- [ ] 4-layer prompt assembly (personality, memory, context, actions)
- [ ] Sonnet for active chat, Haiku for ambient messages
- [ ] Persistent memory per user (PostgreSQL)
- [ ] Adaptive personality (evolves with user's style)
- [ ] Pet knowledge layer (vet triage, breed info, emergency guidance)

### Quest System
- [ ] Detective quests (AI-generated from real lost dog data)
- [ ] Errand routes (chain partner spots, route through search zones)
- [ ] Exploration walks (novel routes, avoid previously walked areas)
- [ ] City quests (local history/culture at waypoints)

### Game Economy
- [ ] Server-authoritative token collection (anti-cheat)
- [ ] Hunger/happiness with real-time decay
- [ ] Companion growth levels 1–10
- [ ] Daily tasks with rewards
- [ ] Behavior-gated skin system (detective, explorer, hero, social, seasonal)

### Lost Dog Pipeline
- [ ] Scraping: Telegram, Facebook, forums, shelters, municipal registries
- [ ] AI parsing, geocoding, deduplication
- [ ] Search zone generation (expands based on breed + time)
- [ ] In-app reporting (conversational flow)
- [ ] Photo pop-ups near search zones ("I've seen this dog")

### Social
- [ ] Other walkers visible as companion-skin avatars
- [ ] Poke and wave interactions
- [ ] Companion reacts to nearby walkers

### Partners
- [ ] 10–20 spots onboarded manually in Kyiv
- [ ] Integration into errand routes
- [ ] Points redemption for discounts

---

## Migration Phases

### Phase 1: Project Scaffold (Week 1)
- Initialize Expo RN + TypeScript
- Set up React Navigation (bottom tabs matching demo: map, tasks, chat, spots, profile)
- Configure react-native-maps with Google Maps
- Port design tokens (colors, fonts, component styles)
- Set up Zustand store skeleton

### Phase 2: Map & Companion (Weeks 2–3)
- Port B&W map styling
- Implement companion as animated map marker
- Port roaming orbit algorithm (smooth interpolation + sine wobble)
- Implement ring pulse animations (companion + user)
- Port NPC radial menu (primary + secondary)
- Implement speech bubbles
- Token and food markers on map

### Phase 3: Game State (Weeks 3–4)
- Build backend API skeleton
- Token spawning (server-authoritative positions)
- Collection mechanics with proximity validation
- Hunger/happiness system (server state, client display)
- Status bar pill UI (unified hunger/happiness/tokens)
- Daily tasks

### Phase 4: Chat & AI (Weeks 4–5)
- Backend Claude proxy endpoint
- 4-layer prompt assembly
- Chat UI (port from demo)
- Conversation history (PostgreSQL)
- Web search tool integration
- Ambient message system (Haiku, rate-limited)
- Pet knowledge prompt engineering

### Phase 5: Quests & Lost Dogs (Weeks 5–7)
- Scraping pipeline for lost dog data (start with Kyiv sources)
- Search zone generation and management
- Detective quest flow (AI generates waypoints from geography)
- Errand route generation (chain spots, route through zones)
- Exploration walk generation
- City quest content pipeline
- Photo pop-up system

### Phase 6: Social & Polish (Weeks 7–9)
- Real-time walker presence (WebSocket)
- Social interactions (poke, wave)
- Skin system with behavior tracking
- Push notifications
- Onboarding flow
- App store preparation

---

## Data Models

### User
```
id, username, avatar_url, created_at
points, total_tokens, total_distance_km
companion_level, companion_skin, companion_name
hunger, happiness
home_position (lat, lng)
personality_profile (for adaptive AI)
```

### Companion State
```
user_id, name, level, xp, skin_id
hunger (0-100), happiness (0-100)
last_fed_at, last_interaction_at
memory_notes (for Claude prompt)
```

### Token
```
id, type (paw|bone|gold), position (lat, lng)
value, zone_id (nullable)
spawned_at, collected_by (nullable), collected_at
weight (search zone proximity factor)
```

### LostDog
```
id, name, breed, photo_url, emoji
last_seen (lat, lng, at), urgency
search_zone_radius (expands over time)
reward_points, source (scrape|in_app)
status (active|found|expired)
reported_by, sightings[]
```

### Quest
```
id, type (detective|errand|explore|city)
user_id, dog_id (for detective)
waypoints[], current_waypoint
started_at, completed_at
reward_points, narrative_state
```

### PartnerSpot
```
id, name, type, position (lat, lng)
partner_id, discount_type, discount_value
integration_date, analytics{}
```

---

## Architecture Decisions

### Server-Authoritative Game State
Everything that affects points or progression must be validated server-side. Demo runs client-side for simplicity, but production needs:
- Token positions generated server-side
- Collection validated by proximity + rate limiting
- Points balance maintained server-side only
- Hunger/happiness decay on server clock

### AI Cost Management
- Sonnet for active (user-initiated): ~$0.04/session
- Haiku for ambient (system-initiated): ~60% cheaper
- Response caching for common patterns
- Max 1 ambient message per 2 minutes, 10 per session
- Pre-fetch ambient messages during idle time

### Token Distribution as Search Coordination
The token spawning algorithm is the product's core IP. It needs to:
- Weight density toward active search zones
- Route errand paths through zones
- Spawn companion food near priority areas
- Update in real-time as reports come in
- Be invisible to users (no "search zone" labels on map)

### Offline-First Where Possible
- Cache map tiles for recent areas
- Queue collections for sync
- Companion roaming works offline
- Chat requires connection (graceful fallback)

### Battery Optimization
- GPS frequency adapts to movement speed
- Background updates at reduced frequency
- Animations pause when backgrounded
- Proximity checks batched
