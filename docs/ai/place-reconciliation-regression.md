# AI place reconciliation regression — 2026-10-12

The unchanged traveller prompt is retained in `apps/api/test/fixtures/south-island-planner.json`. It requests two weeks without exact dates; the current planner contract selects a 3-, 5-, or 7-day tier in this case. Both captured proposals therefore contain seven days. This fix does not change date/duration policy.

## Reproduction and results

A single captured model response was scheduled and replayed against the merged matcher and the corrected matcher, isolating reconciliation from model variation. Of 13 places retained for grounding, the merged matcher verified 5; the corrected matcher verified all 13. The initial lookup of an unreferenced city was correctly avoided. The offline pipeline fixture retains that complete model proposal and uses hand-authored provider doubles rather than storing Google responses, IDs, exact coordinates, ratings, or hours.

A subsequent browser generation of the same unchanged prompt produced a larger, 25-place itinerary. It exposed additional failures and two overly broad decisions: a viewpoint could be linked to its parent glacier, and a lookout to its parent town. The corrected matcher selects the actual viewing spot/lookout and reconciles all 25 places. The same captured model response was replayed through the normal local reservation, claim, grounding, validation, and review lifecycle; Google verification remained live. It used one gateway invocation, 29 reconciliation requests, and 33 total Google calls, within the existing 50-call cap. No place required more than its initial lookup and one recovery.

## Diagnosed causes

- Structured regions with an administrative suffix failed one-word comparisons. Requiring every model-supplied geographic qualifier also rejected an exact city when Google omitted a basin or intermediate region.
- A city sharing its name with its country was rejected even when a separate locality component corroborated it.
- Untranslated address components prevented both matching and an appropriate autocomplete recovery. Provider predictions can now corroborate an alternate name/address only for an already acquired Place ID.
- Destination Places inherited conflicting associations from being visited on transfer days. Destinations now supply their own geographic identity context; conflicting venue associations remain ambiguous.
- Geographic destinations and exactly named walking routes were rejected by inappropriate type checks. Type ranking also distinguishes an attraction from its equally named address/locality.
- Broad model search hints tied unrelated candidates. Original-name evidence now disambiguates such ties, and a geographic parent cannot replace a more specific named facility/viewpoint.
- Blanket mark stripping erased meaningful non-Latin distinctions. Latin accents are normalized while meaningful marks in other scripts remain intact. Conservative contraction/compound tiers require multiple agreeing complete words.
- Review country suggestions depended on destination labels/addresses. Provider-derived country codes now survive draft serialization and cache reads; verified scheduled stops and stays also supply visited countries. Transport origins and unscheduled ideas do not. Accepting a prefilled country still withholds a score when it changes an unlocated day’s timezone context.

## Full 25-place decision record

The search seed below is model output, not provider evidence. Initial requests append locality where needed and retain the verified destination bias. Candidate lists, structured components, coordinates, name tiers, and decisions were inspected in transient local diagnostics; raw provider responses are not committed.

| AI-generated place                             | Initial search seed          | Final decision | Evidence / decision path                                                                           |
| ---------------------------------------------- | ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Christchurch                                   | Christchurch                 | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Franz Josef Glacier                            | Franz Josef Glacier          | Verified       | First pass: an exact named geographic destination with region and country support.                 |
| Wanaka                                         | Wanaka                       | Verified       | First pass: Latin diacritic normalization and structured region support.                           |
| Queenstown                                     | Queenstown                   | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Aoraki Mount Cook Village                      | Aoraki Mount Cook Village    | Verified       | First pass: strong official-name tokens and a locality type.                                       |
| Christchurch Botanic Gardens                   | Christchurch Botanic Gardens | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Riverside Market                               | Riverside Market             | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| New Brighton Pier                              | New Brighton Pier            | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| TranzAlpine Train Christchurch Railway Station | Christchurch Railway Station | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Pancake Rocks and Blowholes                    | Pancake Rocks                | Verified       | First pass: original-name agreement outranks the broad hint matching a cafe.                       |
| Lake Matheson                                  | Lake Matheson                | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Franz Josef Glacier Guides Base                | Franz Josef Glacier          | Verified       | Text Search recovery: reject the geographic parent; reconcile the named guide facility.            |
| Waiho Hot Tubs                                 | Waiho Hot Tubs               | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Blue Pools Track                               | Blue Pools Track             | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Mount Iron Track                               | Mount Iron Track             | Verified       | First pass: exact named trail/route and locality support.                                          |
| That Wanaka Tree                               | That Wanaka Tree             | Verified       | Autocomplete recovery: join the English alternate name to the acquired identity by Place ID.       |
| Crown Range Summit Viewpoint                   | Crown Range Summit           | Verified       | First pass: official search name plus verified destination coordinates support a nearby excursion. |
| Arrowtown Chinese Settlement                   | Arrowtown Chinese Settlement | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Skyline Queenstown                             | Skyline Queenstown           | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Hooker Valley Track                            | Hooker Valley Track          | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Tasman Glacier Viewpoint                       | Tasman Glacier Viewpoint     | Verified       | Text Search recovery: reject the parent glacier; reconcile the viewing spot.                       |
| Church of the Good Shepherd                    | Church of the Good Shepherd  | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| Lake Tekapo Lookout                            | Lake Tekapo                  | Verified       | Text Search recovery: reject the parent town; reconcile the named lookout.                         |
| The Arts Centre Te Matatiki Toi Ora            | The Arts Centre              | Verified       | First pass: exact/strong name agreement and destination/locality support.                          |
| New Zealand South Island                       | New Zealand South Island     | Verified       | First pass: remove the provider-confirmed country qualifier; match the named island.               |

All final selections were checked for the expected entity and type, including the guide facility, named trail, viewing spot, and lookout. Ambiguous same-name venues, wrong-city/country results, and autocomplete-only IDs remain unresolved in the focused regression tests. A successful alias cache read retains its original acquisition timestamp and is bound to the provider snapshot fingerprint. The cache revision invalidates prior negative decisions.

## Browser verification

The built-in browser submitted the exact prompt, reviewed the generated itinerary, and showed **25 of 25 places verified**, with **New Zealand** preselected. Apply created only the new local `Reconciliation validation — South Island` trip with seven planned days and country `NZ`. Existing trips were not relinked. Manual Locate searched a temporary custom `Tasman Glacier Viewpoint` and returned the same viewing spot. Selecting it reused the exact canonical Place chosen by AI and merged the temporary relationship: the trip retained 19 provider-backed Places and no Custom Places.

The precise South Africa prompt was not available during reproduction. A focused country regression covers an unresolved Cape Town destination with a verified South African stop, translated provider labels/missing addresses, transport exclusion, unscheduled exclusion, and stays.

## Validation

277 focused API tests and 54 focused web tests passed, including quota/cancellation, negative-cache and alias-cache safety, ambiguity, country review, Apply, and map retention. Repository lint, type checks, the normal release build, Prisma schema validation, formatting, and `changelog:check` passed. The regression adds no database migration.
