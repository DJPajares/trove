---
name: update-prd
description: Use when a task, bug, or request conflicts with or goes beyond PRD.md. Proposes an amendment and a Decision Log entry instead of letting code silently redefine the product.
---

# Propose a PRD amendment

1. Quote the PRD text (with its section number) and describe the conflict or gap in two lines.
2. Propose new wording. List the sections, Linear issues and code paths it affects.
3. Ask the user to approve. Product decisions are theirs (CLAUDE.md "Human Control").
4. Once approved, edit the PRD and add a row to the Decision Log (PRD §41).
   If the change is architectural, also add an ADR in `docs/decisions/`.
5. Update the affected Linear issues by reference. Don't copy PRD text into them.
