# GCP deployment — Vertex AI + Maps/Places migration

Sendero now ranks Vertex AI first in the chat model cascade
(`packages/agent/src/models.ts` → `directProviderCascade`). Locally this
works the moment you run `gcloud auth application-default login`. On
Vercel it needs a service-account because the ADC file on your laptop
holds user-level OAuth refresh tokens that can't travel into a
serverless bundle.

Project: `project-2dc31fbd-9b74-47d9-8c2` (ADC quota project).
Region: `us-central1` (override with `GOOGLE_CLOUD_LOCATION`).

## Local dev — no extra work

You already ran `setup_adc.sh`. The chat route picks up ADC through
`google-auth-library`, the cascade probes `vertex/gemini-3-flash` first,
and real requests stream over the Vertex endpoint. Nothing else to do
locally.

Env vars added to `.env.local`:
```
GOOGLE_CLOUD_PROJECT=project-2dc31fbd-9b74-47d9-8c2
GOOGLE_CLOUD_LOCATION=us-central1
```

## Vercel — one-time setup (service account)

Vertex AI on Vercel needs a **service account** (not ADC). Takes ~5
minutes in the console.

### 1. Create the service account

In GCP console, with project `project-2dc31fbd-9b74-47d9-8c2` selected:
```
IAM & Admin → Service Accounts → Create service account
  name:  sendero-vercel-vertex
  role:  Vertex AI User        (roles/aiplatform.user)
```

Then *Keys → Add Key → Create new key → JSON*. A file like
`sendero-vercel-vertex-abc123.json` downloads. **Treat it like a
credential** — never commit, never paste in Slack.

### 2. Add it to Vercel

```bash
# From the repo root on your laptop
vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON production
# Paste the full JSON blob when prompted — include the braces.
# Repeat for preview + development envs if you want Vercel previews to hit Vertex too:
vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON preview
vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON development

# And the project + region:
vercel env add GOOGLE_CLOUD_PROJECT production
# → project-2dc31fbd-9b74-47d9-8c2
vercel env add GOOGLE_CLOUD_LOCATION production
# → us-central1
```

Redeploy. The AI SDK's `@google-cloud/vertexai` dep reads
`GOOGLE_APPLICATION_CREDENTIALS_JSON` via `google-auth-library` and
authenticates without needing a file on disk.

### 3. Sanity check after deploy

Hit the chat endpoint from a production browser. Server logs should
show:
```
[chat] using direct:vertex/gemini-3-flash
```
If you see `gateway:` instead, Vertex probing failed — inspect the
`[chat] probe failed for direct:vertex/…` warn line for the reason
(most common: service account missing Vertex AI User role on the
project, or the JSON blob got truncated at paste time).

## Migrating Maps / Places to the same project

Vertex AI and Maps/Places use **different auth**. Vertex uses OAuth
(ADC / service account). Maps/Places uses **API keys**. So the ADC
setup you ran doesn't carry over to Places — you need a new API key
issued from the same project.

### 1. Enable the right APIs in the new project

In GCP console with `project-2dc31fbd-9b74-47d9-8c2` selected:
```
APIs & Services → Enable APIs
  - Places API (New)                 ← used by recommend_restaurants
  - Maps JavaScript API              ← if you embed maps
  - Maps Static API                  ← static-maps share payloads
  - Maps Elevation API               ← elevation_risk_brief
  - Time Zone API                    ← timezone_brief
  - Geocoding API                    ← geocode_trip_stop / street-view
```

### 2. Create a restricted API key

```
APIs & Services → Credentials → Create credentials → API key
  name:               sendero-maps-places
  Application restrictions:
    - HTTP referrers:   *.sendero.travel/*, localhost:3000/*, *.vercel.app/*
    - IP addresses:     (add Vercel egress range if you can't rely on referrer)
  API restrictions:
    Restrict key → select the 6 APIs above.
```

Copy the key. It replaces your existing `GOOGLE_API_KEY` /
`GOOGLE_MAPS_API_KEY` / `GOOGLE_PLACES_API_KEY` everywhere.

### 3. Swap in env

Local:
```
# .env.local — replace existing values
GOOGLE_API_KEY=<new-key>
# GOOGLE_MAPS_API_KEY + GOOGLE_PLACES_API_KEY fall back to GOOGLE_API_KEY
# per packages/sendero-env/src/index.ts — you can delete the older vars.
```

Vercel:
```bash
vercel env rm GOOGLE_API_KEY production       # remove the old key first
vercel env add GOOGLE_API_KEY production      # paste new
# repeat for preview / development if set
```

### 4. Verify

```bash
# Places API (restaurants):
curl -s "https://places.googleapis.com/v1/places:searchText" \
  -H "Content-Type: application/json" \
  -H "X-Goog-Api-Key: $GOOGLE_API_KEY" \
  -H "X-Goog-FieldMask: places.displayName" \
  -d '{"textQuery":"coffee in Barcelona"}' | head -c 300

# Maps Static API:
open "https://maps.googleapis.com/maps/api/staticmap?center=Barcelona&zoom=12&size=400x200&key=$GOOGLE_API_KEY"
```

If either returns a `REQUEST_DENIED` with `API key not valid` or
`This API is not enabled`, revisit step 1 or the restriction list.

## Clerk — keep it separate

Clerk is a standalone SaaS. No dependency on GCP. Your Clerk
publishable / secret keys stay where they are:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
CLERK_SECRET_KEY=ak_…
CLERK_WEBHOOK_SECRET=whsec_…
```
Don't migrate it. There's no billing or quota benefit, and the Clerk
dashboard has no concept of a Google project. The only integration
point where Google creds touch Clerk is the optional "Sign in with
Google" SSO — and that's separate from Gemini / Places / Maps
entirely.

## Cost observability

- Vertex AI: billed per 1M input/output tokens on the Gemini models
  you pick — visible under `Billing → Reports` filtered by the Vertex
  AI service. Same project as Places/Maps now, so you see the whole
  Google spend in one report.
- Maps/Places: billed per call with monthly free tiers (Places: $200
  / mo free, then per-request). Set a budget alert at $50 for the
  first month — catches runaway bugs before they become bills.

## Rollback

If anything goes wrong in prod:
```bash
# Disarm Vertex — cascade falls through to AI Studio / OpenAI / Anthropic.
vercel env rm GOOGLE_CLOUD_PROJECT production
vercel --prod --force
```
The chat probe will skip Vertex entirely within 60s of the rollback
(the in-memory cooldown is already on the code path).
