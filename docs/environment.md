# Environment and provider setup

[Back to README](../README.md) · [Development guide](development.md)

Configure only the providers needed for your work. Start with Supabase and the
app connection values; AI, Maps/Places, and editorial imagery have separate setup.

- [Environment files](#environment-files)
- [Supabase](#supabase)
- [AI planning (Vertex AI)](#ai-planning-vertex-ai)
- [Google Maps Platform and Places](#google-maps-platform-and-places)
- [Editorial imagery](#editorial-imagery)
- [App and deployment values](#app-and-deployment-values)

## Environment files

Copy the relevant example file before starting a local service. The examples are
safe templates and contain no credentials:

| Runtime                                | File                                                                           | Used by                                              |
| -------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| API, Prisma, and local shared services | [`.env.example`](../.env.example) → `.env`                                     | `apps/api` and `packages/db`                         |
| Next.js browser app                    | [`apps/web/.env.example`](../apps/web/.env.example) → `apps/web/.env.local`    | `apps/web`                                           |
| Production database operations         | [`.env.production.example`](../.env.production.example) → `.env.production`    | `pnpm db:migrate:prod` and production reconciliation |
| Local Docker PostgreSQL                | [`docker/local.env.example`](../docker/local.env.example) → `docker/local.env` | Prisma commands against Docker                       |

The API loads the repository-root `.env`. Next.js values belong in
`apps/web/.env.local`; do not assume a root value is available to the browser.
After changing environment variables, restart the affected dev server.

## Supabase

Create or select the project in the [Supabase Dashboard](https://supabase.com/dashboard),
then open the project's **Connect** dialog. The same values are also available
under **Project Settings → API Keys** (for API keys) and **Project Settings →
Database** (for connection strings). Supabase's [API key guide](https://supabase.com/docs/guides/getting-started/api-keys)
explains the current publishable/secret key model.

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` go in the root `.env` for the
  server API.
- `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` go in `apps/web/.env.local` for the
  browser. A publishable key is intended to be public; never put a secret or
  legacy `service_role` key in a `NEXT_PUBLIC_` variable.
- Configure production Site URL, scoped development/preview callbacks, and custom
  SMTP using the [email auth rollout guide](auth/email-auth-rollout.md).
  Keep other applications' redirects; deploy Trove's callbacks before its templates.
- Copy the exact database strings from **Connect** rather than constructing
  them. `DATABASE_URL` is the Supavisor transaction pooler URL on port `6543`
  with `pgbouncer=true` for runtime access. `DIRECT_URL` is the session/direct
  URL on port `5432` for Prisma CLI commands. URL-encode special characters in
  passwords and keep `schema=trove` on both values.
- `SHADOW_DATABASE_URL` is only for an isolated `prisma migrate dev` shadow
  database. It must never point at the shared production database. For a fully
  local database, use `docker/local.env` instead.

The `trove` schema is private and is accessed through the server-side Prisma
client. Do not expose it through Supabase's Data API or add client grants.
For private Storage bucket and policy setup, see
[`ops/supabase/README.md`](../ops/supabase/README.md).

## AI planning (Vertex AI)

AI planning runs only in the API. Set these values in the root `.env` or in the
API deployment's environment, never in `apps/web/.env.local`.

### First-time Google Cloud setup

For service-account credentials, work through these steps in order. For local
Application Default Credentials (ADC), create/select the project and enable the
API first, then use the ADC instructions below with an account that has Vertex AI
access.

1. **Create or pick a Google Cloud project** and copy its ID from the
   [project selector](https://console.cloud.google.com/projectselector/home/dashboard)
   into `GOOGLE_VERTEX_PROJECT`.
2. **Enable the Vertex AI API** (`aiplatform.googleapis.com`) for that project
   from [APIs & Services → Library](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com).
   Skipping this returns `403 … Agent Platform API has not been used in project
… or it is disabled`. Enabling takes a few minutes to propagate.
3. **Create a service account** under
   [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts),
   then grant it the **Vertex AI User** role (`roles/aiplatform.user`) from
   [IAM & Admin → IAM](https://console.cloud.google.com/iam-admin/iam).
   Without the role, authentication succeeds but every request returns
   `403 Permission 'aiplatform.endpoints.predict' denied`. Role grants also
   take a few minutes to propagate.
4. **Create a JSON key** for that service account (**Keys → Add key → Create new
   key → JSON**) and copy two fields _out of the downloaded file_:

   | JSON field     | Environment key              |
   | -------------- | ---------------------------- |
   | `client_email` | `GOOGLE_VERTEX_CLIENT_EMAIL` |
   | `private_key`  | `GOOGLE_VERTEX_PRIVATE_KEY`  |

   `private_key` is the long value beginning `-----BEGIN PRIVATE KEY-----`.
   **It is not `private_key_id`**, the short hex string the console's Keys tab
   displays; pasting that instead fails with
   `error:1E08010C:DECODER routines::unsupported`. Keep the escaped `\n`
   sequences and the surrounding double quotes exactly as they appear in the
   JSON, and never commit the key.

Then restart the API — `tsx watch` does not watch `.env`, so saving the file is
not enough. Verify with `pnpm --filter @trove/api ai:verify`, or check that
`GET /ai/planning-sessions/availability` reports `available`.

The verification command makes one bounded structured-output request and prints
only its result classification, model/provider metadata, timing, and token
counts. It never prints the prompt or generated object.

### Troubleshooting

| Symptom                                                      | Cause                                            | Fix                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------- |
| `configuration_missing`, AI planning disabled in the UI      | No resolvable credentials                        | Set the credential pair (step 4), or use the ADC instructions below  |
| `error:1E08010C:DECODER routines::unsupported`               | `private_key_id` pasted instead of `private_key` | Copy `private_key` from the JSON key file (step 4)                   |
| `403 … API has not been used in project … or it is disabled` | Vertex AI API not enabled                        | Enable `aiplatform.googleapis.com` (step 2), then wait a few minutes |
| `403 Permission 'aiplatform.endpoints.predict' denied`       | Service account has no role                      | Grant **Vertex AI User** (step 3), then wait a few minutes           |
| `configuration_invalid`                                      | Credentials load but Vertex rejects them         | Usually step 2 or 3 above; check the API logs for the underlying 403 |

### Environment keys

| Environment key              | Description                                                                                                                                                                                             | Sample values                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `AI_PROVIDER`                | Provider adapter. Only `vertex` is currently supported.                                                                                                                                                 | `vertex`                                                           |
| `AI_MODEL`                   | Vertex model ID. Gemini 2.5 overrides are no longer supported. Use an available model from [Vertex AI Model Garden](https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/explore-models). | `gemini-3.8-flash` (default), `gemini-<supported-model>`           |
| `GOOGLE_VERTEX_PROJECT`      | Required Google Cloud project ID with Vertex AI enabled. Find it in the [Google Cloud project selector](https://console.cloud.google.com/projectselector/home/dashboard).                               | `trove-prod`, `my-gcp-project`                                     |
| `GOOGLE_VERTEX_LOCATION`     | Vertex AI location/endpoint. `global` is the default; regional support depends on the selected model.                                                                                                   | `global`, `us-central1`, `<supported-region>`                      |
| `AI_TIMEOUT_MS`              | Per-request timeout in milliseconds. Valid range: `1,000–300,000`.                                                                                                                                      | `120000` (default), `60000`, `300000`                              |
| `AI_MAX_OUTPUT_TOKENS`       | Maximum generated tokens. Reasoning tokens count against this same allowance. Valid range: `1–65,536`.                                                                                                  | `16384` (default), `8192`, `65536`                                 |
| `AI_THINKING_LEVEL`          | Gemini 3.8 Flash reasoning level. Valid values: `low`, `medium`, `high`; `minimal` is unsupported.                                                                                                      | `medium` (default), `low`, `high`                                  |
| `GOOGLE_VERTEX_CLIENT_EMAIL` | Service-account email. Set it together with the private key. Both may be left blank only when a Google ADC source is discoverable on the host.                                                          | `vertex-runtime@my-gcp-project.iam.gserviceaccount.com`, _(blank)_ |
| `GOOGLE_VERTEX_PRIVATE_KEY`  | Service-account private key. Preserve escaped `\\n` line breaks and never commit it.                                                                                                                    | `"<private-key-with-escaped-newlines>"`, _(blank)_                 |
| `AI_DISABLED`                | Emergency global AI stop.                                                                                                                                                                               | _(blank)_, `1`, `true`                                             |
| `AI_BUDGET_DISABLED`         | Budget kill switch that prevents AI provider usage.                                                                                                                                                     | _(blank)_, `1`, `true`                                             |

Leaving the credential pair blank is only valid when the host exposes
Application Default Credentials — `GOOGLE_APPLICATION_CREDENTIALS`, or a
`gcloud auth application-default login` on a development machine. Vercel exposes
neither, so deployments must set the pair. Without a resolvable source the API
reports `configuration_missing` and disables AI planning rather than spending a
dispatch on a request that cannot authenticate.

Model IDs and locations are provider-controlled and can change; verify the
selected combination in Google's [supported models and regions](https://cloud.google.com/vertex-ai/generative-ai/docs/supported-models)
before deploying. Keep the example defaults unless the task explicitly approves
a change.

- For local development, prefer [Google Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc):

  ```bash
  gcloud auth application-default login
  pnpm --filter @trove/api ai:verify
  ```

- For a server that cannot use ADC, obtain a dedicated service account from
  **Google Cloud Console → IAM & Admin → Service Accounts**, create a key under
  **Keys**, and set both `GOOGLE_VERTEX_CLIENT_EMAIL` and
  `GOOGLE_VERTEX_PRIVATE_KEY`. Preserve escaped newlines in the private key and
  never commit it.
- `AI_DISABLED=1` is the emergency global AI stop. Use
  `AI_BUDGET_DISABLED=1` when provider spend must be halted without
  changing the rest of the app.

## Google Maps Platform and Places

Create separate restricted keys in [Google Cloud Console → APIs & Services →
Credentials](https://console.cloud.google.com/apis/credentials), and enable the
APIs named in the example comments:

- `GOOGLE_PLACES_API_KEY` and `GOOGLE_ROUTES_API_KEY` are server-only keys for
  the API. Restrict each key to its API and the deployed API's server egress.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is a separate browser key restricted by HTTP
  referrer and limited to Maps JavaScript API. It belongs in
  `apps/web/.env.local`.
- `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` comes from [Google Maps Platform → Map
  Management](https://console.cloud.google.com/google/maps-apis/studio/maps),
  where the JavaScript vector map ID is created. It is safe to expose with the
  browser key.

Set `GOOGLE_PROVIDERS_DISABLED=1` in the API environment to stop outbound
Places and Routes requests while keeping manual planning available.

Set API-only `GOOGLE_PLACE_PHOTO_LIMIT` to `0`, `1`, `2`, or `3` to control new
Google Places Photo API requests per place. Unset or blank defaults to `3`;
invalid or out-of-range values disable new photo requests with a warning.
`1` allows only the first photo to be fetched, and `0` uses cached Google images
or the existing Pexels editorial fallback. Previously resolved photos remain
usable until their existing expiry, even above the new limit. Photo references
stay in the rich metadata cache; lowering or raising the limit never clears
caches or refreshes evidence just for photos. Opening details still resolves
only the eligible cover; other eligible photos require selection. Restart or
redeploy the API after changing the value. Place search, planning, hours, and
scoring remain available at `0`; unavailable editorial imagery falls back to
Trove's branded artwork.

## Editorial imagery

Create `PEXELS_API_KEY` in the [Pexels API dashboard](https://www.pexels.com/api/)
and keep it server-only in the root `.env` or API deployment. It is used for
decorative editorial imagery, not Google Places data. Use
`EDITORIAL_IMAGES_DISABLED=1` for an emergency stop or set
`EDITORIAL_IMAGE_HOURLY_BUDGET` to a lower request ceiling.

## App and deployment values

- In Vercel, set deployment values under **Project Settings → Environment
  Variables**. Configure browser values on `trove` and server values on
  `trove-api`; choose Preview and Production explicitly rather than sharing a
  secret with the web project. See [`ops/vercel/README.md`](../ops/vercel/README.md)
  for the deployment-specific list.
- `NEXT_PUBLIC_API_URL` belongs in `apps/web/.env.local`. Use
  `http://localhost:3001` locally; for a deployment, copy the public API URL
  from the `trove-api` Vercel project. `NEXT_PUBLIC_` values are bundled into
  the browser and must not contain secrets.
- `WEB_ORIGINS` belongs in the API environment and is a comma-separated
  allow list of web origins, including the local origin and the deployed web
  origin.
- `ENVIRONMENT=production` belongs only in the gitignored
  `.env.production` used by production database operations.
- `PLAN_SCORE_DISABLED=1` is the server-side Plan Score kill switch. Keep
  the API and web values aligned when disabling that feature.
- `SUPABASE_SECRET_KEY` belongs only in the API environment. It has broad
  Supabase Storage access and is used to remove queued private trip covers,
  Memory photos, and reservation documents after trip deletion. Never expose it
  through the web app or a `NEXT_PUBLIC_` variable.
- `CRON_SECRET` belongs in the API environment and authenticates both daily
  maintenance routes: AI-planning retention and private trip-media cleanup.
  Without it the routes refuse every caller, so retries stop running.
- `AUTH_RECOVERY_SECRET` belongs in the web server environment. Generate a
  separate signing key for each environment using the
  [recovery signing key instructions](auth/email-auth-rollout.md#recovery-signing-key).
- The API `PORT` is optional and defaults to `3001`.

Never commit `.env`, `.env.local`, `.env.production`, or any provider key. If a
secret is exposed, revoke or rotate it in the provider dashboard immediately.

For production readiness, use the [AI launch runbook](ai/launch-runbook.md),
[notification dispatch runbook](notifications/dispatch-runbook.md), and
[Vercel deployment guide](../ops/vercel/README.md).
