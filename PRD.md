# Trove — Product Requirements Document

**Status:** Approved for implementation planning  
**Product:** Trove  
**Category:** Travel Companion  
**Core philosophy:** **Plan it. Live it. Remember it.**

---

# 1. Product Overview

Trove is a personal travel companion that helps users:

1. collect places they may want to visit,
2. plan trips and itineraries,
3. use those plans during actual travel,
4. capture moments with minimal effort, and
5. revisit completed journeys as curated memories.

Trove is not only an itinerary planner. It is designed to remain useful before, during, and after travel.

## 1.1 Product Principles

- Keep the interface simpler than the underlying capability.
- Show information contextually rather than exposing every feature at once.
- Use progressive disclosure.
- Avoid forcing optional data entry before it becomes useful.
- Keep global navigation stable.
- Make travel-critical information available offline.
- Keep future features compatible with the existing product model rather than creating parallel systems.
- Avoid engagement mechanics that make travelling feel like work.

---

# 2. Goals

## 2.1 Primary Goals

- Make trip planning easier and less overwhelming.
- Provide a fast and flexible day-by-day itinerary experience.
- Make saved places reusable across future trips.
- Provide a useful in-trip operating mode.
- Allow users to preview Trip Mode before travel.
- Provide contextual route, timing, weather, task, reservation, and expense information.
- Preserve completed journeys through lightweight Memories.
- Remain extensible for future AI, social, booking, discovery, translation, and native-app features.

## 2.2 Non-Goals for Initial Release

The initial release does not aim to provide:

- social networking,
- real-time collaboration,
- public profiles,
- AI itinerary generation,
- booking/purchasing,
- full offline turn-by-turn navigation,
- automatic email parsing,
- live flight tracking,
- health/sleep tracking,
- advanced accounting,
- automatic Smart Cost Forecasting,
- native iOS/Android apps,
- full multilingual UI.

---

# 3. Technical Direction

## 3.1 Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI
- custom Trove Design System
- next-intl
- Serwist

## 3.2 Backend

- Fastify
- TypeScript
- Prisma

## 3.3 Platform

- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Vercel

## 3.4 Tooling

- pnpm
- Turborepo

## 3.5 Suggested Monorepo Structure

```text
trove/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── db/
│   ├── types/
│   └── config/
```

Future native app:

```text
apps/
└── mobile/
```

The Fastify API should remain reusable by web and future native clients.

## 3.6 Authentication Foundation

- Use the existing Supabase project and Supabase Auth user pool.
- Google is the initial Trove sign-in provider.
- Trove must not create a second credentials/account system for a user who already exists in the shared Supabase Auth project.
- The existing `auth.users.id` remains the identity anchor for Trove-owned Profile and domain data.
- Trove establishes and manages its own application session even when the underlying Supabase Auth user is shared with another app.
- Trove application/domain data must remain isolated from unrelated application data.
- A prepared trip may remain usable offline for the last authenticated Trove user without requiring a network re-authentication solely because connectivity is unavailable. Server-authorized operations resume when connectivity and a valid session are available.

---

# 4. Design Requirements

## 4.1 Design Language

Trove should feel:

- calm,
- premium but not luxury,
- modern but not futuristic,
- warm but not playful,
- visual but not social-media-like,
- minimal but not empty.

## 4.2 Visual Direction

Initial direction:

- deep forest green,
- warm ivory/off-white,
- restrained apricot/coral accents,
- warm charcoal typography,
- dark mode using deep charcoal/green-black rather than pure black.

Exact color values are implementation/design decisions.

## 4.3 UI Foundation

Use shadcn/ui and Base UI as implementation foundations.

They must not define Trove's visual identity.

Build Trove-specific components for domain interactions such as:

- TripCard,
- PlaceCard,
- DayTimeline,
- ItineraryItem,
- Trip Mode views,
- Plan Score,
- MemoryCard,
- ExpenseSummary.

## 4.4 Responsive Design

Support:

- desktop,
- tablet,
- mobile.

Mobile should be the primary design reference for in-trip use.

Desktop/tablet should use additional space intelligently, including split itinerary/map layouts where appropriate.

## 4.5 Navigation

Global navigation:

- Home
- Trips
- Saved
- Tools

Trip Mode must not replace global navigation.

Trip Mode may introduce its own Now / Today / Map / Trip navigation, but the user must retain a clear way to leave Trip Mode and reach the stable global navigation on every supported form factor.

## 4.6 Accessibility

Applicable web UI should target **WCAG 2.2 AA**.

Important workflows must support:

- keyboard access,
- visible focus states,
- semantic labels/landmarks,
- accessible alternatives to drag-and-drop,
- sufficient contrast,
- usable zoom/text resizing,
- reduced-motion preferences,
- screen-reader-perceivable validation, error, and important dynamic states.

---

# 5. Core Product Architecture

```text
Trove
├── Home
├── Trips
│   └── Trip
│       ├── Overview
│       ├── Plan
│       │   ├── Itinerary
│       │   ├── Places
│       │   ├── Reservations
│       │   ├── Tasks
│       │   └── Notes
│       ├── Trip Mode
│       ├── Expenses
│       ├── Trip Info
│       └── Memories
├── Saved
└── Tools
    ├── Currency
    ├── Travel Wallet (optional)
    └── Task Templates
```

