# Multi-stage build for the cortex-cron Cloud Run Job.
# Pattern mirrors apps/api/Dockerfile — cache-friendly deps, prod-only runtime.

# ---------- Stage 1: deps ----------
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/cortex-cron/package.json workers/cortex-cron/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/cortex-cron...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/cortex-cron/ workers/cortex-cron/

RUN pnpm --filter @mycortex/cortex-cron build

# ---------- Stage 3: runtime ----------
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/cortex-cron/dist  ./workers/cortex-cron/dist
COPY --from=build /repo/workers/cortex-cron/package.json ./workers/cortex-cron/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/cortex-cron...

WORKDIR /app/workers/cortex-cron
CMD ["node", "dist/index.js"]
