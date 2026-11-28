---
name: plan-backlog
description: Use when turning PRD sections, a gap report, or a feature idea into Linear issues for Trove. Drafts issues in the CLAUDE.md task structure with real dependencies, and creates them only after the user approves the list.
---

# Plan backlog issues

1. Read the PRD sections in question. List existing issues in the `Trove` project (`wonderland` team)
   so you don't create duplicates.
2. Slice the work vertically: each issue delivers something verifiable and fits in one PR.
3. Draft each issue in CLAUDE.md "Linear Task Structure", plus:
   - **Out of scope**
   - **Expertise** tags
   - **PRD references**
   - a collapsible "Agent notes" section for file hints and risks
4. Resolve the suggested models from the ones currently available. Prefer the smallest capable model.
5. Show the list (title · scope · blocked-by · expertise) and wait for the user's yes.
6. Create the issues in `Trove` on `wonderland`. Set `Blocked by` relations and labels.
   Move only the first unblocked issue to `Todo`.
7. Reference PRD sections by number. Don't copy PRD text into issues.
