# MyCortex — Deploy v1

End-to-end runbook for taking MyCortex from local to production. Stack:

- **api** → Google Cloud Run (HTTP service, always-on)
- **web** → Vercel (Next.js)
- **cortex-cron** → Google Cloud Run Job + Cloud Scheduler
- **mobile** → Expo EAS (separate flow, see `apps/mobile/eas.json` when ready)

Estimated time: ~2 hours of clicking + waiting, ~30 min of typing.

---

## 0. Prerequisites

- GCP account with billing linked
- Vercel account (free tier is fine)
- A new GCP project (we'll create it: `mycortex-prod`)
- gcloud CLI installed and authenticated (`gcloud auth login`)

---

## 1. Bootstrap GCP project

```bash
# Create project
gcloud projects create mycortex-prod --name="MyCortex Prod"

# Link billing (replace with your billing account ID)
gcloud beta billing projects link mycortex-prod \
  --billing-account=<YOUR_BILLING_ACCOUNT_ID>

# Set as active
gcloud config set project mycortex-prod

# Enable APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

---

## 2. Create Artifact Registry repo

```bash
gcloud artifacts repositories create mycortex \
  --repository-format=docker \
  --location=us-east1 \
  --description="MyCortex container images"
```

---

## 3. Service accounts

```bash
# api SA
gcloud iam service-accounts create mycortex-api-sa \
  --display-name="MyCortex API"

# cron SA
gcloud iam service-accounts create mycortex-cron-sa \
  --display-name="MyCortex Cortex Cron"

# Both need Secret Manager access
for SA in mycortex-api-sa mycortex-cron-sa; do
  gcloud projects add-iam-policy-binding mycortex-prod \
    --member="serviceAccount:$SA@mycortex-prod.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done

# Cron SA also needs to invoke its own job (for Cloud Scheduler)
gcloud projects add-iam-policy-binding mycortex-prod \
  --member="serviceAccount:mycortex-cron-sa@mycortex-prod.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

---

## 4. Secrets

```bash
# Create the secrets (read values from local apps/api/.env if you have them)
echo -n "<OPENAI_KEY>"     | gcloud secrets create mycortex-openai          --data-file=-
echo -n "<ANTHROPIC_KEY>"  | gcloud secrets create mycortex-anthropic       --data-file=-
echo -n "<SUPABASE_SVC>"   | gcloud secrets create mycortex-supabase-service --data-file=-
```

---

## 5. Build + deploy api

```bash
cd C:\Users\USER1\MyCortex
gcloud builds submit . \
  --config=apps/api/cloudbuild.yaml \
  --substitutions=_REGION=us-east1,_SERVICE=mycortex-api
```

After the first deploy, wire env + secrets:

```bash
gcloud run services update mycortex-api \
  --region=us-east1 \
  --update-env-vars="^|^NODE_ENV=production|SUPABASE_URL=https://ifsdhwihdjrogebsutem.supabase.co|SUPABASE_ANON_KEY=sb_publishable_LbMt0RlbJfDcgTZSF49Wsg_WKvFSd6K|LOG_LEVEL=info" \
  --update-secrets=OPENAI_API_KEY=mycortex-openai:latest,ANTHROPIC_API_KEY=mycortex-anthropic:latest,SUPABASE_SERVICE_ROLE_KEY=mycortex-supabase-service:latest
```

Smoke test:

```bash
API_URL=$(gcloud run services describe mycortex-api --region=us-east1 --format='value(status.url)')
curl $API_URL/health
```

Expected: `{"status":"ok","uptime":...}`.

---

## 6. Build + deploy worker

```bash
gcloud builds submit . \
  --config=workers/cortex-cron/cloudbuild.yaml \
  --substitutions=_REGION=us-east1
```

Wire env + secrets:

```bash
gcloud run jobs update cortex-cron \
  --region=us-east1 \
  --update-env-vars="SUPABASE_URL=https://ifsdhwihdjrogebsutem.supabase.co" \
  --update-secrets=OPENAI_API_KEY=mycortex-openai:latest,ANTHROPIC_API_KEY=mycortex-anthropic:latest,SUPABASE_SERVICE_ROLE_KEY=mycortex-supabase-service:latest
```

Schedule (every 6 hours, Ecuador time):

```bash
gcloud scheduler jobs create http cortex-cron-trigger \
  --schedule="0 */6 * * *" \
  --uri="https://us-east1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/mycortex-prod/jobs/cortex-cron:run" \
  --http-method=POST \
  --oauth-service-account-email=mycortex-cron-sa@mycortex-prod.iam.gserviceaccount.com \
  --time-zone="America/Guayaquil" \
  --location=us-east1
```

Manual trigger to test:

```bash
gcloud run jobs execute cortex-cron --region=us-east1
```

---

## 7. Deploy web to Vercel

1. Go to https://vercel.com/new → import `Rubenmeister/MyCortex`
2. **Root Directory**: leave at root (Vercel auto-detects via vercel.json)
3. **Framework**: Next.js (auto)
4. **Build Command**: leave default (vercel.json overrides to pnpm filter)
5. **Environment Variables**:
   - `NEXT_PUBLIC_API_URL` = the Cloud Run URL from step 5 (e.g., `https://mycortex-api-xxx-ue.a.run.app`)
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://ifsdhwihdjrogebsutem.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_LbMt0RlbJfDcgTZSF49Wsg_WKvFSd6K`
6. Click **Deploy**

Vercel gives you a `*.vercel.app` URL. The web auto-redeploys on every push to `main`.

---

## 8. Smoke test the production stack

```bash
# Login still works against prod Supabase (same project)
# Web: open the Vercel URL, login with test@mycortex.local / TestPwd1234!
# Try: capture a note, ask a question, check it shows up in Notas
```

---

## 9. Optional: custom domains

- `api.mycortex.app` → Cloud Run domain mapping
- `app.mycortex.app` → Vercel custom domain

Skipping these for v1 since DNS adds 5-30 min wait time and the `*.run.app` /
`*.vercel.app` URLs work identically for now.

---

## Cost ballpark

| Component | Tier | Cost/month |
|-----------|------|-----------:|
| Cloud Run api (min=0, scale-to-zero) | request-based | $0–3 |
| Cloud Run Job cortex-cron | every 6h, ~30s/run | <$1 |
| Artifact Registry | a few GB images | <$1 |
| Cloud Build | ~5 builds/day | <$5 |
| Vercel web | hobby tier | $0 |
| Supabase | free tier | $0 |
| OpenAI + Anthropic | personal use | ~$2-5 |
| **Total** | | **~$5–15/mes** |

Bumps to $30-60 if you put `min-instances=1` on the api (faster cold start).

---

## Rollback

```bash
# api: roll back to previous revision
gcloud run services update-traffic mycortex-api \
  --region=us-east1 --to-latest

# Or to a specific revision:
gcloud run services update-traffic mycortex-api \
  --region=us-east1 --to-revisions=mycortex-api-00012-abc=100

# worker: just redeploy with previous SHA
# web: Vercel keeps every deployment, click "Promote to production" on any
```
