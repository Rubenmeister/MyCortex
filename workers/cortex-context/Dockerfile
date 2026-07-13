# Multi-stage build for the cortex-context Cloud Run Job.
# Mirrors workers/cortex-entities/Dockerfile.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/cortex-context/package.json workers/cortex-context/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/cortex-context...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/cortex-context/ workers/cortex-context/

RUN pnpm --filter @mycortex/cortex-context build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/cortex-context/dist  ./workers/cortex-context/dist
COPY --from=build /repo/workers/cortex-context/package.json ./workers/cortex-context/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/cortex-context...

WORKDIR /app/workers/cortex-context
CMD ["node", "dist/index.js"]
