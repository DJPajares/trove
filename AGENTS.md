# AGENTS.md

## Project

Trove is a travel companion built around:

> **Plan it. Live it. Remember it.**

The approved product requirements live in `PRD.md` once generated. Linear is the implementation task source of truth.

## Working Rules

- Follow the accepted product decisions and avoid reopening scope unless a task requires it.
- Keep UX simple, contextual, and progressively disclosed.
- Prefer the smallest implementation that satisfies the task and acceptance criteria.
- Do not introduce future features unless explicitly included in the current Linear task.
- Preserve future extensibility without building unused parallel systems.
- Do not hard-code user-facing text; keep the app localization-ready.
- Follow the existing Trove Design System and established UX patterns. Apply TasteSkill principles when making UI/UX decisions without overriding the PRD or established Trove patterns.
- Use current stable dependency versions where practical.
- Use pnpm.

## Tech Direction

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- UI foundation: shadcn/ui + Base UI
- Backend: Fastify + TypeScript
- ORM: Prisma
- Platform: Supabase PostgreSQL, Auth, Storage
- i18n: next-intl
- PWA/offline: Serwist
- Monorepo: pnpm + Turborepo
- Hosting: Vercel + Supabase

## Architecture Principles

- Trove owns application identity and user relationships; external providers enrich data.
- Google Places data is resolved on demand. Do not pre-mine Google Places into Trove.
- Mutable provider data such as ratings, hours, photos, and descriptions should not become permanent Trove-owned copies.
- Saved Places and Trip Places are independent relationships to the same Place.
- Removing a Saved Place must not remove it from Trip Places, and vice versa.
- Future social/shared itineraries must preserve ownership, attribution, visibility, and source-trip relationships.
- Trip Mode remains separate from global navigation and supports Preview before travel.
- Plan Score and Memories are implemented late, after the core planning/travel flows are stable.

## Linear Workflow

Linear is the implementation source of truth.

For each task:

1. Read the current Linear issue.
2. Check `Blocked by` dependencies before implementation.
3. Move the issue to `In Progress`.
4. Read only the relevant PRD sections and code.
5. Implement only the task scope.
6. Run focused validation.
7. Perform a concise self-review.
8. Create or update the Git branch.
9. Commit and push.
10. Open a GitHub Pull Request.
11. Link the PR to the Linear issue.
12. Move the issue to `In Review`.
13. Identify the next unblocked suggested task.
14. Stop for human review.

Do not auto-merge PRs. A user must manually review and approve.

## Linear Task Structure

Each executable issue should contain:

### Description
A short, simple explanation of the change.

### Scope
The exact boundaries of the task.

### Suggested Models & Reasoning
Recommend suitable currently available models for the target AI platform.

- Resolve model names at task-generation time.
- Do not permanently hard-code provider/model names into this file.
- Prefer the smallest capable model.
- Use stronger reasoning for architecture, difficult debugging, security-sensitive work, complex multi-file changes, or ambiguous requirements.
- Keep the reason brief.

### Acceptance Criteria
Clear and independently verifiable criteria.

### Dependencies
Use actual Linear relationships where possible:

- `Blocked by`
- `Blocking`

### Manual Test
Include only when a user can meaningfully verify the change.

Example:

1. Open Profile.
2. Edit the display name.
3. Save.
4. Refresh.
5. Confirm the new value remains.

## GitHub Rules

- Create a PR for implementation tasks unless the task clearly does not modify code.
- Include a concise summary and validation performed.
- Never auto-merge.
- Human approval is required before merge.
- Mark the Linear issue `Done` only after the relevant PR is merged, unless the issue is explicitly non-code work.

## Completion Response

Keep completion responses short.

Use:

### Current
- PR: `<link>`
- Linear: `<current task link>`

### Next
- Linear: `<next suggested task link>`
- Model: `<recommended model + reasoning level/platform>`
- Reason: `<one short sentence>`

### Usage
Report token/quota percentages only when the current AI platform explicitly exposes them.

Examples:
- `5-hour limit: 22.50%`
- `Weekly limit: 5.93%`

If unavailable, write:

`Usage: unavailable from current platform`

Never estimate hidden usage.

## Context Efficiency

- Read only relevant PRD sections.
- Avoid repeatedly scanning the entire repository.
- Prefer focused tests before broad suites.
- Avoid duplicate documentation.
- Keep AGENTS/CLAUDE instructions short.
- Do not duplicate Linear task content into PRD.
- Do not duplicate PRD content into Linear beyond useful references.

## Testing

During early Trove development:

- Do not prioritize broad unit-test coverage before the core product flows are stable.
- Do not add E2E tests unless explicitly requested.
- Still run appropriate linting, type-checking, build checks, and focused validation for each task.

## Human Control

The user is the final decision-maker for:

- product decision gates
- architecture changes
- scope changes
- PR approval
- merging
- release/deployment approval
