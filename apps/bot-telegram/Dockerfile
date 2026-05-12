# Multi-stage build for the bot-telegram Cloud Run service.
# The bot is a long-running HTTP service (webhook mode) — different from
# the workers which are Cloud Run Jobs.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/bot-telegram/package.json apps/bot-telegram/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/bot-telegram...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY apps/bot-telegram/ apps/bot-telegram/

RUN pnpm --filter @mycortex/bot-telegram build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/apps/bot-telegram/dist          ./apps/bot-telegram/dist
COPY --from=build /repo/apps/bot-telegram/package.json  ./apps/bot-telegram/
COPY --from=build /repo/packages/                       ./packages/
COPY --from=build /repo/pnpm-workspace.yaml             ./
COPY --from=build /repo/pnpm-lock.yaml                  ./
COPY --from=build /repo/package.json                    ./
COPY --from=build /repo/.npmrc                          ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/bot-telegram...

WORKDIR /app/apps/bot-telegram
EXPOSE 8080
CMD ["node", "dist/index.js"]
