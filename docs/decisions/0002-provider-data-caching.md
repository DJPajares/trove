# 0002. Provider data: on-demand resolution and a bounded cache

- Status: Accepted (recorded retroactively on 2026-11-28, from PRD §4.8, §11.3–§11.8, §29.5 and CLAUDE.md)
- Decider: product owner

## Context

Google Places is billed per request, has permission and attribution terms, and its data changes
(ratings, hours, photos). Trove needs place identity, scoring evidence and good imagery without
building a copy of the provider's database. In one development week, a per-day call inside a
per-trip loop cost about $300.

## Decision

- **Trove owns identity and relationships.** Providers enrich data; they don't own it.
- **Google Places is resolved on demand and never pre-mined.**
  - Durable fields of Places a user reached for may be snapshotted for up to 30 days, where
    permissions allow.
  - Required evidence, opened-detail photos and contact links use the bounded cache in PRD §11.5 and §29.5.
- **Field masks match the path.** Cheap masks for autocomplete, decorative and routing paths. One
  rich request for explicit itinerary selections.
- **Editorial imagery is a separate track.** It's free, decorative and hotlinked, cached by reference
  with attribution metadata, with no credits shown on authenticated trip surfaces.

The operational rules live in the `places-provider` skill (`.claude/skills/places-provider/SKILL.md`).

## Consequences

- **Cost stays bounded** by user actions rather than catalog size.
- **Every new provider call needs a fan-out check**, and its worst case stated in the PR.
- **Offline and stale data must be shown honestly** (PRD §11.7).
- **Revisit when** provider terms or pricing change, or a different places provider is evaluated.
