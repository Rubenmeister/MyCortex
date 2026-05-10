# Multi-stage build for the drive-sync Cloud Run Job. Mirrors the
# cortex-cron pattern. pdf-parse needs node_modules to be present at
# runtime, so the runtime stage installs prod deps from the bundled
# workspace files.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/drive-sync/package.json workers/drive-sync/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/drive-sync...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/drive-sync/ workers/drive-sync/

RUN pnpm --filter @mycortex/drive-sync build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/drive-sync/dist  ./workers/drive-sync/dist
COPY --from=build /repo/workers/drive-sync/package.json ./workers/drive-sync/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/drive-sync...

WORKDIR /app/workers/drive-sync
CMD ["node", "dist/index.js"]