Travel Wallet is optional for the initial MVP if scope or security complexity becomes too large.

---

# 6. Trip Lifecycle

## 6.1 Lifecycle

A trip follows:

**Planning → Active → Completed**

The lifecycle is primarily derived from the trip's inclusive start/end dates.

`Upcoming` may be used as a display label but does not need to be a core stored lifecycle state.

Lifecycle date boundaries must use the trip's deterministic local reference timezone defined in Section 32.1 rather than the device timezone alone.

Rules:

- Before the local start date: Planning.
- From the local start date through the local end date, inclusive: Active.
- After the local end date: Completed.
- Changing trip dates must explicitly preserve, move, unschedule, or otherwise resolve itinerary data that falls outside the new range. It must not silently delete affected itinerary items.

## 6.2 Planning Readiness

Planning readiness is separate from lifecycle:

- In Progress
- Ready

Rules:

- The user manually marks a trip Ready.
- Ready does not lock editing.
- Trip Mode activation does not depend on Ready.
- Preview Trip Mode is available regardless of readiness.
- Plan Score does not automatically change readiness.
- Lifecycle, readiness, and Plan Score are independent concepts.

---

# 7. Trip Creation

## 7.1 Required Fields

- Trip name
- Start date
- End date

Start/end dates are inclusive and end date cannot precede start date.

## 7.2 Optional Fields

- Destination(s)
- Cover photo
- Travel party size
- Starting location override
- Notes

## 7.3 Destinations

- Zero, one, or multiple destinations are allowed.
- Destinations may represent cities, regions, or countries.
- A trip may span multiple countries without creating separate trips.

## 7.4 Starting Location

- User Profile contains a default home location.
- A trip may override this with a specific Starting Location.
- Starting Location represents where the traveller begins the trip and may contribute to relevant first-day routing context.
- Starting Location is not the automatic base for every trip day and remains separate from Daily Base and Accommodation.

## 7.5 Travel Party

- Store an optional numeric party size.
- Default to 1.
- Traveller names are not required.
- Traveller identity and collaboration are separate concepts.

---

# 8. Trip Ownership & Future Sharing Foundations

Initial MVP behavior is **private, owner-only trips**.

The data model may remain future-ready for:

- trips shared with the user,
- saved/read-only itineraries created by others,
- copied trips,
- collaborators,
- public/private visibility,
- source/attribution relationships.

Future-ready concepts may include:

- owner,
- creator,
- visibility,
- collaborators,
- source trip,
- attribution,
- user-to-trip relationship.

These fields/relationships must not require MVP collaboration, sharing, discovery, or public-itinerary workflows to be implemented.

## 8.1 Future Saved vs Copied Itinerary Behavior

This subsection describes **future functionality only**.

### Saved itinerary

- References another user's trip.
- Generally read-only.
- Lives under Trips rather than Saved Places.

### Copied itinerary

- Creates an independent editable trip.
- Preserves original source and attribution.

A future read-only saved itinerary must not run the user's personal Trip Mode directly; it must be copied into an owned trip first.

Shared With Me, collaborators, saved itineraries, Copy to My Trips, public visibility, attribution UI, and related sharing workflows are deferred from the MVP.

---

# 9. Home

Home is contextual and should show the most relevant current state.

## 9.1 No Upcoming Trip

Prioritize:

- Create Trip,
- recently Saved Places,
- previous Memories.

## 9.2 Upcoming/Planning Trip

Prioritize:

- next trip,
- countdown,
- readiness,
- Continue Planning,
- Preview Trip Mode,
- relevant preparation/offline readiness when useful.

Do not introduce a separate generic "planning progress" score or status unless it is explicitly defined as a future product concept.

## 9.3 Active Trip

Prioritize:

- current trip,
- next itinerary item,
- Open Trip Mode.

Other trips remain accessible.

## 9.4 Recently Completed Trip

Prioritize:

- Review Memories,
- Experience Rating.

Home must not become a dense analytics dashboard.

---

# 10. Trips

Trips is the complete itinerary library.

MVP sections may include:

- Active
- Planning / Upcoming
- Past

Avoid making every section a permanent tab.

Future-only sections may include:

- Shared With Me
- Saved Itineraries

Future filters may include:

- All
- Mine
- Shared
- Saved
- Past

Shared and Saved-itinerary views must not be required by the initial MVP.

---

# 11. Places Data Model

## 11.1 Trove Place Identity

Trove owns the canonical internal identity and user relationships for a Place.

Trove does **not** pre-mine or permanently mirror the Google Places dataset.

Places should be resolved and created on demand when users interact with them.

Conceptually:

```text
Place
├── Trove internal ID
├── provider references
├── custom-place identity data
└── Trove/user relationships
```

## 11.2 Provider References

A Place may have one or more external provider references.

Initial provider:

- Google Places API (New)

Use a provider reference model such as:

```text
PlaceProviderRef
├── placeId
├── provider
└── externalPlaceId
```

The database should enforce uniqueness for the same provider + external ID.

Do not assume an external provider ID can never change.

The model should permit multiple historical/provider references to resolve to one Trove Place if needed later.

## 11.3 On-Demand Resolution

