# Moving Trove to a new Google Cloud account

[Back to README](../README.md) · [Environment and provider setup](environment.md)

Use this checklist when Trove's Google Cloud project has to move to a different
Google account — for example when a free trial ends and a new account's trial
takes over. Every Google value Trove uses is tied to one Cloud project, so the
whole set is recreated in the new project and then swapped in one pass.

Nothing in the database needs to change. Google place IDs are global, so saved
places, Trip Places, and cached place snapshots keep working after the switch.

## What changes

Eight values come from Google Cloud. Everything else (Supabase, Pexels, Vercel
secrets) stays as it is.

| Variable                          | What it is                           | Where you get it                                  | Local file            | Vercel project |
| --------------------------------- | ------------------------------------ | ------------------------------------------------- | --------------------- | -------------- |
| `GOOGLE_VERTEX_PROJECT`           | New project ID                       | [Step 1](#1-create-the-project-and-link-billing)  | `.env`                | `trove-api`    |
| `GOOGLE_VERTEX_LOCATION`          | Vertex endpoint — normally unchanged | Keep `global`                                     | `.env`                | `trove-api`    |
| `GOOGLE_VERTEX_CLIENT_EMAIL`      | Service-account email                | [Step 3](#3-create-the-vertex-ai-service-account) | `.env`                | `trove-api`    |
| `GOOGLE_VERTEX_PRIVATE_KEY`       | Service-account private key          | [Step 3](#3-create-the-vertex-ai-service-account) | `.env`                | `trove-api`    |
| `GOOGLE_PLACES_API_KEY`           | Server key for Places API (New)      | [Step 4](#4-create-the-three-api-keys)            | `.env`                | `trove-api`    |
| `GOOGLE_ROUTES_API_KEY`           | Server key for Routes API            | [Step 4](#4-create-the-three-api-keys)            | `.env`                | `trove-api`    |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser key for Maps JavaScript API  | [Step 4](#4-create-the-three-api-keys)            | `apps/web/.env.local` | `trove`        |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`  | Vector map ID for map pins           | [Step 5](#5-create-the-map-id)                    | `apps/web/.env.local` | `trove`        |

Tip: open a scratch note and fill in this table as you go, then paste everything
in [step 6](#6-swap-the-values-in). Never commit the note.

## Before you start

- Sign in to the [Google Cloud Console](https://console.cloud.google.com/) with
  the **new** Google account. Use a separate browser profile or check the avatar
  at the top right on every page — the console silently keeps the last-used
  account and project, and creating a key in the old project is the most common
  mistake here.
- Keep the old project running until [step 7](#7-verify) passes, so production
  has no gap.

## 1. Create the project and link billing

1. Start the free trial from the [Google Cloud free tier page](https://cloud.google.com/free)
   (**Get started for free**). This creates a billing account with the trial
   credit. Google Maps Platform APIs refuse every request without a billing
   account, even on the trial.
2. Create a project from the [project selector](https://console.cloud.google.com/projectselector2/home/dashboard)
   → **New project**. A name such as `trove-prod` is fine.
3. Copy the **Project ID** (not the project name or number) from the project
   selector or the dashboard's **Project info** card.
   → `GOOGLE_VERTEX_PROJECT`
4. Confirm the project is linked to the trial billing account under
   [Billing → Account management](https://console.cloud.google.com/billing/projects).
5. Recommended: add a budget alert under
   [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets)
   so you get an email well before the credit runs out. Provider calls cost real
   money once the trial ends.

## 2. Enable the four APIs

With the new project selected, open each link and click **Enable**:

| API                                                                                              | Used by                    |
| ------------------------------------------------------------------------------------------------ | -------------------------- |
| [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)         | AI planning                |
| [Places API (New)](https://console.cloud.google.com/apis/library/places.googleapis.com)          | Place search and details   |
| [Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com)                | Travel times between stops |
| [Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com) | The in-app map             |

Make sure it is **Places API (New)**, not the legacy "Places API". Enabling can
take a few minutes to propagate.

## 3. Create the Vertex AI service account

1. Go to [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → **Create service account**. Name it e.g. `vertex-runtime`.
2. On the **Permissions** step, add the role **Vertex AI User**
   (`roles/aiplatform.user`). Without it every AI request returns
   `403 Permission 'aiplatform.endpoints.predict' denied`.
3. Open the new service account → **Keys** → **Add key** → **Create new key** →
   **JSON**. A `.json` file downloads.
4. Open the file in a text editor and copy two fields:

   | JSON field     | Variable                     | Looks like                                                          |
   | -------------- | ---------------------------- | ------------------------------------------------------------------- |
   | `client_email` | `GOOGLE_VERTEX_CLIENT_EMAIL` | `vertex-runtime@trove-prod.iam.gserviceaccount.com`                 |
   | `private_key`  | `GOOGLE_VERTEX_PRIVATE_KEY`  | `"-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"` |

   Copy `private_key`, **not** `private_key_id` (the short hex string). Keep the
   `\n` sequences exactly as they appear and wrap the value in double quotes in
   `.env`. In Vercel, paste the same value without the surrounding quotes.

5. Delete the downloaded JSON file once both values are saved somewhere safe.

## 4. Create the three API keys

All three are created from
[APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
→ **Create credentials** → **API key**. After each key is created, choose
**Edit API key** to name and restrict it.

| Key name (suggested)  | API restrictions    | Application restrictions                                                                                  | Variable                          |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `trove-places-server` | Places API (New)    | None (Vercel has no fixed egress IP)                                                                      | `GOOGLE_PLACES_API_KEY`           |
| `trove-routes-server` | Routes API          | None (Vercel has no fixed egress IP)                                                                      | `GOOGLE_ROUTES_API_KEY`           |
| `trove-maps-browser`  | Maps JavaScript API | **Websites**: `https://trove.wndrhive.com/*`, `http://localhost:3000/*`, plus any preview origins you use | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |

Keep the browser key separate from the two server keys: it is shipped to every
visitor's browser, so it must only work on Trove's own websites.

## 5. Create the map ID

1. Go to [Google Maps Platform → Map Management](https://console.cloud.google.com/google/maps-apis/studio/maps)
   → **Create map ID**.
2. Map type **JavaScript**, rendering **Vector**. Name it e.g. `trove-web`.
3. Copy the **Map ID**.
   → `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`

A map ID belongs to one project, so the old one stops working with the new
browser key — this value must change too.

## 6. Swap the values in

**Local development**

- Root `.env`: update `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_CLIENT_EMAIL`,
  `GOOGLE_VERTEX_PRIVATE_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_ROUTES_API_KEY`.
- `apps/web/.env.local`: update `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and
  `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`.
- If you use `gcloud` Application Default Credentials locally instead of the
  key pair, sign in again as the new account and point the quota at the new
  project:

  ```bash
  gcloud auth application-default login
  ```

  ```bash
  gcloud auth application-default set-quota-project <new-project-id>
  ```

- Restart both dev servers. `tsx watch` does not reload `.env`, and Next.js
  only reads `NEXT_PUBLIC_` values at startup.

**Vercel** (Project → **Settings → Environment Variables**, Production and
Preview)

- `trove-api`: the same five server values as the root `.env`.
- `trove`: the two `NEXT_PUBLIC_GOOGLE_MAPS_*` values.

Environment variable changes only apply to new deployments. Redeploy both
projects from **Deployments → ⋯ → Redeploy** on the latest production
deployment. The web project must be rebuilt, not just restarted, because
`NEXT_PUBLIC_` values are baked into the bundle.

## 7. Verify

1. AI: run `pnpm --filter @trove/api ai:verify` locally. It should report a
   successful result. In production, `GET /ai/planning-sessions/availability`
   should report `available`.
2. Places: search for a place when adding it to a trip; suggestions should appear.
3. Routes: open a trip day with two or more located stops; travel times should
   show between them.
4. Map: open a trip's map; tiles and pins should render without a "For
   development purposes only" watermark or a grey map.

If something fails, see [Troubleshooting](environment.md#troubleshooting) for AI
errors. For Maps errors, the browser console names the problem —
`RefererNotAllowedMapError` means the website restriction is missing your
origin, `ApiNotActivatedMapError` means an API from step 2 is not enabled, and
`BillingNotEnabledMapError` means step 1.4 was skipped.

## 8. Retire the old project

Once everything above passes in production:

1. In the **old** project, delete the three API keys and the service account's
   key, so the old credentials cannot be used if they ever leaked.
2. Optionally shut the old project down from
   [IAM & Admin → Settings](https://console.cloud.google.com/iam-admin/settings) →
   **Shut down**.
