FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY shared ./shared
COPY server ./server
RUN cd server && pnpm install --frozen-lockfile=false && pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
