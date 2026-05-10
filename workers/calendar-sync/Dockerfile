# Multi-stage build for the calendar-sync Cloud Run Job.

FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY workers/calendar-sync/package.json workers/calendar-sync/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/cortex-engine/package.json packages/cortex-engine/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
COPY packages/config-eslint/package.json packages/config-eslint/

RUN pnpm install --frozen-lockfile --filter @mycortex/calendar-sync...

FROM deps AS build
WORKDIR /repo

COPY packages/ packages/
COPY workers/calendar-sync/ workers/calendar-sync/

RUN pnpm --filter @mycortex/calendar-sync build

FROM node:22-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /repo/workers/calendar-sync/dist  ./workers/calendar-sync/dist
COPY --from=build /repo/workers/calendar-sync/package.json ./workers/calendar-sync/
COPY --from=build /repo/packages/                 ./packages/
COPY --from=build /repo/pnpm-workspace.yaml       ./
COPY --from=build /repo/pnpm-lock.yaml            ./
COPY --from=build /repo/package.json              ./
COPY --from=build /repo/.npmrc                    ./

RUN pnpm install --prod --frozen-lockfile --filter @mycortex/calendar-sync...

WORKDIR /app/workers/calendar-sync
CMD ["node", "dist/index.js"]
