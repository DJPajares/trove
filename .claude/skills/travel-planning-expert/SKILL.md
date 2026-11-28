---
name: travel-planning-expert
description: Use when building or reviewing any Trove product behavior or data-model change that touches trips, dates, places, itinerary, Trip Mode, offline or memories, or when an issue is tagged Expertise domain. Keeps work consistent with the PRD's concepts and invariants.
---

# Travel planning domain for Trove

This skill points to the PRD, which stays the source of truth. Read the cited section before you
change any behavior it covers.

## Concepts (PRD §5.1)

| Concept        | What it is, and what it is not                                                     |
| -------------- | ---------------------------------------------------------------------------------- |
| Trip           | One owned journey                                                                  |
| Place          | An identity, not a visit                                                           |
| Saved Place    | The traveller's global relationship to a Place                                     |
| Trip Place     | This trip's working relationship to a Place                                        |
| Itinerary item | One occurrence of a Place, or a label-only block. Repeat visits are separate items |
| Reservation    | Logistics. It doesn't schedule a stop or record spend                              |
| Memory         | Private content about the experience                                               |

## Independent signals (PRD §5.2)

Lifecycle, manual readiness, itinerary coverage, preparedness, Ready Offline, Plan Score and
Experience Rating are each independent. **None of them sets another.** Only the traveller marks a
trip Ready (PRD §6.2).

## Rules (must)

**Lifecycle and dates**

- Lifecycle boundaries use the trip's local reference timezone, never the device timezone alone (PRD §6.1, §32.1).
- Changing dates keeps **Day 1 as Day 1**.
  - Bookings, transport instants, expenses, Memories and ratings keep their real-world dates.
  - Shortening a trip shows the impact and asks for confirmation. Items on removed days move to Unscheduled.
  - Day-only notes are reassigned or explicitly discarded, never silently deleted (PRD §6.1).
- Removing a day never deletes its Tasks, Reservations, Expenses or Memories.

**Places and the itinerary**

- Saved Places and Trip Places are independent. Removing one never removes the other.
  Adding to a trip doesn't save the Place globally (PRD §14.2).
- Every place-backed itinerary item has a Trip Place.
  - Repeat visits share one Trip Place, but each visit keeps its own completion state.
  - A Trip Place that items still reference is never silently deleted (PRD §15.1).

**Archiving and the traveller's control**

- Archived trips are read-only and are excluded from Home, search, reminders and push. Restoring one
  doesn't replay missed pushes (PRD §6.1).
- The traveller stays in control. Suggestions, scores and inferred context never silently change the
  plan or declare it ready (PRD §1.1).
- Keep planned, estimated and recorded values distinct. An uncompleted plan item is not evidence of a visit.

## Domain edge cases to test

- Trips that cross time zones, and overnight transport legs
- Daylight-saving gaps, which are surfaced for correction rather than silently re-timed
- Multi-destination trips, sparse plans, time left open on purpose, and staying with friends with no accommodation
- Offline edits queued across reloads, then a conflict after reconnecting (PRD §28)
- A read-only shared itinerary link is a projection of the plan, not another owned trip (PRD §8.2)

## Checklist

- [ ] The change respects every rule above that it touches
- [ ] It works with an empty trip, a one-day trip and a long multi-city trip
- [ ] The copy is calm and doesn't make travelling feel like work (PRD §1.1)

## References

PRD §1.1, §5, §6, §14–§17, §20–§21, §28, §32, §35 (future features to stay compatible with).

## Lessons

<!-- Add one line, with the date, each time a mistake in this area repeats. -->
