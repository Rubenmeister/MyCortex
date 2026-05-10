# Multi-stage build for the gmail-sync Cloud Run Job. Mirrors drive-sync.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/gmail-sync/package.json workers/gmail-sync/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/gmail-sync...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/gmail-sync/ workers/gmail-sync/

RUN pnpm --filter @mycortex/gmail-sync build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/gmail-sync/dist  ./workers/gmail-sync/dist
COPY --from=build /repo/workers/gmail-sync/package.json ./workers/gmail-sync/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/gmail-sync...

WORKDIR /app/workers/gmail-sync
CMD ["node", "dist/index.js"]
