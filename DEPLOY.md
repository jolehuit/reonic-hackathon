# Deploy Iconic to Google Cloud Run

The repo ships a multi-stage Dockerfile + `output: 'standalone'` so the
container boots a self-contained Next server with Chromium pre-installed
under `/app/.cache/ms-playwright` (needed by `/api/aerial?tilted=1`).

Live URL once mapped: **https://iconic.haus**

## Prereqs

- `gcloud` CLI installed + authenticated (`gcloud auth login`)
- A GCP project with billing enabled + Cloud Run, Cloud Build and Artifact
  Registry APIs enabled:

  ```bash
  gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com
  ```

## Env vars to set in Cloud Run

Required:

```
FAL_KEY=...                              # fal.ai API key (Hunyuan + GPT Image 2)
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
gcloud run deploy iconic \
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
- `--cpu 2` — Playwright spawns faster with 2 vCPU; 1 vCPU works but cold
  start is ~2× slower.
- `--timeout 600` — our slowest route (`/api/trellis` with Hunyuan 3D Pro)
  can take 90-120s. 600s gives plenty of headroom.
- `--concurrency 10` — each instance can serve up to 10 simultaneous
  requests. Tune down if Chromium memory pressure becomes an issue.
- `--min-instances 0` — scale to zero when idle (no cost). Bump to 1 if
  you want zero cold starts (~$5/mo for the always-warm instance).
- `--allow-unauthenticated` — public endpoint. ⚠ this means anyone hitting
  the URL can burn your fal.ai credits. For a real deploy add Cloud Armor
  rate limits or basic IAM auth.

First deploy takes ~5 min (Cloud Build pulls the image, runs `pnpm install`,
`next build`, and `playwright install chromium`). Subsequent deploys reuse
cached layers and complete in ~1-2 min if only source changed.

## Custom domain — iconic.haus

Cloud Run can map a custom domain via the `domain-mappings` API. Two paths
depending on whether you want apex (`iconic.haus`) AND `www.iconic.haus`:

### Step 1 — verify the domain (one-shot per GCP user account)

If you've never proven domain ownership to Google in this account:

```bash
gcloud domains verify iconic.haus
```

This opens the Google Search Console verification flow in a browser. Add
the TXT record it gives you to the registrar's DNS, wait a couple minutes,
then click "Verify" in the browser.

### Step 2 — create the domain mappings

```bash
# Apex
gcloud beta run domain-mappings create \
  --service iconic \
  --domain iconic.haus \
  --region europe-west1

# www subdomain (optional but recommended)
gcloud beta run domain-mappings create \
  --service iconic \
  --domain www.iconic.haus \
  --region europe-west1
```

Each command prints the DNS records you need to add at the registrar. They
look like:

```
For iconic.haus:
  A     216.239.32.21
  A     216.239.34.21
  A     216.239.36.21
  A     216.239.38.21
  AAAA  2001:4860:4802:32::15
  AAAA  2001:4860:4802:34::15
  AAAA  2001:4860:4802:36::15
  AAAA  2001:4860:4802:38::15

For www.iconic.haus:
  CNAME ghs.googlehosted.com.
```

Set those records in your registrar's DNS panel. Propagation is usually
< 10 min for Cloudflare/Namecheap, can take up to a few hours on slower
registrars. Cloud Run auto-provisions a Let's Encrypt cert as soon as DNS
resolves correctly.

### Step 3 — verify

```bash
gcloud beta run domain-mappings describe \
  --domain iconic.haus \
  --region europe-west1
```

The `status` field flips to `READY` once the TLS cert is issued. Then
https://iconic.haus serves the Iconic app.

## Continuous deployment (optional)

Two ways to auto-deploy on every push to `main`:

**A) Cloud Run console — one-click**
Open the service in the console → "Setup Continuous Deployment" → connect
the GitHub repo → branch `main` → build type "Dockerfile" → save. Done.
No file in the repo, GCP triggers a Cloud Build on each push.

**B) GitHub Action**
Add a `.github/workflows/deploy.yml` with `google-github-actions/deploy-cloudrun`.
Requires a service account JSON in GitHub Secrets (`GCP_SA_KEY`) or
Workload Identity Federation for the cleaner setup.

## Local sanity check

Build + run the same image locally before pushing:

```bash
docker build -t iconic .
docker run -p 8080:8080 \
  -e FAL_KEY=... \
  -e GOOGLE_MAPS_API_KEY=... \
  -e GOOGLE_GENERATIVE_AI_API_KEY=... \
  -e NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=... \
  iconic
```

Then curl `http://localhost:8080/api/health` to verify boot.
