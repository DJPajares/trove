# Vercel deployment setup

Trove deploys as two Vercel projects connected to the same GitHub repository:

| Project | Root directory | Purpose |
| --- | --- | --- |
| `trove` | `apps/web` | Next.js web application |
| `trove-api` | `apps/api` | Fastify API |

Use the `wonderBots` Vercel team and Git integration. The `main` branch deploys to production; pull requests receive preview deployments. Do not configure GitHub auto-merge or bypass deployment protections.

## Web environment variables

Set these in `trove` for Preview and Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_TROVE_API_URL`

`NEXT_PUBLIC_TROVE_API_URL` must point to the production API domain (`https://api.trove.wndrhive.com`). This variable belongs to the `trove` web project; it is not consumed by `trove-api`. Values using `NEXT_PUBLIC_` are intentionally browser-visible and must not contain secrets.

## API environment variables

Set these in `trove-api` for Preview and Production:

- `DATABASE_URL` — Supavisor transaction-pooler URL with `schema=trove`.
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `TROVE_WEB_ORIGINS` — comma-separated web origins allowed to call the API. Include
  `https://trove.wndrhive.com` and the narrowly scoped
  preview pattern `https://trove-git-*-djpajares-projects.vercel.app`.
- `TROVE_AI_PROVIDER` — `vertex`.
- `TROVE_AI_MODEL` — the approved Vertex model identifier.
- `TROVE_AI_TIMEOUT_MS` and `TROVE_AI_MAX_OUTPUT_TOKENS` — bounded request limits.
- `GOOGLE_VERTEX_PROJECT` and `GOOGLE_VERTEX_LOCATION`.
- `GOOGLE_VERTEX_CLIENT_EMAIL` and `GOOGLE_VERTEX_PRIVATE_KEY` — server-only
  service-account credentials; set both or neither. Preserve private-key
  newlines (escaped `\\n` values are accepted).
- `TROVE_AI_DISABLED` and `TROVE_AI_BUDGET_DISABLED` — leave unset normally;
  set either to `1` to stop all AI provider construction and requests.

Do not add `SHADOW_DATABASE_URL` to Vercel. It is reserved for isolated migration development and must never point at the shared database.
`DIRECT_URL` is likewise only for Prisma commands and is not required by the deployed API.
AI credentials belong only to `trove-api`; never add them to the web project or
prefix them with `NEXT_PUBLIC_`. The gateway logs only content-free generation
metadata and never logs prompts, generated objects, credentials, or raw provider
responses.

## Supabase Auth URLs

In Supabase Auth URL Configuration, preserve all existing entries and add:

- `https://trove.wndrhive.com/auth/callback`
- `https://*-djpajares-projects.vercel.app/**`

Set the production Site URL to `https://trove.wndrhive.com`. Do not add API URLs as Auth callback URLs.