When the user selects a provider-backed place:

1. receive the provider Place ID,
2. find an existing provider reference,
3. reuse the existing Trove Place if found,
4. otherwise create a Trove Place and provider reference,
5. attach the requested Trove relationship.

Do not bulk-import provider Places during project setup.

## 11.4 Mutable Provider Data

The provider remains the source for mutable data such as:

- public rating,
- review count/reviews,
- opening hours,
- photos/photo references,
- provider description,
- phone,
- website,
- provider categories.

This data should be fetched/refreshed as needed and only cached according to provider rules.

Trove-owned data includes:

- Trove internal Place identity,
- provider references,
- user-created Custom Place identity data,
- notes,
- priority,
- Saved relationship,
- Trip Place relationship,
- itinerary relationship,
- Memories,
- tasks,
- other user-owned relationships/content.

Mutable provider data must not be treated as permanent canonical Trove truth.

## 11.5 Photos

Use the current provider photo URL/reference obtained through current provider data.

Do not permanently copy provider photos into Trove Storage.

User-uploaded trip/Memory photos are separate user-owned content and may be stored privately by Trove.

## 11.6 Duplicate Protection

Primary deduplication:

- provider,
- external provider Place ID.

Do not perform aggressive fuzzy merging automatically.

If future provider ID changes create possible duplicates, use careful matching/merge flows rather than risking incorrect automatic merges.

## 11.7 Provider Data Offline/Freshness Rules

- Provider-backed Places may use only provider-permitted cached display/location data for the offline experience.
- Cached provider-derived data is a snapshot, not canonical truth, and should retain source/freshness or last-updated context where relevant.
- Stale data must not be presented as guaranteed current data when freshness materially affects a decision.
- When connectivity returns, Trove should refresh/re-resolve mutable provider data where appropriate.
- Trove must not promise permanent/full offline Google Places or Google Maps data.
- If provider-derived detail is unavailable offline, Trove should preserve understandable Trove-owned itinerary/relationship context rather than fabricate missing provider information.

---

# 12. Custom Places

Custom Places are first-class and user-owned/private in the MVP.

Examples:

- private home,
- local meeting point,
- custom viewpoint,
- temporary location,
- place missing from Google.

Minimum:

- Name

Optional:

- location,
- note.

Custom Places should work in:

- Saved,
- Trip Places,
- Itinerary,
- Memories.

A Custom Place with usable location data may also appear on Maps and participate in routing.

A locationless Custom Place remains valid and usable elsewhere, but it is not mappable/routable until location information is added.

---

# 13. Place Categories

Normalize provider types into a simple Trove taxonomy:

- Destination
- Things to do
- Food & drink
- Stay
- Shopping
- Transport
- Other

Provider-specific/raw types may be retained internally.

---

# 14. Saved Places

Saved is the user's global place collection.

It contains:

- Google-backed Places,
- Custom Places.

It does not contain itineraries.

## 14.1 Collections

Saved Places may belong to multiple collections.

Examples:

- Japan
- Coffee
- Beaches
- Weekend Ideas

Use collections rather than exclusive folders.

## 14.2 Relationship Independence

Saved Places and Trip Places are independent relationships.

Rules:

- Removing from Saved must not remove from Trip Places or itinerary items.
- Removing from Trip Places must not remove from Saved.
- Adding to Trip Places does not automatically globally save the Place.
- Use the same canonical Place where possible.
- Removing a relationship must not delete the canonical Place merely because one user/trip relationship no longer exists.

---

# 15. Trip Places

Trip Places are the trip-specific working collection.

A Trip Place represents:

> A Place being considered for this particular trip.

It does not need to already be scheduled.

Optional priority:

- Must Go
- Interested
- Maybe

Sources:

- Global Saved Places,
- provider Places,
- Custom Places,
- newly selected places from Itinerary.

## 15.1 Trip Place ↔ Itinerary Invariants

- Every **place-backed itinerary item** must have a Trip Place relationship for that trip.
- Selecting an existing Trip Place for an itinerary item reuses it.
- Selecting a globally Saved Place for an itinerary item ensures the Trip Place relationship exists first.
- Selecting a provider-backed Place resolves/reuses the canonical Trove Place, ensures a Trip Place exists, then creates the itinerary item.
- Selecting a Custom Place ensures a Trip Place exists before creating a place-backed itinerary item.
- A plain custom-label itinerary item has no required Place or Trip Place relationship.
- Creating a Trip Place or place-backed itinerary item does not automatically create a global Saved relationship.
- Removing an itinerary item does not remove its Trip Place or Saved relationship.
- A Trip Place referenced by itinerary items must not be silently deleted underneath those items. The user must first resolve/remove those itinerary references, or Trove must preserve the Trip Place relationship required by them.

---

# 16. Place Search Behavior

## 16.1 Adding to Trip Places

### Empty Search

Show all Global Saved Places first.

Do not immediately load provider search results.

### Search Entered

Order:

1. matching Global Saved Places,
2. matching provider Places results.

Selecting a Saved Place creates/reuses the Trip Place relationship.

Custom Place creation remains available without requiring provider search.

## 16.2 Adding to an Itinerary Day

### Empty Search

Show all Trip Places first.

Do not request provider search solely because the picker opened.

