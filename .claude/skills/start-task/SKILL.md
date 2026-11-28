---
name: start-task
description: Use when the user gives a Linear issue (WDL-123 or a URL) or says "start the next task". Runs the Linear-backed delivery loop from CLAUDE.md end to end and stops for human review. Not for chat-originated requests.
---

# Start a Linear-backed task

Follow CLAUDE.md "Linear Workflow"; this is its checklist, not a replacement.

1. Fetch the issue, its comments and its `Blocked by` relations. If a blocker is still open, report it and stop.
2. Confirm it belongs to the `Trove` project on the `wonderland` team.
3. Move the issue to `In Progress`.
4. Read only the PRD sections it references. Load the skills for its Expertise tags (CLAUDE.md "Expertise").
5. Run `ship-pr` checks 1–2, then create the branch with the issue's `gitBranchName`.
6. Implement only the issue's scope.
7. Run focused validation for the touched apps (`pnpm --filter <app> lint|typecheck|test`), then `pnpm build`.
8. Run the `reviewer` agent and fix what it finds. For screens or behavior a user can see, run `qa-tester`.
9. Decide the changelog entry and the version bump (CLAUDE.md "User-facing Changelog" and "Versioning").
10. Hand off to `ship-pr`.
11. Move the issue to `In Review`. Find the next unblocked suggested task and move it to `Todo`.
12. Reply in CLAUDE.md's Current/Next format, with a **Post-merge action** section when one is needed. Stop.
