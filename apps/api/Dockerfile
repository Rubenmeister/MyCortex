# Multi-stage build for the MyCortex api on Cloud Run.
#
# Stage 1 (deps): install only what the api needs from the workspace, with
#   the lockfile, in a pnpm-aware way. Cloud Run images are pulled cold often
#   so we keep the runtime layer minimal.
# Stage 2 (build): compile TypeScript to dist/.
# Stage 3 (runtime): node:22-alpine + just dist/ + production node_modules.

# ---------- Stage 1: deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

# Copy workspace manifests first for cache friendliness
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

# Install all deps so we can build (we'll prune dev deps in runtime stage)
RUN pnpm install --frozen-lockfile --filter @mycortex/api...

# ---------- Stage 2: build ----------
FROM deps AS build
WORKDIR /repo

# Copy sources
COPY packages/ packages/
COPY apps/api/ apps/api/

# Compile
RUN pnpm --filter @mycortex/api build

# ---------- Stage 3: runtime ----------
FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run injects PORT (default 8080). Our server listens on 0.0.0.0:$PORT.
ENV HOST=0.0.0.0

# Copy the built dist + workspace package metadata
COPY --from=build /repo/apps/api/dist                ./apps/api/dist
COPY --from=build /repo/apps/api/package.json        ./apps/api/
COPY --from=build /repo/packages/                    ./packages/
COPY --from=build /repo/pnpm-workspace.yaml          ./
COPY --from=build /repo/pnpm-lock.yaml               ./
COPY --from=build /repo/package.json                 ./
COPY --from=build /repo/.npmrc                       ./

# Production-only install (workspace-aware)
RUN pnpm install --prod --frozen-lockfile --filter @mycortex/api...

WORKDIR /app/apps/api

# Cloud Run health check hits /health
EXPOSE 8080
CMD ["node", "dist/index.js"]
