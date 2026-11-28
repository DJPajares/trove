---
name: ship-pr
description: Use before every commit, push or pull request in Trove. Enforces the branch rules, the changelog declaration and the version bump, then opens or updates the PR. Never merges.
---

# Ship a pull request

1. `git branch --show-current` must not be `main`.
2. `gh pr list --head <branch> --state all --json number,state`. If any PR is `MERGED` or `CLOSED`,
   the branch is finished: pull `main`, cut a new branch, and move the work there.
3. Version bump: every app whose deployed files changed gets a bump (CLAUDE.md "Versioning").
   Run `node scripts/check-versions.mjs --base main`.
4. Changelog: add or update the entry in `apps/web/changelog.json` when users can see the change,
   then run `pnpm --filter @trove/web changelog:check`.
5. Commit with a Conventional Commit subject (`feat(web):`, `fix(api):`, `chore:`, `docs:` …).
   Re-run checks 1–2, then push.
6. Open or update the PR from `.github/pull_request_template.md`:
   - Summary and simple steps to see the change
   - `Fixes WDL-<n>` for Linear-backed work
   - exactly one `Changelog: added` or `Changelog: none — <reason>` line
   - Post-merge action
7. Validate the live PR body: write `pull_request.body` and `pull_request.base.sha` from GitHub to a
   temporary JSON file, then run `GITHUB_EVENT_PATH=<file> node apps/web/scripts/check-changelog.mjs --pr`.
8. Confirm CI started. For Linear work, confirm Linear shows the PR linked. Never merge and never enable auto-merge.