### Search Entered

Order:

1. matching Trip Places,
2. matching provider Places,
3. custom place/custom label.

Relationship rules:

- Existing Trip Place → create itinerary item using that Trip Place.
- Global Saved Place → ensure Trip Place exists, then create itinerary item.
- Provider Place → resolve/reuse canonical Place, ensure Trip Place exists, then create itinerary item.
- Custom Place → ensure Trip Place exists, then create itinerary item.
- Plain custom label → create label-only itinerary item with no Place requirement.

None of these itinerary flows automatically create a global Saved relationship.

## 16.3 Global Search

Global Trove Search is part of the MVP and should find Trove-owned information such as:

- Trips,
- Trip Places,
- Saved Places,
- Memories,
- Trip Info,
- Reservations,
- contextual Notes where useful.

Trove-owned matches should be primary. External/provider place discovery may appear secondarily when useful, but must not replace the Trove-owned search corpus.

---

# 17. Itinerary

## 17.1 Day-Based Structure

Each date between the inclusive trip start/end dates produces a day in the itinerary.

Each day uses the deterministic local timezone rules in Section 32.1.

If trip dates change, itinerary items that would fall outside the new range must be handled explicitly. Trove must not silently delete them; they may be moved, unscheduled, or resolved through a clear user-facing flow.

## 17.2 Minimum Item

An itinerary item requires only:

- Place reference, or
- Custom label.

Examples:

- Hobbiton Movie Set
- Drive to Rotorua
- Free afternoon
- Flight SIN → AKL
- Dinner with Sarah

Users must not be forced to classify item type upfront.

## 17.3 Optional Item Data

Optional:

- exact time,
- Morning / Afternoon / Evening / Anytime,
- duration,
- notes,
- reservation,
- tasks,
- transport details,
- expense,
- priority,
- custom location.

## 17.4 Reordering

Support:

- drag-and-drop,
- move earlier/later,
- move to another day,
- duplicate,
- remove,
- unschedule.

Drag-and-drop must not be the only mechanism.

## 17.5 Unscheduled

Provide an Unscheduled area for items not assigned to a day.

## 17.6 Travel-Time Item State

Planning order and travel-time execution state are separate.

Trip Mode may use these item states:

- upcoming,
- completed,
- skipped.

Rules:

- complete and skip can be undone,
- reordering remaining items preserves completed/skipped state,
- live Trip Mode edits mutate the same underlying itinerary used by planning,
- Preview uses the same underlying itinerary rather than a copy,
- simulated time in Preview must not automatically persist completed/skipped state.

---

# 18. Routes & Maps

## 18.1 Travel Segments

Show calculated travel between itinerary items.

Initial modes:

- Drive
- Transit
- Walk

Route calculations are estimates and should degrade honestly when location/provider data is unavailable.

## 18.2 Daily Route Summary

Possible summary:

- number of places,
- estimated travel time,
- distance.

This later contributes to Plan Score.

## 18.3 Map Integration

Tablet/desktop should support synchronized itinerary + map views.

Map and itinerary selection should stay in sync.

Trove should initially hand off turn-by-turn navigation to Google Maps / Apple Maps.

Location permission is optional and should only be requested contextually when live location would materially help. Denial/unavailability must not prevent Trip Mode or itinerary use.

## 18.4 Daily Base

A day may have an explicit Daily Base.

Daily Base is distinct from trip Starting Location.

For normal per-day base context, use this precedence:

1. explicit Daily Base,
2. applicable Accommodation,
3. no daily base.

Starting Location is **not** a fallback daily base. It may separately contribute to relevant first-day routing before/alongside that day's base context.

An applicable Accommodation may provide the day's base automatically unless the user explicitly overrides the day with a Daily Base.

If multiple accommodations could apply and Trove cannot determine the appropriate base safely from their dates/times, it must not guess; the day may remain without an inferred base until clarified.

Daily Base may affect:

- route calculations,
- day start/end,
- Trip Mode.

---

# 19. Reservations & Travel Logistics

Trove initially organizes bookings rather than selling travel products.

## 19.1 Reservation

Minimum:

- Title

Optional:

- date/time,
- booking/reference number,
- provider,
- attachment/document,
- notes,
- linked itinerary item,
- linked Place.

Possible reservation types include:

- flight,
- accommodation,
- restaurant,
- attraction,
- train,
- rental car,
- tour.

Classification should not be mandatory unless needed.

## 19.2 Flights

Optional structured data:

- flight number,
- airline,
- departure airport/time,
- arrival airport/time,
- terminal/gate,
- booking reference,
- seat.

Cross-timezone transport must preserve separate local departure and arrival times/timezones.

## 19.3 Accommodation

Accommodation receives first-class support because it affects routing.

Possible data:

- check-in,
- check-out,
- Place/address,
- booking information,
- applicable trip days.

Accommodation may supply Daily Base context for the days on which it applies, subject to the precedence rules in Section 18.4.

---

# 20. Trip Mode

Trip Mode is the dedicated in-trip experience.

Planning asks:

> What could I do?

Trip Mode answers:

> What do I need right now?

Trip Mode operates on the same underlying trip/itinerary data as planning. It must not maintain a separate itinerary copy.

