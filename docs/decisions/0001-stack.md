# 0001. Stack

- Status: Accepted (recorded retroactively on 2026-11-28, from PRD §3 and CLAUDE.md)
- Decider: product owner

## Context

Trove is a responsive PWA. It needs offline trip access, localization, private media storage,
AI-assisted planning and provider-enriched places. It's built by a small team with heavy AI-agent
help, so the stack should be mainstream, well documented and strongly typed end to end.

## Decision

| Layer      | Choice                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Web        | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui + Base UI, next-intl, Serwist                        |
| API        | Fastify + TypeScript                                                                                     |
| Data       | Prisma on Supabase PostgreSQL; Supabase Auth and Storage                                                 |
| AI         | Vertex AI (PRD §3.7)                                                                                     |
| Repository | pnpm workspaces + Turborepo (`apps/web`, `apps/api`, `packages/db`, `packages/types`, `packages/config`) |
| Hosting    | Vercel (web and API) + Supabase                                                                          |

## Alternatives considered

Alternatives weren't recorded when the stack was chosen. Record them in a new ADR when any layer is reconsidered.

## Consequences

- **Benefits:** shared types between web and API, and one toolchain.
- **Separate API:** keeps provider keys, rate limits and AI quotas server-side.
- **Supabase migrations:** Supabase owns `auth.users`, so migrations that reference Supabase objects
  need the shadow-database treatment described in CLAUDE.md.
- **Revisit when** a native mobile client, background workloads beyond Vercel limits, or a change
  of data provider is proposed.
