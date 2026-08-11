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

`NEXT_PUBLIC_TROVE_API_URL` must point to the production API branch alias (`https://trove-api-git-main-djpajares-projects.vercel.app`) until preview API origins are configured. Values using `NEXT_PUBLIC_` are intentionally browser-visible and must not contain secrets.

## API environment variables

Set these in `trove-api` for Preview and Production:

- `DATABASE_URL` — Supavisor transaction-pooler URL with `schema=trove`.
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `TROVE_WEB_ORIGINS` — comma-separated web origins allowed to call the API. Include
  `https://trove-git-main-djpajares-projects.vercel.app` and the narrowly scoped
  preview pattern `https://trove-git-*-djpajares-projects.vercel.app`.

Do not add `SHADOW_DATABASE_URL` to Vercel. It is reserved for isolated migration development and must never point at the shared database.
`DIRECT_URL` is likewise only for Prisma commands and is not required by the deployed API.

## Supabase Auth URLs

In Supabase Auth URL Configuration, preserve all existing entries and add:

- `https://trove-git-main-djpajares-projects.vercel.app/auth/callback`
- `https://*-djpajares-projects.vercel.app/**`

Set the production Site URL to `https://trove-git-main-djpajares-projects.vercel.app`. Do not add API URLs as OAuth callback URLs.