Trip Mode eligibility is date-derived for the selected owned trip using the lifecycle/timezone rules in Sections 6 and 32.1. Ready/In Progress does not gate Trip Mode.

Global navigation must remain reachable while Trip Mode provides its own Now / Today / Map / Trip navigation.

## 20.1 Views

```text
Trip Mode
├── Now
├── Today
├── Map
└── Trip
```

### Now

Prioritize:

- current context,
- next item,
- leave-by time when enough information exists,
- travel time,
- directions,
- weather when trustworthy/current enough,
- reservation/ticket shortcut,
- important alert.

Current/next determination should use:

- local trip/day/item time,
- exact time/daypart when available,
- itinerary order,
- completed/skipped state.

Missing timing/location data must produce an honest fallback rather than fabricated precision.

### Today

Allow:

- complete / undo complete,
- skip / undo skip,
- reorder remaining items,
- add,
- edit time/daypart,
- directions,
- note/photo where supported,
- expense.

These actions update the actual itinerary/trip data.

### Map

Show where available:

- route,
- itinerary items,
- current location when permission is granted and available,
- nearby Trip Places when enough location context exists,
- daily base.

The UI must distinguish actual device location from inferred/planned context. Trip Mode remains usable if location permission is denied or live map data is unavailable.

### Trip

Provide quick access to:

- upcoming days,
- Places,
- Reservations,
- Tasks,
- Expenses,
- Notes,
- Trip Info,
- Travel Wallet where retained/available.

---

# 21. Preview Trip Mode

Every upcoming owned trip may open the real Trip Mode UI in a clearly labelled **Preview** state, regardless of In Progress / Ready status.

Users may select:

- trip day,
- simulated point/time of day.

Preview reuses the same Now / Today / Map / Trip components and the same underlying itinerary as live Trip Mode. It does not create a sandbox/copy.

Preview should allow testing:

- Now,
- Today,
- map/route,
- travel timing,
- reservations,
- tasks,
- overall usability.

## 21.1 Live Data Rules

Do not fabricate:

- future weather,
- future traffic,
- current physical location.

Use:

- real forecast only when reliably available for the selected date,
- normal/estimated travel durations,
- the selected itinerary/day context as preview location/context.

Simulated passage of time must not automatically persist completed/skipped state.

## 21.2 Editing

Changes made explicitly in Preview update the actual itinerary.

Provide immediate Undo where practical for the action just performed.

Undo is for explicit preview edits; Preview is not a separate reversible sandbox for all trip changes.

---

# 22. Expenses & Currency

## 22.1 Expense

Expense records represent **Actual Spend**.

Required:

- amount,
- currency.

Optional:

- title,
- category,
- date/time,
- Place,
- itinerary item,
- note.

Suggested categories:

- Food
- Transport
- Stay
- Activities
- Shopping
- Other

## 22.2 Budget vs Projected vs Actual

Trove must distinguish:

### Budget

Optional trip-level intended spend set by the user.

### Projected Cost

Expected cost from known user-entered planned costs attached to the current trip plan, itinerary, reservations, or similar accepted planned-cost sources.

MVP Projected Cost must not invent AI/provider estimates.

### Actual Spend

Derived from recorded Expense records.

Rules:

- Expense records do not automatically become Projected Cost records.
- Dated expenses may contribute to per-day Actual Spend.
- Undated/trip-level expenses contribute to overall Actual Spend but not to a specific day's total.
- Budget, Projected Cost, and Actual Spend remain technically and visually distinct.

Support trip-level and per-day views where the underlying data supports them.

## 22.3 Multi-Currency

Always preserve:

- original amount,
- original ISO currency.

Optionally show an approximate converted home-currency value and the rate/reference used where practical.

Conversion/display values must never overwrite the original amount/currency.

## 22.4 Future Smart Cost Forecasting

Future feature:

Automatically estimate trip and daily cost ranges using itinerary/destination data.

Do not implement in the initial release.

---

# 23. Tasks

Tasks may attach to:

- trip,
- day,
- itinerary item.

Minimum:

- task label.

Optional:

- due date/time,
- note,
- completed state.

Task Templates are part of the MVP under global Tools and may populate reusable trip tasks without turning Trove into a generic task manager.

---

# 24. Notes

Notes are contextual.

Possible contexts:

- trip,
- day,
- Place,
- itinerary item,
- reservation.

Do not build a generic global Notes application.

---

# 25. Trip Info

Trip Info stores repeatedly needed reference information.

Examples:

- Wi-Fi,
- hotel instructions,
- rental car plate,
- local contact,
- emergency contact,
- booking reference.

Flexible fields:

- label,
- value,
- optional category,
- optional note,
- optional link,
- pinned state.

Pinned Trip Info should surface in Trip Overview and Trip Mode.

---

# 26. Tools

Initial MVP Tools:

- Currency
- Task Templates
- Travel Wallet only if retained in MVP

No global Notes tool.

## 26.1 Travel Wallet

Potential documents:

- passport,
- visa,
- insurance,
- ticket,
- flight confirmation,
- booking document.

Travel Wallet is **MVP-optional and the first candidate for deferral** if scope/security complexity is too large.

Core planning, Trip Mode, offline travel, and Memories must not depend on Travel Wallet.

