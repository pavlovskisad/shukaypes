# шукайпес

AI-powered geo-quest app for dog owners and lovers. "шукайпес" means "search for a dog" in Ukrainian.

The companion dog NPC is the entire interface. Every mechanic doubles as a search-coordination layer for real lost pets. Built from a fully functional single-file HTML prototype (see `reference/shukajpes-demo.html`) into a production React Native app with a Node backend.

## Repo layout

```
app/          Expo RN app (web + iOS + Android). Expo Router.
server/       Node.js / Fastify API. Postgres + Redis in Phase 3.
shared/       TypeScript types used by app and server.
docs/         Product + technical documentation, canonical product doc (.docx).
reference/    Original HTML prototype — read-only, source of truth for UX details.
```

## Quick start

Requires Node 22+, pnpm 10+ (`corepack enable`).

```sh
pnpm install

# API server (port 3000, health check at /health)
pnpm dev:server

# Expo app — web target for pilot iteration
pnpm web
```

Copy `server/.env.example` → `server/.env` and fill in keys.
Copy `app/.env.example` → `app/.env` and fill in `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.

The Anthropic key goes into `server/.env` only. It is never exposed to the client bundle.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Run `tsc --noEmit` across all workspaces |
| `pnpm dev:app` | Start Expo dev server (pick web / iOS / Android) |
| `pnpm dev:server` | Start Fastify with live reload |
| `pnpm web` | Start Expo web only |

## Phases

See `/root/.claude/plans/hello-dear-sir-please-wobbly-marble.md` or `docs/TRANSFORMATION.md` for the full plan.

- **Phase 1** — Scaffold (this commit) ✓
- **Phase 2** — Map + companion overlay with roaming, menus, status bar, tokens
- **Phase 3** — Postgres + PostGIS + Redis, server-authoritative game state
- **Phase 4** — Claude chat via backend proxy with 4-layer prompt assembly
- **Phase 5** — Lost dog pipeline, detective quests, invisible search layer
- **Phase 6** — Social, skins, push, launch prep

## Docs

- `docs/PROJECT_README.md` — project vision
- `docs/PRODUCT_SPEC.md` — V1 product spec
- `docs/TECHNICAL.md` — complete technical documentation of the demo
- `docs/TRANSFORMATION.md` — migration plan: demo → production app
- `docs/CLAUDE_CODE_INSTRUCTIONS.md` — notes for Claude Code sessions
- `docs/shukajpes-product-doc.docx` — canonical product architecture document
