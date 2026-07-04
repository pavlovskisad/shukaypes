# шукайпес — Pilot Plan (decisions locked)

> The fourth doc in the set, and the one to **execute from**. Read in order:
> 1. **`AUDIT_BRIEF.md`** — architecture & how the system is built.
> 2. **`AUDIT_FINDINGS.md`** — ranked issues with file:line + fixes. **Treat it
>    as the implementation spec** — every `§x.y` ID below points into it.
> 3. **`PILOT_ROADMAP.md`** — product state + the open questions (now closed).
> 4. **this doc** — the answers to those questions and the sequenced plan.
>
> Decided 2026-07-04 in a planning session with the founder. Where any doc
> disagrees with the code, trust the code.

---

## 1. Locked decisions

The roadmap's §4/§7 questions, answered:

| Decision | Choice |
|---|---|
| Audience & size | **Open Kyiv soft-launch** — no closed-cohort stage. |
| Data mode | **Real scraped/ingested data, fully automated** — no human pre-review; compensating controls in §Phase 2. |
| Surface | **Both from day one** — Telegram Mini App + web PWA. |
| Success criteria | Report→sighting loop works (measured) · retention/repeat walks · qualitative delight · a real reunion (stretch) · **social pull** ("why do I get in there") as a maybe-core signal to watch. |
| Social scope for pilot | **Presence + poke as-is.** No new social features in pilot scope; the pilot measures whether the existing loop pulls people. Invites / profiles / search parties = post-pilot (§Phase 5). |
| Bots | **Off** (`MULTIPLAYER_BOTS=0` in `fly.toml`) — authentic social signal over artificial density. |
| Privacy floor | **Presence on by default + visible "hide me" opt-out + in-app privacy note** at first launch. |
| Maps key | Rotation is a **do-now human task** (repo is public; the key in `docs/TECHNICAL.md` / `reference/shukajpes-demo.html` is world-readable today) and a hard launch gate. The git-history purge is **superseded by the fresh-private-repo cut-over** (§Phase 4). |
| Render/MP | No planned render work; the founder continues **polish/UX in parallel** as user-driven PRs that ride along. Multiplayer stays (it's the social bet) but gets no new features during pilot prep. |
| Launch cut-over | **Clean re-launch from a fresh identity**: clean snapshot → new private repo → one-shot deploy to fresh Vercel + Fly services on existing accounts; archive the current public repo. Replaces the history purge — the leaked key and junk blobs never enter the new history. |

**Consequence of the ambitious combo** (open launch + fully automated real
data + both surfaces): several items the roadmap marked "can-wait for a small
pilot" become launch blockers — rate limits, Opus cost gating, presence
consent, a takedown path, and the cheap scale fixes. The phases below reflect
that.

---

## Phase 0 — Do now, human task (not code)

- **Rotate the Google Maps key** in Google Cloud (FINDINGS §1.1/§1.2):
  issue a fresh key, restrict to Vercel origins + Routes API only, set a
  billing budget alert. The cut-over (§Phase 4) doesn't un-publish the old
  repo's history, so rotation can't wait for it. No `git filter-repo` purge
  needed — the fresh private repo supersedes it.

## Phase 1 — Safe to open (security / cost / privacy floor) — launch blockers

1. Strip the key value from the two tracked files: `docs/TECHNICAL.md`;
   delete `reference/shukajpes-demo.html` (380KB artifact, no build role).
2. Rate-limit all mutating routes — `/collect/token`, `/feed`,
   `/collect/path`, `/quests/advance`, `/tasks/tick`, `/poke`, `/sync/map`
   (FINDINGS §2.2 — the plugin is registered `global:false`, so today the
   configured limit applies to nothing).
3. Stop trusting the client `force` flag on reward-bearing actions
   (FINDINGS §2.3). Tap-to-collect was test-only anyway.
4. Opus cost control (FINDINGS §6.2): Opus active chat requires the
   Telegram-signed identity; anon device-id users get the Haiku tier; add a
   global daily spend cap/alarm. Critical because the web surface stays and
   device-id auth is spoofable (§2.1).
5. Presence consent (FINDINGS §2.4): "hide me" toggle (client stops sending
   `mp=1`, server stops writing presence) + a short first-launch privacy note
   covering presence and the republishing of lost-pet posts.
6. Bots off: `MULTIPLAYER_BOTS=0`.
7. Client error tracking (Sentry-equivalent) — open-launch users on
   unmeasured devices; crashes must surface without a human noticing.
8. Cheap hardening while in there: `/stats` behind admin auth (§2.5); photo
   proxy rate-limited + `fileId` validated against `lost_dogs.photo_file_id`
   (§2.6).
9. External uptime monitor on `/health/deep` (§4.1).

## Phase 2 — The core product actually works — the pilot's real content

1. **End-to-end validation on real Kyiv posts** (the roadmap's #1 risk): run
   a batch through the pipeline; measure parse precision/recall (species,
   last-seen location, photo); verify pin placement; submit a sighting;
   confirm the **owner-notification / reunion step actually closes** (open
   unknown — roadmap §8). Fix what breaks.
2. Coverage: wire the right Kyiv `TELEGRAM_CHANNELS` + FB groups (env may be
   empty today); confirm the sources cover the Kyiv lost-pet conversation.
3. Dedupe correctness across reposts + stale-report cleanup (a found pet
   must not linger on the map).
4. Compensating controls for fully-automated ingestion: admin kill switch per
   report, a visible takedown / report-a-problem path, keep the parser's
   contact-info stripping.
5. Prompt-injection hardening (FINDINGS §6.1): wrap scraped text in
   data-not-instructions blocks before it enters the companion's context.

## Phase 3 — Open-launch scale readiness (cheap versions only)

1. Bounding-box pre-filter + composite index on `last_seen_lat/lng` before
   haversine (FINDINGS §3.1 minimum-viable; full PostGIS deferred).
2. Take spawn probing off the 15s hot path: early-return on the Redis
   cooldown gate before any probing queries (FINDINGS §3.2).
3. Measure `/sync/map` latency under a simulated small cohort; raise the DB
   pool if needed.
4. Deferred to §Phase 5: Redis leader lock / second machine (§3.3),
   device-id HMAC (§2.1), `MapView.tsx` refactor (§5.3) — unless metrics
   force them earlier.

## Phase 4 — Clean cut-over, instrument & launch

1. **Fresh-identity cut-over** (once Phases 1–3 are merged and prod-verified
   on the current stack):
   - Export a clean snapshot of the code — fresh `git init` (or tarball
     import) — **excluding** the junk blobs (`8-Bit Dogs.rar`,
     `SHUKAYPES_SVG_ICONS.zip`, `kalam.zip`, the misto76 HTML,
     `reference/shukajpes-demo.html`, the `.docx` — FINDINGS §1.3) and any
     secret values. Design-source assets move to Drive/storage.
   - Push to a **new private repo**; re-create the CI gate
     (typecheck + lint → deploy) there.
   - **Fresh services, existing accounts**: new Fly app (new name/URL) + new
     Vercel project wired to the private repo. Set all env vars fresh (new
     Maps key from Phase 0, Anthropic key, TG bot token, `TELEGRAM_CHANNELS`,
     `MULTIPLAYER_BOTS=0`).
   - Re-point everything that carries the old URLs: Telegram Mini App / bot
     webhook URL, CORS allow-list, Maps-key referrer restrictions, uptime
     monitor, error-tracking DSN.
   - Data: keep-or-fresh per store — lost-pet data can simply **re-scrape**
     into a fresh Postgres (it regenerates hourly); user/game state only
     needs migrating if pre-launch accounts matter (likely not for a fresh
     launch); Redis is ephemeral — fresh is fine.
   - One-shot smoke test of the full loop on the new stack (both surfaces),
     then archive (or make private) the old public repo and decommission the
     old Fly/Vercel apps.
2. Instrument the chosen metrics: ingestion / parse-accuracy dashboard,
   report→view→sniff→sighting funnel, owner-notification count, D1/D7
   retention, presence-encounter + poke counts (the social-pull signal),
   opt-out rate (privacy health).
3. Qualitative channel: in-app feedback + a Telegram feedback group.
4. Launch from the fresh identity: announce in Kyiv dog-owner Telegram
   communities; both surfaces live; watch dashboards + error tracking;
   iterate. Founder's polish/UX PRs continue in parallel throughout — they
   just need to land before the cut-over snapshot.

## Phase 5 — Only if it works

PostGIS proper, spawn decoupling, Redis leader lock + 2nd machine, device-id
auth hardening, `MapView.tsx` refactor, social features round 2 (invites,
profiles, shared search parties — the post-pilot social bets).

---

*Written as the executable handoff from the 2026-07-04 planning session.
`AUDIT_FINDINGS.md` carries the file:line detail for every §-reference here.
Trust the code over every doc, including this one.*