Sensitive information must remain private by default. Offline availability for retained Travel Wallet documents must be explicit rather than automatically downloading every document.

---

# 27. Notifications

Notifications should be:

- contextual,
- actionable,
- low-frequency.

MVP triggers may include:

- upcoming trip,
- incomplete important task,
- upcoming reservation,
- leave-by reminder,
- current/forecast weather that could affect an immediate planned action when reliable data exists,
- known timing issue,
- minimal post-trip Memory/Experience Rating prompt.

Do not add:

- streaks,
- re-engagement nags,
- random promotional notifications.

Core functionality must remain available even if notifications are disabled/unavailable.

Notification permission should be requested contextually after user intent/usefulness is established, not automatically during first-run onboarding.

Advanced disruption monitoring, traffic-aware replanning, weather-driven replanning, live flight monitoring, and broader travel intelligence remain future features.

---

# 28. Offline Requirements

Offline support is core.

## 28.1 Guaranteed Offline Experience

After a trip has been loaded/prepared for offline use, Trove must preserve the Trove-owned data required for the supported travel experience, including where implemented:

- Trip Mode shell and core Now/Today/Trip content,
- current/upcoming itinerary,
- Trip Places and understandable Place context,
- reservation/accommodation information,
- Tasks,
- contextual Notes,
- pinned/relevant Trip Info,
- expense entry,
- queued Memories/photos,
- cached currency rates,
- previously fetched route information where provider terms permit,
- selected Travel Wallet/reservation documents only when explicitly marked/selected for offline use and the feature is retained.

Provider-derived cached data must follow the provider/freshness rules in Section 11.7.

Critical itinerary/place information must remain understandable without live map tiles or fresh provider calls.

## 28.2 Offline Editing & Sync Contract

Supported offline edits persist locally immediately.

The sync system must:

- maintain a durable pending queue,
- show pending/failed sync state without blocking normal travel use,
- retry automatically when connectivity returns,
- make mutation retries idempotent so they do not create duplicate records/actions,
- reconcile safe/non-overlapping changes automatically,
- surface genuinely ambiguous conflicts through a clear non-destructive resolution path,
- keep failed operations visible/retryable rather than silently dropping them,
- preserve queued changes across ordinary app/PWA reloads.

Supported domains include, as they are implemented:

- itinerary complete/skip/reorder/move/time/daypart edits,
- tasks,
- expenses,
- notes,
- Memories/media queue,
- Trip Info.

## 28.3 Offline Maps & Provider Data

Full offline map/navigation and turn-by-turn navigation are not required in v1.

Loss of map tiles/provider connectivity must not hide the itinerary or critical location text.

Cached weather/routes/currency/provider data must not be presented as current when stale.

## 28.4 Ready Offline

Provide trip offline-readiness state based on the supported categories actually prepared.

Possible categories include:

- Itinerary
- Places/context
- Reservations/accommodation
- Important selected documents
- Tasks/Notes/Trip Info
- Currency/route context where supported

Readiness must support:

- Ready,
- Partial,
- Stale,
- Error/not ready states where applicable,
- last successful preparation/refresh time,
- manual Refresh Offline Data,
- removal of the local offline copy without deleting cloud data.

A Ready indicator must not claim data is current when provider-cached content is stale.

---

# 29. Plan Score

Implement late, after planning and route behavior is stable.

Scale:

**0–100**

Available:

- per day,
- overall trip.

Plan Score is deterministic and advisory. It does not require an LLM for MVP scoring or explanations and never automatically edits the itinerary.

Primary factors may include:

- feasibility,
- opening-hours evidence,
- timing conflicts,
- travel effort,
- pace/buffer,
- route efficiency/backtracking,
- Must Go priority fit,
- public place quality as a supporting signal,
- clearly better provider-backed alternatives when a material improvement can be explained.

Rules:

- Feasibility and travel effort must have materially greater influence than small public-rating differences.
- Missing, stale, unknown, or not-applicable evidence must not be treated as poor planning by default.
- **Confidence** and **completeness** are separate from the numeric score.
- When there is not enough evidence to justify a useful score, Trove may withhold the number and show `Not enough information yet` or equivalent.
- Travel-heavy days may use different factor applicability while remaining part of the same scoring system.
- Per-day results aggregate into an overall trip score without allowing low-information days to create false precision or disproportionate influence.
- Relevant itinerary/order/time/place/route/reservation/provider-evidence changes should invalidate/recalculate affected results.
- Explanations should show concise **What works** and **Worth improving** guidance.
- Better-alternative suggestions must preserve the user's original itinerary until explicitly accepted.
- MVP Plan Score must not depend on future AI, traffic-aware replanning, or disruption-intelligence features.

Plan Score remains independent from lifecycle, manual Ready status, Trip Mode availability, Preview availability, and Experience Rating.

---

# 30. Experience Rating

Scale:

**1–5**

Authoritative rating targets:

- optional rating per completed trip day,
- optional independent overall rating for the completed trip.

An optional short note may accompany a rating where appropriate.

Rules:

- The overall trip rating is entered independently and is not automatically averaged from day ratings.
- Experience Rating is user-generated and remains distinct from Plan Score.
- Experience Rating is not a provider/public Place rating.
- The MVP does not create Place-level or Memory-level Experience Ratings.
- Live Memory capture does not require a rating.

