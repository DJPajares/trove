---
name: places-provider
description: Use when code calls or caches Google Places, editorial imagery providers, routing, or any paid or attribution-bound provider, or when an issue is tagged Expertise provider. Protects cost, provider permissions, and attribution rules.
---

# Provider data, cost and attribution in Trove

These rules moved here from CLAUDE.md "Architecture Principles", unchanged.
The PRD sections (§11.5, §11.8, §29.5, §4.8) remain authoritative.

## Rules (must)

- A Place a user has already reached for may keep a dated snapshot of its durable provider data — name, address, coordinates, types — for up to 30 days, only where provider permissions allow, refreshed once stale. Travel legs follow the same permission-first rule; 30 days is an internal maximum, not blanket permission for every field. This is not pre-mining: nothing is fetched that a user did not ask for. Ask for the cheap field mask (`detail: 'location'`) for autocomplete, decorative and routing-only paths. Explicit itinerary Place selections acquire identity and reusable scoring fields together in one rich request under PRD §29.5, reusing sufficient fresh snapshots.
- Provider requests cost real money per call. Before adding one to a code path, check what fans out around it: a per-day call inside a per-trip loop is how a development week became a $300 bill.
- Editorial imagery and Google Places data are separate tracks. Editorial imagery is decorative, free, hotlinked, cached by reference with its attribution metadata, and resolved on demand under its provider permissions. Do not render editorial-image credits on authenticated trip surfaces; choose sources whose attribution requirements can be met by that design. Google Places data is functional, billable, never pre-mined, and necessary ratings/review-count/hours evidence, plus opened Place details' photos (up to three, author always credited) and contact links, may use the accepted 30-day bounded cache in PRD 11.5 and 29.5, separate from Trove-owned truth. Any permitted transient reuse retains its original age. A decorative surface never reaches for the latter.

## Anti-patterns to catch in a diff

- A provider call inside `.map`, a `for` over days or items, or a React render path with no cache or dedupe
- A rich field mask on an autocomplete, decorative or routing-only path
- Copying ratings, hours, photos or descriptions into Trove-owned tables, or keeping them past 30 days
- Prefetching Places the user didn't ask for
- A new paid provider with no cost note in PRD §3.7 / §11.8

## Checklist

- [ ] Calls per user action are counted and bounded. State the worst case in the PR.
- [ ] The field mask matches the path's purpose
- [ ] The cache age and refresh follow the rules above
- [ ] Attribution and credit requirements are met for each surface

## References

PRD §4.8, §11.3–§11.8, §29.5. `docs/environment.md` (Google Maps Platform and Places, Editorial imagery).

## Lessons

- A per-day provider call inside a per-trip loop cost about $300 in a development week. Check fan-out first.
