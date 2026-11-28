---
name: verify-manually
description: Use after a UI or behavior change in Trove, to verify it in the running app with the built-in browser against the issue's Manual Test or acceptance criteria.
---

# Verify in the browser

1. Start the app with `.claude/launch.json` (`pnpm dev`: web on :3000, API on :3001) and open
   http://localhost:3000 in the built-in browser.
2. Follow each Manual Test step. Then check:
   - empty, loading and error states
   - a 375px mobile viewport and a desktop viewport
   - keyboard access and reduced motion
   - offline behavior, if the change touches Trip Mode or prepared trips (`docs/development.md#offline-development`)
3. Report pass or fail for each step, with what you saw. Add a screenshot when it helps.
   Fix any failures and run the steps again.
4. Use seed data (`pnpm db:seed`) and test accounts from the project's own fixtures.
   Never use the user's real credentials.
5. Watch the network tab for repeated paid provider calls (Google Places, Vertex AI).
   A fan-out problem is a failure.
