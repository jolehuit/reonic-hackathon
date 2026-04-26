# Deploy to Google Cloud Run

The repo ships a multi-stage Dockerfile + `output: 'standalone'` so the
container boots a self-contained Next server with Chromium pre-installed
under `/app/.cache/ms-playwright` (needed by `/api/aerial?tilted=1`).

## Prereqs

- `gcloud` CLI installed + authenticated (`gcloud auth login`)
- A GCP project with billing enabled + Cloud Run, Cloud Build and Artifact
  Registry APIs enabled (one-shot: `gcloud services enable run.googleapis.com
  cloudbuild.googleapis.com artifactregistry.googleapis.com`)

## Env vars to set in Cloud Run

Required:

```
FAL_KEY=...                              # fal.ai API key
GOOGLE_MAPS_API_KEY=...                  # Static Maps + Geocoding (server)
GOOGLE_GENERATIVE_AI_API_KEY=...         # Gemini (parse-profile + explain)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...      # Same key, exposed to the browser
                                         # for the address autocomplete
```

Optional:

```
TAVILY_API_KEY=...                       # Live tariff lookup (currently unused)
```

## Deploy

```bash
gcloud run deploy reonic \
  --source . \
  --region europe-west1 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 600 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 5 \
  --allow-unauthenticated \
  --set-env-vars "FAL_KEY=...,GOOGLE_MAPS_API_KEY=...,GOOGLE_GENERATIVE_AI_API_KEY=...,NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=..."
```

Notes on the flags:

- `--memory 4Gi` — Chromium needs ~1 GB resident; 4 GB leaves headroom for
  Three.js scene + concurrent requests.
- `--cpu 2` — Playwright spawns spawn faster with 2 vCPU; 1 vCPU works but
  cold start is ~2× slower.
- `--timeout 600` — our slowest route (`/api/trellis` with Hunyuan 3D Pro)
  can take 90-120s. 600s gives plenty of headroom.
- `--concurrency 10` — each instance can serve up to 10 simultaneous
  requests. Tune down if Chromium memory pressure becomes an issue.
- `--min-instances 0` — scale to zero when idle (no cost). Bump to 1 if you
  want zero cold starts (~$5/mo for the always-warm instance).
- `--allow-unauthenticated` — public endpoint. ⚠ this means anyone hitting
  the URL can burn your fal.ai credits. For a real deploy add Cloud
  Armor rate limits or basic IAM auth.

First deploy takes ~5 min (Cloud Build pulls the image, runs `pnpm install`,
`next build`, and `playwright install chromium`). Subsequent deploys reuse
cached layers and complete in ~1-2 min if only source changed.

## Local sanity check

Build + run the same image locally before pushing:

```bash
docker build -t reonic .
docker run -p 8080:8080 \
  -e FAL_KEY=... \
  -e GOOGLE_MAPS_API_KEY=... \
  -e GOOGLE_GENERATIVE_AI_API_KEY=... \
  -e NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=... \
  reonic
```

Then curl `http://localhost:8080/api/health` to verify boot.
