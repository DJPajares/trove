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
- For frontend work, apply TasteSkill v2 and prefer established shadcn/Base UI primitives over raw controls. Preserve native semantics: actions are buttons, navigation is links, and form controls retain their native behavior.
- Follow Trove's shared motion language and respect reduced-motion preferences. Verify unfamiliar shadcn/Base UI composition against current official guidance before implementation.
- Use current stable dependency versions where practical.
- Use pnpm.
- Supabase owns `auth.users`, so `prisma.config.ts` recreates it via `initShadowDb` for the shadow database. Any migration referencing a Supabase-owned object needs the same treatment, or a `pg_namespace` guard as the storage policies use.

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
- A Place a user has already reached for may keep a dated snapshot of its durable provider data — name, address, coordinates, types — for up to 30 days, refreshed once stale. Travel legs are cached the same way. This is not pre-mining: nothing is fetched that a user did not ask for. Ask for the cheap field mask (`detail: 'location'`) unless a surface genuinely renders the mutable half.
- Provider requests cost real money per call. Before adding one to a code path, check what fans out around it: a per-day call inside a per-trip loop is how a development week became a $300 bill.
- Editorial imagery and Google Places data are separate tracks. Editorial imagery is decorative, free, hotlinked, cached by reference with its attribution metadata, and safe to resolve on demand. Do not render editorial-image credits on authenticated trip surfaces. Google Places data is functional, billable, never pre-mined, and its mutable fields are never cached. A decorative surface never reaches for the latter.
- Saved Places and Trip Places are independent relationships to the same Place.
- Removing a Saved Place must not remove it from Trip Places, and vice versa.
- Future social/shared itineraries must preserve ownership, attribution, visibility, and source-trip relationships.
- Trip Mode remains separate from global navigation and supports Preview before travel.
- Plan Score and Memories are implemented late, after the core planning/travel flows are stable.

## Linear Workflow

Linear is the implementation source of truth.

Every Trove issue belongs to the `Trove` project on the `wonderland` team. Never
file one outside it.

When a request comes from a prompt, first evaluate its size and risk. Small,
self-contained, low-risk changes with clear scope may be processed immediately
without a Linear issue. Larger, cross-cutting, ambiguous, or otherwise
meaningful implementation work must have a Linear issue created before work
begins. Requests that already come from Linear should use the existing issue.

Never commit to `main`. Before the first edit, confirm the current branch is not
`main` and create a task branch if it is. Every change reaches `main` only through
a Pull Request a human has reviewed and merged.

For each Linear-backed task:

1. Read the current Linear issue, creating it first when a prompt-originated task does not qualify for immediate processing.
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
14. Move the next suggested task to `Todo`.
15. Stop for human review.

For a small prompt-originated task that qualifies for immediate processing,
skip the Linear-specific steps, but still confirm the branch, implement only
the requested scope, run focused validation, self-review, and follow the
applicable GitHub and human-review rules.

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

- Never commit or push to `main`. Check the branch before the first edit, not after the commit.
- Create a PR for implementation tasks unless the task clearly does not modify code.
- Include a concise summary and a simple list of things to manually see the changes.
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
Report token/quota percentages usage.

Examples:
- `5-hour limit: 22.50%`
- `Weekly limit: 5.93%`

## Context Efficiency

- Read only relevant PRD sections.
- Avoid repeatedly scanning the entire repository.
- Prefer focused tests before broad suites.
- Avoid duplicate documentation.
- Keep AGENTS/CLAUDE instructions short.
- Do not duplicate Linear task content into PRD.
- Do not duplicate PRD content into Linear beyond useful references.

## Testing

- Test screens, behaviour, or anything that is manually testable using the platform's built-in browser.
- Only add unit tests for important components or services (business rules, scoring, authorization, data integrity) rather than incidental code.
- Do not add E2E tests unless explicitly requested.
- Still run appropriate linting, type-checking, build checks, and focused validation for each task.
- Unit tests use Vitest (`pnpm --filter <app> test`).

## Human Control

The user is the final decision-maker for:

- product decision gates
- architecture changes
- scope changes
- PR approval
- merging
- release/deployment approval
