# MyCortex

Personal AI second brain — SaaS-ready Turborepo monorepo.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Lang:** TypeScript end-to-end
- **Backend:** Fastify (modular monolith — Ingesta / Acción / Cortex layers)
- **Web:** Next.js 15 + Tailwind
- **Mobile:** Expo (React Native)
- **Bot:** Telegram webhook
- **AI:** Vercel AI SDK (Claude / GPT-4o / Gemini)
- **DB:** Supabase (Postgres + pgvector)
- **Voice:** OpenAI Whisper
- **Search:** Tavily
- **Infra:** Vercel (web) + Google Cloud Run (api + cron worker)

## Quick start

```bash
pnpm install
pnpm dev
```

## Workspace layout

```
mycortex/
├── apps/
│   ├── api/            # Fastify backend (Ingesta + Acción modules)
│   ├── web/            # Next.js dashboard
│   ├── mobile/         # Expo
│   └── bot-telegram/   # Telegram webhook (thin)
├── packages/
│   ├── ai-core/        # Vercel AI SDK orchestration
│   ├── db/             # Supabase client + generated types
│   ├── shared-types/   # Zod schemas + TS types
│   ├── ui/             # Shared React components
│   ├── config-tsconfig/
│   └── config-eslint/
└── workers/
    └── cortex-cron/    # Capa de Evolución (Cloud Run Job)
```

## Why a modular monolith over microservices

The api is one process with internal modules (`ingesta/`, `accion/`, `cortex/`). Splitting into separate services from day 1 trades 1 deploy for 10, 1 DB pool for 10, and adds gateway + JWT propagation overhead — all costs you don't need until you have a scaling reason. Modules can be extracted later when one genuinely needs to scale independently.

## Common commands

```bash
pnpm dev              # all apps in parallel (Turbo)
pnpm build            # build everything
pnpm lint             # lint everything
pnpm type-check       # tsc --noEmit everywhere
pnpm --filter api dev # run only the api
```
