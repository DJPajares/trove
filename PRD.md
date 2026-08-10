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
    ├── Travel Wallet
    └── Task Templates
```

Travel Wallet is optional for the initial MVP if scope or security complexity becomes too large.

---

# 6. Trip Lifecycle

## 6.1 Lifecycle

A trip follows:

**Planning → Active → Completed**

The lifecycle should primarily be derived from dates.

`Upcoming` may be used as a display label but does not need to be a core stored lifecycle state.

## 6.2 Planning Readiness

Planning readiness is separate from lifecycle:

- In Progress
- Ready

Rules:

- The user manually marks a trip Ready.
- Ready does not lock editing.
- Trip Mode activation does not depend on Ready.
- Preview Trip Mode is available regardless of readiness.

---

# 7. Trip Creation

## 7.1 Required Fields

- Trip name
- Start date
- End date

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

## 7.5 Travel Party

- Store an optional numeric party size.
- Default to 1.
- Traveller names are not required.
- Traveller identity and collaboration are separate concepts.

---

# 8. Trip Ownership & Future Sharing Foundations

The data model must allow future support for:

- owned trips,
- trips shared with the user,
- saved/read-only itineraries created by others,
- copied trips,
- collaborators,
- public/private visibility.

Future-ready concepts should include:

- owner,
- creator,
- visibility,
- collaborators,
- source trip,
- attribution,
- user-to-trip relationship.

## 8.1 Saved vs Copied Itinerary

### Saved itinerary

- References another user's trip.
- Generally read-only.
- Lives under Trips.

### Copied itinerary

- Creates an independent editable trip.
- Preserves original source and attribution.

Saved itineraries do not belong under Saved Places.

Trip Mode should not operate directly on a read-only saved itinerary.

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
- planning progress,
- readiness,
- Continue Planning,
- Preview Trip Mode.

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

Possible sections:

- Active
- Planning / Upcoming
- Shared With Me
- Saved Itineraries
- Past

Avoid making every section a permanent tab.

Future filters may include:

- All
- Mine
- Shared
- Saved
- Past

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

When the user selects a Google place:

1. receive the Google Place ID,
2. find an existing provider reference,
3. reuse the existing Trove Place if found,
4. otherwise create a Trove Place and provider reference,
5. attach the requested Saved/Trip/Itinerary relationship.

Do not bulk-import Google Places during project setup.

## 11.4 Mutable Provider Data

Google remains the source for mutable data such as:

- public rating,
- opening hours,
- photos,
- public reviews,
- provider description,
- phone,
- website,
- provider categories.

This data should be fetched/refreshed as needed and only cached according to provider rules.

Trove-owned data includes:

- notes,
- priority,
- Saved relationship,
- Trip Place relationship,
- itinerary relationship,
- Memories,
- tasks,
- user Experience Rating.

## 11.5 Photos

Use the current Google photo URL/reference obtained through current provider data.

Do not permanently copy provider photos into Trove Storage.

User-uploaded trip photos are separate user-owned content.

## 11.6 Duplicate Protection

Primary deduplication:

- provider,
- external provider Place ID.

Do not perform aggressive fuzzy merging automatically.

If future provider ID changes create possible duplicates, use careful matching/merge flows rather than risking incorrect automatic merges.

---

# 12. Custom Places

Custom Places are first-class.

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
- Map,
- Memories.

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

- Removing from Saved must not remove from Trip Places.
- Removing from Trip Places must not remove from Saved.
- Adding to Trip Places does not automatically globally save the Place.
- Use the same canonical Place where possible.

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
- Google Places,
- Custom Places,
- newly selected places from Itinerary.

---

# 16. Place Search Behavior

## 16.1 Adding to Trip Places

### Empty Search

Show all Global Saved Places first.

Do not immediately load Google results.

### Search Entered

Order:

1. matching Global Saved Places,
2. matching Google Places results.

Selecting a Saved Place creates the Trip Place relationship.

## 16.2 Adding to an Itinerary Day

### Empty Search

Show all Trip Places first.

### Search Entered

Order:

1. matching Trip Places,
2. matching Google Places,
3. custom place/custom label.

Selecting a Google Place automatically creates a Trip Place relationship.

## 16.3 Global Search

Global search should find Trove-owned information such as:

- Trips,
- Trip Places,
- Saved Places,
- Memories,
- Trip Info,
- Reservations.

---

# 17. Itinerary

## 17.1 Day-Based Structure

Each date between trip start/end produces a day in the itinerary.

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

---

# 18. Routes & Maps

## 18.1 Travel Segments

Show calculated travel between itinerary items.

Initial modes:

- Drive
- Transit
- Walk

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

## 18.4 Daily Base

A day may have a daily accommodation/base.

This is distinct from trip Starting Location.

It may affect:

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
- linked itinerary item.

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

## 19.3 Accommodation

Accommodation receives first-class support because it affects routing.

Possible data:

- check-in,
- check-out,
- Place/address,
- booking information,
- applicable trip days.

---

# 20. Trip Mode

Trip Mode is the dedicated in-trip experience.

Planning asks:

> What could I do?

Trip Mode answers:

> What do I need right now?

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
- leave-by time,
- travel time,
- directions,
- weather,
- reservation/ticket shortcut,
- important alert.

### Today

Allow:

- complete,
- skip,
- reorder,
- add,
- edit time,
- directions,
- note/photo,
- expense.

### Map

Show where available:

- route,
- itinerary items,
- current location,
- nearby Trip Places,
- daily base.

### Trip

Provide quick access to:

- upcoming days,
- Places,
- Reservations,
- Tasks,
- Expenses,
- Notes,
- Trip Info,
- Travel Wallet where available.

---

# 21. Preview Trip Mode

Upcoming trips may open the real Trip Mode UI in Preview state.

Users may select:

- trip day,
- simulated point/time of day.

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

- real forecast only when available,
- normal/estimated travel durations,
- the selected itinerary point as preview context.

## 21.2 Editing

Changes made in Preview update the actual itinerary.

Support Undo.

---

# 22. Expenses & Currency

## 22.1 Expense

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
How much the user intends to spend.

### Projected
Expected cost based on user-entered planned costs.

### Actual
What the user actually spent.

Support both trip-level and per-day views where data is available.

## 22.3 Multi-Currency

Always preserve:

- original amount,
- original ISO currency.

Optionally show converted home-currency value.

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

Task Templates may populate trip tasks.

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

Initial Tools:

- Currency
- Travel Wallet
- Task Templates

No global Notes tool.

## 26.1 Travel Wallet

Potential documents:

- passport,
- visa,
- insurance,
- ticket,
- flight confirmation,
- booking document.

Travel Wallet is MVP-optional.

Sensitive information must remain private by default.

---

# 27. Notifications

Notifications should be:

- contextual,
- actionable,
- low-frequency.

Possible triggers:

- upcoming trip,
- incomplete important task,
- upcoming reservation,
- leave-by reminder,
- weather affecting plan,
- timing issue,
- post-trip Memory review.

Do not add:

- streaks,
- re-engagement nags,
- random promotional notifications.

Core functionality must remain available even if notifications are disabled/unavailable.

---

# 28. Offline Requirements

Offline support is core.

## 28.1 Must Remain Available

Where technically practical:

- Trip Mode,
- current/upcoming itinerary,
- loaded Trip Places,
- reservation information,
- Tasks,
- Notes,
- pinned Trip Info,
- offline Travel Wallet documents,
- expense entry,
- queued Memories/photos,
- cached currency rates,
- previously fetched route information.

## 28.2 Offline Editing

Support offline edits for:

- itinerary,
- tasks,
- expenses,
- notes,
- Memories,
- Trip Info.

Synchronize automatically when connectivity returns.

## 28.3 Offline Maps

Full offline map/navigation is not required in v1.

The itinerary and critical place information must remain understandable without map tiles.

## 28.4 Ready Offline

Provide trip offline-readiness state.

Possible indicators:

- Itinerary ready
- Places ready
- Reservations ready
- Important documents ready
- Trip Info ready

Allow manual refresh and show last updated time.

---

# 29. Plan Score

Implement late, after planning and route behavior is stable.

Scale:

**0–100**

Available:

- per day,
- overall trip.

Potential factors:

- feasibility,
- opening hours,
- timing conflicts,
- pace,
- travel effort,
- route efficiency,
- priority fit,
- public place quality as a supporting signal,
- clearly better nearby alternatives.

Do not heavily weight external ratings.

Do not produce false precision when the plan is incomplete.

Explanations and actionable improvements are more important than the numeric score.

---

# 30. Experience Rating

Scale:

**1–5**

Available:

- per day,
- overall trip.

The overall trip rating should be entered independently rather than automatically averaged.

Experience Rating is user-generated and must remain distinct from Plan Score.

---

# 31. Memories

Implement last, after planning/travel flows are mature.

Core principle:

> **Capture should be effortless; curation happens mostly afterward.**

## 31.1 Capture

Allow:

- photos,
- short notes,
- Highlights,
- associated Place,
- Experience Rating.

Where possible, automatically associate:

- trip,
- day,
- date/time,
- itinerary item,
- Place.

Do not require daily journal entries.

## 31.2 Completed Trip Story

Suggested structure:

```text
Memories
├── Trip Story
├── Highlights
├── Days
└── Places
```

Users must be able to:

- add/remove photos,
- edit captions,
- reorder highlights,
- hide items,
- add missing memories,
- change cover,
- edit summary.

---

# 32. Internationalization & Localization

Initial UI language:

- English only.

Requirements:

- use next-intl,
- maintain `en.json`,
- no hard-coded user-facing strings,
- architecture ready for additional locales.

User preferences should support later:

- language,
- date format,
- 12/24-hour time,
- km/mi,
- °C/°F,
- home currency.

## 32.1 Time Zones

Support local timezone context for itinerary/transport items.

Cross-timezone transport must preserve correct local departure and arrival times.

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

## 33.1 Profile

- name,
- profile photo,
- home location.

## 33.2 Appearance

- System
- Light
- Dark

Default:

- Follow system.

## 33.3 Privacy

All user data is private by default.

Future sharing must be explicit.

## 33.4 Offline Storage

Users should be able to:

- see offline trip storage,
- refresh offline data,
- delete local/offline copies.

Deleting local offline content must not delete the cloud trip.

---

# 34. Onboarding

Onboarding is accepted but should be implemented later in the initial development cycle.

Keep it short:

1. Welcome
2. Sign in/create account
3. Name
4. Home location
5. Preferred currency

Do not initially ask for detailed travel preferences or unnecessary permissions.

---

# 35. Future Features Register

These are recorded for future brainstorming and are intentionally not deeply specified.

## 35.1 AI

Purpose:

- itinerary generation,
- itinerary improvement,
- Plan Score explanation,
- trip Q&A,
- Trip Mode assistance,
- Memory curation.

## 35.2 Social & Collaboration

Purpose:

- collaborative planning,
- sharing,
- saved itineraries,
- copying trips,
- comments/recommendations,
- possible traveller profiles.

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

- text,
- voice,
- conversation translation.

## 35.6 Deeper Travel Intelligence

Potential future:

- flight-status monitoring,
- traffic-aware replanning,
- weather-driven adjustments,
- opening-hours changes,
- disruption alerts,
- smarter nearby alternatives.

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

- Reservations
- Accommodation
- Tasks
- contextual Notes
- Trip Info
- lightweight Expenses
- Currency
- Notifications
- Offline support
- optional Travel Wallet

## 36.3 Deferred

- AI
- social/collaboration
- public discovery
- booking
- translation
- live flight tracking
- automatic email parsing
- health/sleep tracking
- advanced budgeting
- Smart Cost Forecasting
- native apps

---

# 37. Development Order

## Phase 1 — Foundation

- monorepo/app foundation
- database
- authentication
- design system
- app shell
- core settings

## Phase 2 — Plan

- Trips
- Places
- Saved
- Itinerary
- maps/routes

## Phase 3 — Travel

- Trip Mode
- Preview Trip Mode
- offline behavior

## Phase 4 — Supporting

- Reservations
- Accommodation
- Expenses
- Currency
- Tasks
- Trip Info
- contextual Notes
- Travel Wallet if retained in MVP

## Phase 5 — Polish

- contextual Home
- notifications
- responsive refinement
- accessibility
- PWA refinement
- onboarding

## Phase 6 — Plan Score

Implement only after core planning/route behavior is stable.

## Phase 7 — Memories

Implement last.

Includes:

- Memory capture
- Highlights
- Experience Rating
- completed Trip Story

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
8. access critical information with poor/no connectivity,
9. track basic projected/actual spending,
10. complete the journey and later preserve it through Memories.

The product must remain understandable without requiring the user to learn a complex travel-management system.