---

# 31. Memories

Implement last, after planning/travel flows are mature.

Core principle:

> **Capture should be effortless; curation happens mostly afterward.**

Memories are private/personal in the MVP.

## 31.1 Capture

Allow:

- user-owned photos,
- short notes/captions,
- Highlights,
- optional associated Place/itinerary item.

Where possible, automatically associate:

- trip,
- day,
- local date/time,
- itinerary item,
- Place.

Automatically inferred context must remain correctable.

Photo-only and note-only Memories are valid.

Do not require Experience Rating during capture and do not create Memory-level ratings.

Do not require daily journal entries, streaks, or repeated prompts.

Provider photos must never be copied into Memories or Trove Storage as if they were user-owned Memory media.

## 31.2 Completed Trip Story

Suggested structure:

```text
Memories
├── Trip Story
├── Highlights
├── Days
└── Places
```

The Trip Story should derive from the user's actual trip, itinerary context, notes, highlights, Places, and user-uploaded photos.

Sparse trips must remain valid and should not be padded with fabricated events, provider photos treated as Memories, or fictional narrative.

Users must be able to:

- add/remove user photos,
- edit captions/notes,
- reorder highlights/selected media,
- include/remove items from Highlights without necessarily deleting the Memory,
- add missing memories,
- change cover using user-owned media,
- correct day/Place/time context,
- edit a user-authored Trip Story summary/caption where the UI provides one.

Initial Trip Story generation must not require AI and must not fabricate narrative.

---

# 32. Internationalization & Localization

Initial UI language:

- English only.

Requirements:

- use next-intl,
- maintain `en.json`,
- no hard-coded user-facing strings,
- architecture ready for additional locales.

Initial Profile/onboarding baseline includes:

- home location,
- preferred/home currency.

Travel preferences may additionally support:

- date format,
- 12/24-hour time,
- km/mi,
- °C/°F.

Additional UI languages remain future work.

## 32.1 Time Zones

Use **IANA timezones** for persisted/resolved timezone context.

### Trip Reference Timezone

Each trip must have a deterministic reference timezone for lifecycle date boundaries and trip-level date interpretation.

Resolve it without adding a new required creation field, using the first available source in this order:

1. an explicitly resolved trip timezone if later corrected/available,
2. first resolvable trip destination,
3. trip Starting Location,
4. Profile home location,
5. device timezone captured as the final fallback when the trip is created/first resolved.

The fallback must be persisted/resolved deterministically so lifecycle does not change merely because the user later opens the same trip from another device timezone.

### Day and Item Timezones

- A dated/timed itinerary item, reservation, or logistics record should use its applicable local timezone when it can be resolved from its Place/location.
- A trip day resolves its default local timezone in this order: explicit Daily Base, applicable Accommodation, first ordered located itinerary item with a resolvable timezone, then the trip reference timezone.
- Exact-time items without a more specific timezone use the applicable day timezone.
- Cross-timezone transport must preserve separate local departure and arrival times/timezones.
- Home, Trip Mode, Today, notifications, and date-driven lifecycle behavior must not rely on device timezone alone when a more authoritative trip/day/item timezone exists.

---

# 33. Profile & Settings

Suggested structure:

```text
Settings
├── Profile
├── Travel Preferences
├── Appearance
├── Notifications
├── Offline & Storage
├── Privacy & Security
├── Connected Services
└── Account
```

Connected Services is future-only until an actual integration requires user configuration.

## 33.1 Profile

- name,
- profile photo,
- home location,
- preferred/home currency.

## 33.2 Appearance

- System
- Light
- Dark

Default:

- Follow system.

## 33.3 Privacy & Authorization

All user data is private by default.

For the owner-only MVP:

- authenticated owners alone may read or mutate their private trips and user-owned relationships/content;
- this includes Saved relationships, Trip Places, user-owned Custom Places, itinerary data, reservations, uploaded documents, Tasks, Notes, Trip Info, Expenses, Experience Ratings, Memories, and uploaded media;
- private uploaded files/media must enforce the same ownership boundary;
- shared canonical/provider Place identity or public provider data must never expose another user's private Saved/Trip relationships, notes, trip information, Memories, or other private content.

Future sharing/collaboration may intentionally expand authorization later and must be explicit.

## 33.4 Offline Storage

Users should be able to:

- see offline trip storage/readiness,
- refresh offline data,
- inspect pending/failed sync where relevant,
- delete local/offline copies.

Deleting local offline content must not delete the cloud trip.

Offline local data must remain scoped to the authenticated Trove user and must not be exposed when a different user signs in on the same device.

---

# 34. Onboarding

Onboarding is accepted but should be implemented later in the initial development cycle.

Keep it short:

1. Welcome
2. Sign in with the existing Supabase/Google authentication flow
3. Name
4. Home location
5. Preferred/home currency

Existing users with a sufficiently complete Trove Profile should not be forced through onboarding again.

Do not initially ask for detailed travel preferences, destination interests, travel personality, notification permission, location permission, or other unnecessary permissions/configuration.

---

# 35. Future Features Register

These are recorded for future brainstorming and are intentionally not deeply specified. They are **not MVP requirements** unless another section explicitly states a narrower MVP capability.

