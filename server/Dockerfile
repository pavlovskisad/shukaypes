# Multi-stage build for the Fastify API.
# Build from repo root: `docker build -f server/Dockerfile .`
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/
RUN pnpm install --frozen-lockfile --filter @shukajpes/server... --filter @shukajpes/shared

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/server/node_modules ./server/node_modules
COPY --from=deps /repo/shared/node_modules ./shared/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared ./shared
COPY server ./server
RUN pnpm --filter @shukajpes/server build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/server/migrations ./migrations
COPY --from=build /repo/server/package.json ./package.json
COPY --from=build /repo/server/node_modules ./node_modules

EXPOSE 3000
# Apply migrations on boot, then start. `|| exit 1` fails deploy on bad migration.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
