# Multi-stage build for the Fastify API.
# Build from repo root: `fly deploy` (uses /fly.toml + this Dockerfile).
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# 1. Copy just manifests first so layer caching works on source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
RUN pnpm install --frozen-lockfile --filter @shukajpes/server...

# 2. Source + build.
COPY shared ./shared
COPY server ./server
RUN pnpm --filter @shukajpes/server build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# With node-linker=hoisted all runtime deps live in /repo/node_modules.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/server/migrations ./migrations
COPY --from=build /repo/server/package.json ./package.json

EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