## 35.1 AI

Purpose:

- itinerary generation,
- AI-assisted itinerary improvement,
- richer Plan Score explanation/help,
- trip Q&A,
- Trip Mode assistance,
- Memory curation.

MVP deterministic Plan Score calculation/explanations and deterministic provider-backed alternative suggestions do not depend on this future AI scope.

## 35.2 Social & Collaboration

Future purpose:

- collaborative planning,
- sharing,
- Shared With Me,
- saved itineraries from others,
- copying trips,
- comments/recommendations,
- possible traveller profiles.

The MVP may keep future-ready ownership/source/visibility fields but does not implement these workflows.

## 35.3 Where to Go When / Discovery

Purpose:

Help users decide where to travel and when.

## 35.4 Booking

Potential future:

- flights,
- hotels,
- attractions,
- transport.

## 35.5 Translation

Potential future:

- additional UI languages,
- text translation,
- voice translation,
- conversation translation.

## 35.6 Deeper Travel Intelligence

Potential future:

- flight-status monitoring,
- traffic-aware replanning,
- weather-driven adjustments/replanning,
- opening-hours change monitoring,
- disruption alerts,
- smarter/contextual nearby intelligence beyond the deterministic MVP behavior.

Basic MVP weather display/forecast context, leave-by timing, notifications based on already-known trip data, and deterministic Plan Score alternatives remain separate from this future intelligence scope.

## 35.7 Native Apps

Future:

- React Native / Expo
- iOS
- Android

## 35.8 Monitoring

When appropriate:

- Sentry
- Mixpanel

### Future Feature Rule

Future features should extend existing Trove concepts rather than create parallel systems.

---

# 36. MVP Scope

This section is the authoritative high-level MVP scope summary. Detailed behavior remains defined by the relevant feature sections above.

## 36.1 Core Identity

- Trips
- Places
- Saved
- Itinerary
- Trip Mode
- Preview Trip Mode
- Plan Score
- Memories

## 36.2 Supporting

- contextual Home
- Global Trove Search
- Reservations
- Accommodation
- Tasks
- Task Templates
- contextual Notes
- Trip Info
- lightweight Expenses
- Currency
- basic Weather context
- Notifications
- Offline support
- optional Travel Wallet
- Profile/Settings
- onboarding
- responsive/accessibility/PWA polish

## 36.3 Deferred

- AI-dependent product features
- social/collaboration/sharing workflows
- public discovery
- booking/purchasing
- additional-language/translation features
- live flight tracking
- automatic email parsing
- health/sleep tracking
- advanced budgeting/accounting
- Smart Cost Forecasting
- native apps
- advanced disruption/replanning intelligence

---

# 37. Development Order

This section is the authoritative implementation sequence.

## Phase 1 — Foundation

- monorepo/app foundation
- database
- authentication
- localization foundation
- design system
- app shell
- core Profile/settings
- basic PWA foundation
- CI/deployment foundation

## Phase 2 — Plan

- Trips
- Places/provider resolution
- Saved
- Trip Places
- Itinerary
- maps/routes

## Phase 3 — Travel

- Trip Mode
- Preview Trip Mode
- offline behavior
- Ready Offline

## Phase 4 — Supporting

- Reservations
- Accommodation
- structured logistics
- Tasks
- Task Templates
- contextual Notes
- Trip Info
- Expenses
- Currency
- basic Weather context
- supporting-feature integration into Trip Mode/offline
- Travel Wallet only if retained in MVP

## Phase 5 — Polish

- contextual Home
- Global Trove Search
- notifications
- responsive refinement
- accessibility
- PWA/offline UX refinement
- Settings/privacy/storage refinement
- onboarding
- app-wide resilience/performance polish

## Phase 6 — Plan Score

Implement only after core planning/route behavior is stable.

## Phase 7 — Memories

Implement last.

Includes:

- private Memory/media foundation
- live Memory capture
- offline Memory/media queue
- Trip Story
- post-trip curation
- Experience Rating
- completed-trip/search integration
- focused final regression/privacy validation

---

# 38. Initial Testing Strategy

During early development:

- do not prioritize broad unit-test coverage before core features are stable,
- do not add E2E tests unless explicitly requested,
- still run appropriate:
  - linting,
  - type checking,
  - build validation,
  - focused manual or automated checks for the changed functionality.

Testing strategy may be expanded once core flows stabilize.

---

# 39. Success Criteria for the Initial Product

The initial Trove experience is successful when a user can:

1. create a trip with minimal required information,
2. save global Places,
3. add Places to a specific trip,
4. build and reorganize a day-by-day itinerary,
5. understand route/travel effort,
6. preview Trip Mode before departure,
7. use Trip Mode while travelling,
8. access critical information and make supported edits with poor/no connectivity,
9. retrieve reservations/tasks/Trip Info and other supporting travel context,
10. track Budget / Projected Cost / Actual Spend without conflating them,
11. find their own Trove information through Global Search,
12. receive only contextual/actionable notifications when enabled,
13. see a trustworthy Plan Score when sufficient evidence exists,
14. complete the journey and later preserve it through private Memories and Experience Rating.

The product must remain understandable without requiring the user to learn a complex travel-management system.
