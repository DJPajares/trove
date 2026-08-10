# Trove

**Plan it. Live it. Remember it.**

Trove is a personal travel companion for collecting places, planning trips, using those plans while travelling, and preserving the journey afterward.

## Project Status

Trove is currently in the initial implementation phase.

The product definition and implementation workflow are already established. Development is managed through Linear and delivered through GitHub pull requests.

## Source of Truth

- `PRD.md` — approved product requirements and implementation direction
- `AGENTS.md` — AI execution and delivery rules
- `CLAUDE.md` — Claude Code adapter that follows `AGENTS.md`
- Linear — implementation tasks, dependencies, and acceptance criteria

## Planned Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI
- next-intl
- Serwist

### Backend

- Fastify
- TypeScript
- Prisma

### Platform

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Vercel

### Tooling

- pnpm
- Turborepo

## Planned Repository Structure

```text
trove/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── db/
│   ├── types/
│   └── config/
├── AGENTS.md
├── CLAUDE.md
├── PRD.md
└── README.md
```

The actual application structure will be created through the Foundation implementation tasks.

## Development Workflow

1. Select the next unblocked Linear task.
2. Read the task, `AGENTS.md`, and only the relevant `PRD.md` sections.
3. Implement only the approved scope.
4. Run the required validation.
5. Push a feature branch.
6. Open a GitHub Pull Request.
7. Stop for manual review and approval.
8. Merge only after human approval.
9. Continue with the next unblocked Linear task.

## Delivery Order

1. Foundation
2. Plan
3. Travel
4. Supporting
5. Polish
6. Plan Score
7. Memories

Plan Score and Memories are intentionally implemented late, after the core planning and travel flows are stable.

## Current Phase

**Foundation**

Implementation begins with the accepted Foundation tasks in the Trove Linear project.

## Repository

https://github.com/DJPajares/trove
