# Multi-stage build for the going-bridge Cloud Run Job.
# Mirrors workers/cortex-coach/Dockerfile.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/going-bridge/package.json workers/going-bridge/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/going-bridge...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/going-bridge/ workers/going-bridge/

RUN pnpm --filter @mycortex/going-bridge build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/going-bridge/dist  ./workers/going-bridge/dist
COPY --from=build /repo/workers/going-bridge/package.json ./workers/going-bridge/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/going-bridge...

WORKDIR /app/workers/going-bridge
CMD ["node", "dist/index.js"]
