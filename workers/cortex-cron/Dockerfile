FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY workers/cortex-cron/package.json workers/cortex-cron/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile --filter @mycortex/cortex-cron...

COPY workers/cortex-cron/ workers/cortex-cron/
RUN pnpm --filter @mycortex/cortex-cron build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

COPY --from=builder /repo/workers/cortex-cron/dist ./dist
COPY --from=builder /repo/workers/cortex-cron/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
