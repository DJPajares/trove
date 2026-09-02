# Trove — Product Requirements Document

**Status:** Approved as the definitive product-requirements source for implementation
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
- Add AI-assisted trip creation after the core planning/travel flows are stable while remaining extensible for further AI, social, booking, discovery, translation, and native-app features.

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

AI-assisted trip creation is an approved post-MVP roadmap phase defined in Section 7.6. It remains outside the initial release described by this non-goal list.

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
- Email/password is the initial Trove sign-in method.
- Trove must not create a second credentials/account system for a user who already exists in the shared Supabase Auth project.
- The existing `auth.users.id` remains the identity anchor for Trove-owned Profile and domain data.
- Trove establishes and manages its own application session even when the underlying Supabase Auth user is shared with another app.
- Trove application/domain data must remain isolated from unrelated application data.
- A prepared trip may remain usable offline for the last authenticated Trove user without requiring a network re-authentication solely because connectivity is unavailable. Server-authorized operations resume when connectivity and a valid session are available.
- An unauthenticated visitor to the application root is served the signed-out landing experience. The root is never a protected path, so arriving without a session is a normal state rather than a redirect or an error.
- The same root serves Home once the visitor is authenticated. Only the signed-out branch differs.
- An authenticated visitor who reaches the sign-in or sign-up routes is sent on rather than shown a form they no longer need.
- A deep link into a protected path continues to return the visitor to that path after they sign in. The redirect target is validated as an application-relative path.

## 3.7 AI Provider Direction

- AI-assisted trip creation uses a server-only, provider-neutral generation boundary. Planner domain contracts, persistence, and clients must not depend on a provider-specific request or response shape.
- Vertex AI with `gemini-3.1-flash-lite` is the development configuration while Google Cloud trial credits are available. This is an environment choice, not a permanent product dependency.
- Provider and model selection, timeouts, token budgets, availability, and budget controls are configuration-driven so changing provider/model does not change the planner contract or review UI.
- Local development may use Google Application Default Credentials. Deployed environments use server credentials managed outside source control. Credentials and provider authorization data never reach a browser bundle.
- Each user-initiated **Generate** or **Regenerate** action dispatches exactly one app-level model call. Provider grounding and deterministic validation are bounded non-model operations and do not create a conversational/follow-up loop.
- Global and budget kill switches may stop new model dispatches at any time. Disabling AI must not prevent manual trip creation or editing existing trips.
- Raw prompts, structured model output, and credentials must not appear in application logs, traces, error reporting, or content-free operational records.

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

- olive green,
- warm ivory/off-white,
- restrained terracotta accents,
- warm walnut-brown typography,
- warm taupe as the neutral ramp for borders and secondary text,
- dark mode using a deep olive-black rather than pure black.

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

Loading must preserve orientation. Keep the global shell and any already-rendered content visible during route changes and background refreshes; reserve the final geometry with layout-matched skeletons only where content has not loaded yet. Media must reserve its aspect ratio and use a stable placeholder until the image is ready. Do not fade the whole content canvas to blank, and respect reduced-motion preferences in every loading treatment.

## 4.5 Navigation

Global navigation is a signed-in surface. Its destinations all require a session, so a signed-out visitor is offered the product itself, its appearance control, and the two ways in — never a set of destinations that lead back to sign-in.

Primary global destinations:

- Home
- Trips
- Saved
- Tools

On desktop and tablet, the header contains Home, Trips, Saved, and Tools. On mobile, the bottom bar contains Home, Trips, a centered Create action, Saved, and Tools. Tools opens a dedicated launcher page and remains the current destination on each child tool route.

Search, Account, Notifications, and the Light/Dark toggle share one floating button in the upper right on every signed-in form factor. The button unfolds them downwards in that order and becomes a close control in the same position. Search leads because it is the only one of the four that starts something rather than reporting on the app.

On mobile, where the signed-in shell has no header, the floating control yields to the scroll direction so it never sits on top of a sticky trip or Trip Mode header. On desktop and tablet, it occupies the header's open right rail and remains available while the stable header is visible.

The Tools launcher introduces Currency and Task Templates through short purpose-led summaries and links to their independent pages. It never embeds every tool interface into one screen.

Trip Mode must not replace global navigation.

Trip Mode may introduce its own Now / Today / Map / Trip navigation, but the user must retain a clear way to leave Trip Mode and reach the stable global navigation on every supported form factor.

### Trip Navigation

Inside a trip, the trip itself is the subject: its name is the page heading on every trip screen, with its dates and lifecycle beneath.

Trip navigation presents only the three core experiences, in a stable order:

- **Itinerary** — Plan it.
- **Trip Mode** — Live it.
- **Memories** — Remember it.

Supporting tools — Tasks, Reservations, Expenses, Trip Info — are reachable in one interaction from a single grouped menu on every trip screen, and must never occupy the primary navigation.

The trip's Places collection is not a destination in that menu. The itinerary opens it directly, as Section 16.1 describes, so listing it again would be a second door to the same room. Wherever a trip is summarised outside its own screens — the Trips library, for example — the same rule holds: the three experiences are offered as themselves, and the tools listed are only the four above.

Trip lifecycle changes emphasis only. All three core destinations remain present and reachable at every stage; none is hidden or reordered, because navigation that rearranges itself between visits costs more than it gives.

- **Planning:** Itinerary leads. Trip Mode is offered as Preview, opening at the first day.
- **Active:** Trip Mode leads.
- **Completed:** Memories leads.

Whenever the current screen is not one of the three core experiences, its name must remain visible in the navigation so the user can always tell where they are. That includes screens reached from somewhere other than the menu, such as Places opened directly.

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

## 4.7 Signed-Out Experience

Trove is judged before anyone signs in, so the signed-out surface is part of the product rather than a gate in front of it.

The landing experience is built on **Plan it. Live it. Remember it.** and the three experiences it names — Itinerary, Trip Mode, Memories — presented in the same stable order they hold inside a trip.

Content rules:

- Describe only what Trove actually does.
- No testimonials, user counts, social proof, or fabricated screenshots.
- No claim the product does not deliver.

Sign-in and sign-up share the landing experience's framing, type, and spacing, and keep the existing email flow and its redirect behavior intact.

Mobile is the primary design reference, as it is everywhere else in Trove.

Out of scope: marketing sub-pages, pricing, analytics, and a CMS.

## 4.8 Editorial Imagery

Trove is a visual product, but the only photographs a traveller supplies are an optional trip cover and their Memories, and both arrive late. Editorial imagery fills that gap so a trip looks like a place from the moment it is created.

Editorial imagery is a **separate media track** from provider data. It is decorative, never functional: it stands in for a destination or a place, and it never claims to depict that exact building, room, or dish. Google Places photos remain excluded as a decorative source under 11.5, and this does not change that.

Rules:

- Sourced from a free editorial photography provider, resolved on demand for a destination name, or a place name and its category.
- Resolution is deterministic. The same subject resolves the same ordered collection across sessions and across travellers. The first photograph is the stable representative image used by covers and thumbnails.
- A collection contains at least one and at most three photographs. Place details may present the full collection as a carousel; other surfaces use its first photograph.
- Only each photograph's **reference** is stored: one unsized source URL, attribution metadata, intrinsic dimensions, provider alt text, and a dominant colour used as a loading placeholder. Responsive display URLs are derived at render time. Image bytes are never copied into Trove Storage, which stays user-owned media only.
- A stored collection is dated and re-resolved once stale, in the same spirit as 11.7. Fresh collections are read from Trove's database and never call the editorial provider.
- Attribution metadata is required whenever an image URL is returned, even where an authenticated surface intentionally does not render a visible credit. Public editorial surfaces may render the provider credit in their own layout; authenticated Home, Trips, and place details do not show photo-credit captions.
- Provider alt text is treated as a photographic description of the editorial image, not as factual information about the destination or Place. Place details may show it beneath the active photograph with that distinction clear.
- A global kill switch disables the service. Every surface degrades to the branded fallback, and so does an unreachable provider, an exhausted rate limit, or a subject with no photograph.

The branded fallback stays load-bearing rather than becoming a stopgap: hotlinked photography cannot be bundled into an offline trip copy, so an offline traveller sees it by design. It is specific to the place's category, using the taxonomy in section 13, so a hotel, a restaurant, and a museum never render the same placeholder. A place with no resolvable category — including every Custom Place — falls back to `other`.

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

Tools is the fourth stable global navigation destination. Its launcher provides one clear route to each tool without turning the page into a combined utilities dashboard.

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
- If a trip date change would remove one or more itinerary days that contain items, Trove must require confirmation before applying the date change.
- On confirmation, itinerary items from removed/out-of-range days are moved to **Unscheduled** with all item data and relationships preserved; they are never silently deleted.
- Expanding the trip date range creates the additional empty itinerary days. Items on dates that remain inside the new range keep their assigned dates.

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
- Starting Location represents where the traveller begins the trip.
- For the first trip day, Starting Location is used as the origin of the first calculated route segment only when there is no more specific explicit origin for that segment and the day does not begin from an explicit/inferred Daily Base.
- If a Daily Base applies to the first day, normal day routing starts from that Daily Base; Starting Location does not create an automatic extra route leg to the base. Travel from Starting Location to the first-day base must be represented explicitly in the itinerary/logistics if the user wants it routed.
- Starting Location is not the automatic base for every trip day and remains separate from Daily Base and Accommodation.

## 7.5 Travel Party

- Store an optional numeric party size.
- Default to 1.
- Traveller names are not required.
- Traveller identity and collaboration are separate concepts.

## 7.6 AI-Assisted Trip Creation

AI-assisted trip creation is the first approved AI product capability. It is an accelerator into the standard Trove planning model, not a parallel AI-only trip or itinerary system.

### 7.6.1 Entry and Interaction Model

- The primary AI entry is one free-form prompt. A traveller may name one or more places, ask Trove to suggest a destination, provide dates, describe activities, reserve work time, record meetings or transport, identify Must Go places, or state any other planning constraint in ordinary language.
- The interaction is not a chat. Trove does not ask follow-up questions before generation. Missing information is filled using the explicit assumptions below and disclosed in the draft.
- One submission starts one **Generate** action and exactly one app-level model call. **Regenerate** also uses exactly one app-level model call and creates a new draft revision only when it succeeds.
- The AI prompt is the primary trip-creation entry, but the existing manual creation route remains a complete fallback. Missing credentials, provider failure, quota exhaustion, cancellation, or a kill switch must never block manual trip creation.
- No Trip or ordinary planning record is created until the traveller reviews a valid draft and confirms **Apply**.

### 7.6.2 Assumptions and Planning Rules

- Every inferred value is represented as a reviewable assumption. The draft never presents an inference as traveller-supplied fact.
- When dates are missing, the model selects only a **3-, 5-, or 7-day** trip-length tier. Application code then assigns that duration beginning on the next Friday that is at least 14 calendar days after generation. The model does not invent exact dates outside this rule.
- When destination is missing, the model may infer a destination from the prompt, Profile home location, season, and selected trip length. The inferred destination and rationale are disclosed.
- Default pace is balanced: two to three anchor activities on a full day, with lighter arrival and departure days.
- Exact times are retained only when the traveller explicitly supplies them. Other activities use Morning/Afternoon/Evening/Anytime and an AI-estimated duration.
- Work, meetings, supplied transport, and intentional free time use normal itinerary items/blocks rather than new record types.
- User-supplied fixed commitments, Must Go requirements, exact times, and other declared hard constraints outrank suggestions. Final validation may reorder flexible suggestions or move them to **Unscheduled**, but it must not move a fixed commitment.
- A generated trip may span at most 14 inclusive days and contain at most 24 provider-backed real-place items. Custom labels/blocks do not bypass feasibility rules, and repeated references to the same real Place do not justify provider-call fan-out.

### 7.6.3 Grounding and Validation

- Generated destinations and real-place suggestions are resolved on demand through the provider rules in Sections 11 and 16. A confident provider identity reuses the canonical Trove Place.
- The complete Generate or Regenerate run may make at most **50 outbound Google calls**, shared across Text Search (New), place/detail evidence, opening-hours checks, and route checks. Provider usage accounting records the AI-planner source and billable SKU.
- Text Search and final checks request the cheapest field mask that satisfies the reviewed surface. Mutable provider data such as opening hours remains on-demand evidence and is never permanently cached as Trove-owned truth.
- Trove never fabricates provider IDs, coordinates, addresses, opening hours, routes, ratings, or confidence. Evidence needed after the provider cap is reached is labeled **Not checked**.
- An unresolved, ambiguous, unavailable, or over-cap suggestion becomes a Custom Place with an optional useful AI note and an explicit unverified/not-checked state. This does not by itself prevent Apply.
- After grounding, deterministic validation checks schema validity, duplicate places, hard-constraint conflicts, opening-hours evidence, route feasibility, and supported entity limits. A malformed or invalid result never creates partial Trip data.

### 7.6.4 Draft Review and Apply

- The review uses the normal itinerary and map language and shows assumptions, Custom Places, unverified/not-checked evidence, conflicts, provider attribution, and material warnings.
- The draft shows a numeric Plan Score alongside its validation evidence. It is computed once the itinerary is final and its places are resolved, from the opening-hours, rating and route evidence that same run already fetched, and costs no additional provider request. Because the draft is immutable, the score stays valid for its whole life.
- The draft is immutable. It is exactly what the run produced, and no surface may reorder, retime, replace, remove, or otherwise edit it. A traveller who wants a different plan uses Regenerate.
- The one field a reviewed session accepts is an optional trip description. It is session metadata rather than part of the plan, carried to the Trip on Apply, and it neither advances the draft revision nor invalidates the draft's evidence.
- Regenerate consumes the normal model quota and preserves the previous valid draft if it fails.
- Material warnings require explicit acknowledgement before Apply. Non-material unresolved places remain allowed.
- Apply is authenticated, atomic, revision-safe, and idempotent. A failure creates no partial records, and concurrent/repeated successful requests resolve to the same applied Trip.
- Apply may create only the reviewed **Trip, destinations, Daily Bases, Trip Places, Custom Places, and itinerary items**. It must not create Saved Place relationships, reservations, Tasks, Notes, Expenses, budgets, Memories, notifications, bookings, or other trip records.
- Applied records use the existing domain models, ownership rules, and editing surfaces. An AI-created Trip is an ordinary Trove Trip after Apply.

### 7.6.5 Sessions, Quotas, Retention, and Recovery

- Trove creates an owner-scoped `AiPlanningSession` before model dispatch. It stores lifecycle status/stage, raw prompt while needed, schema-versioned draft JSON, optimistic draft revision, expiry, warning acknowledgement, and the applied Trip reference.
- Generation is synchronous from the traveller's perspective but resumable: refreshing the client recovers the same session, current stage, and latest valid revision rather than starting another run.
- A failed initial Generate creates no Trip. A failed Regenerate preserves the prior valid draft and revision.
- A content-free `AiGenerationRun` records provider, model, token counts, latency, result/error classification, and timestamps for quota and operations. It stores no prompt or model output.
- Each account may dispatch at most **five** Generate/Regenerate model runs in a rolling 24-hour window. Reads, setting the trip description, warning acknowledgement, Cancel, and Apply do not consume this quota.
- Unapplied planning sessions expire after seven days. Apply or Cancel immediately removes the raw prompt and draft; expiry cleanup removes them no later than the retention boundary.
- Content-free generation-run telemetry is retained for 30 days, then deleted. Ownership, cross-user isolation, and deletion follow the private-data rules in Section 33.3.
- Initial launch is available to all signed-in users after security, privacy, quality, cost, and browser-validation gates pass. It is not a cohort-only feature, but global and budget kill switches remain mandatory.

### 7.6.6 Itinerary Duration Provenance

Each itinerary duration records one of:

- `USER_OWNED` — explicitly supplied or later edited by the traveller;
- `AI_ESTIMATED` — proposed by AI and not yet confirmed through a duration edit.

Existing and manually created itinerary durations are `USER_OWNED`. Editing an `AI_ESTIMATED` duration promotes it to `USER_OWNED`; provenance never silently changes in the opposite direction.

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

### Itinerary coverage

Home and Trips may show **itinerary coverage** as a compact informational
measure for planning and active trips. It answers how many trip days have at
least one scheduled itinerary item; it does not judge the quality of the plan.

- `plannedDays`: trip days containing at least one itinerary item assigned to
  that day.
- `totalDays`: every itinerary day in the inclusive trip date range.
- `percentage`: `round(plannedDays / totalDays * 100)`.
- Unscheduled itinerary items, daily bases, tasks, and reservations do not
  count toward coverage.
- Coverage is independent from trip lifecycle, manual readiness, and Plan
  Score. It must never change any of them.
- Completed-trip surfaces omit coverage.

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

Decorative photography is not provider data and does not come from here. It comes from the editorial image service in 4.8, which is a separate track with its own sourcing, caching, and attribution rules.

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

Show all Global Saved Places first, ordered alphabetically by the name currently known. A provider-backed Place has no name in Trove until it resolves, so the order settles as names arrive rather than withholding the list.

Do not immediately load provider search results.

### Search Entered

Order:

1. matching Global Saved Places,
2. matching provider Places results.

Selecting a Saved Place creates/reuses the Trip Place relationship.

Custom Place creation remains available without requiring provider search. It is offered alongside the results in the same field rather than behind a separate mode, so the user is never asked what kind of Place they want before knowing whether it already exists. When a search is in progress, the custom option carries what was typed.

Trip Places are a trip-level collection, not a property of a day. The itinerary opens them in an on-demand workspace beside the day being planned, entered from the trip level rather than from the day, where a Place can be added to the trip, reviewed, prioritised, annotated, removed, or added to the open day without leaving the itinerary. The same collection appears wherever it is shown; neither surface is a separate copy.

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

Trip-date-change behavior is authoritative in Section 6.1. If removed/out-of-range days contain itinerary items, Trove requires confirmation and moves those items to **Unscheduled** while preserving their data and relationships.

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

## 17.2.1 Planning Surface

The itinerary is the primary planning workspace and should stay readable before it is capable.

- A day states its date once. The day picker identifies the day being chosen; the day heading names the day being planned.
- Day configuration — resolved timezone, accommodation base, and Daily Base — is available on request rather than displayed permanently. It describes how the day resolves, not what is planned in it.
- A day note is optional content, shown quietly when written and never presented as a field the day is waiting on.
- Item actions are grouped in a single per-item menu rather than rendered as a permanent row of controls. The menu behaves identically on every form factor, so no action depends on hover.
- The day map frames the day's own locations. Other trip Places stay visible as markers because knowing what is nearby is useful, but they must not drag the viewport away from where the traveller is actually going. A day with nothing located yet frames everything instead of framing nothing.

## 17.3 Optional Item Data

Optional:

- exact time,
- Morning / Afternoon / Evening / Anytime,
- duration,
- notes,
- reservation,
- tasks,
- transport details,
- planned cost,
- linked actual Expense(s),
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

Trip Mode uses these item states:

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

When the required route/location data is available, the MVP daily route summary must show:

- number of scheduled place-backed itinerary items,
- estimated travel time,
- distance.

If route/location data is incomplete, show the available item count and an honest unavailable/partial state for travel time or distance rather than fabricating values.

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

Starting Location is **not** a fallback daily base. Its first-day route-origin behavior is defined in Section 7.4 and must not add an implicit route leg when a Daily Base already governs the start of the day.

An applicable Accommodation may provide the day's base automatically unless the user explicitly overrides the day with a Daily Base.

If multiple accommodations could apply and Trove cannot determine the appropriate base safely from their dates/times, it must not guess; the day may remain without an inferred base until clarified.

Daily Base may affect:

- route calculations,
- day start/end,
- Trip Mode.

### 18.4.1 Departure Base

A day's base is normally symmetric: the same place governs both the
morning-origin leg and the evening-return leg. A day may instead set a
separate **Departure Base** to override the return leg only, for the case
where the traveller leaves from one place and returns to a different one
(most commonly, a day spent checking out of one accommodation and into
another).

- Setting a Departure Base is optional. When unset, the day's base (explicit
  or inferred) governs both ends, unchanged from the single-base behavior
  above.
- When set, the Departure Base overrides only the end-of-day return leg; the
  day's base (explicit or inferred) continues to govern the start-of-day leg.
- Accommodation inference may resolve Departure Base independently of the
  start-of-day base on a **transition day**: if exactly two Accommodations
  apply to the day, and their check-out/check-in dates unambiguously
  identify which is ending and which is beginning that day, Trove infers the
  ending Accommodation as the day's base and the beginning Accommodation as
  its Departure Base. Anything more ambiguous (more than two applicable
  Accommodations, or dates that do not cleanly disambiguate) must not guess,
  per the rule above.
- Departure Base does not affect day timezone resolution (Section 32.1);
  timezone continues to resolve from the day's base only.
- Route rows must visually distinguish a start-of-day or return-to-base leg
  from an ordinary between-item leg, so the traveller can tell why the leg
  exists without needing to already know about Daily Base.

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
- linked Place,
- planned cost (amount + ISO currency).

Possible reservation types include:

- flight,
- accommodation,
- restaurant,
- attraction,
- train,
- rental car,
- tour.

Classification should not be mandatory unless behavior depends on it. A Reservation that supplies Accommodation/Daily Base behavior must be explicitly identified as **Accommodation** (or stored using the equivalent accommodation subtype) so routing and applicable-day rules are deterministic.

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

Contextual Tasks in Now:

- show separate **Here** and **Next** groups for tasks attached to the current and destination itinerary items,
- show every relevant task and do not repeat one itinerary item when current and next resolve to the same stop,
- keep open tasks prominent and completed tasks available in collapsed secondary content,
- quick-add attaches to current stop, then next stop, then current day, then the trip.

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

Contextual Tasks in Today:

- every destination row provides a collapsed task disclosure with stop-prefilled quick-add,
- a collapsed **Today's tasks** section follows the itinerary and deduplicates tasks attached to the selected day, tasks attached to stops on that day, and trip-level tasks due that day,
- both destination disclosures and the daily rollup start collapsed,
- the Today header provides day-prefilled task quick-add.

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

The Trip view places a dedicated Tasks section immediately after the summary. Trip-level tasks are expanded and prominent. Completed trip-level tasks remain reopenable in collapsed secondary content. Day- and stop-specific tasks remain accessible through one collapsed **Tasks by day and place** disclosure, grouped in itinerary order. The section provides trip-prefilled quick-add and a path to the full Tasks screen; Tasks are not repeated in the generic Trip tools list.

---

# 21. Preview Trip Mode

Every upcoming owned trip may open the real Trip Mode UI in a clearly labelled **Preview** state, regardless of In Progress / Ready status.

Users may select:

- trip day,
- simulated point/time of day.

The active Preview surface exposes direct controls for trip day and local time, so neither value sits behind a generic Edit action.

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

A dated Expense stores the resolved local timezone used to assign it to a trip day. Timezone inheritance/re-resolution follows Section 32.1 and must not change merely because the app is opened from another device timezone.

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

Expected cost derived only from explicit user-entered **planned cost** values in the current trip plan.

Valid MVP Projected Cost sources are:

- optional planned cost on an itinerary item, and
- optional planned cost on a Reservation, including Accommodation/Flight/Transport reservations.

Rules:

- Planned cost requires amount + ISO currency.
- If a Reservation with a planned cost is linked to an itinerary item, that Reservation planned cost is authoritative for the link and the itinerary item's planned cost is excluded from Projected Cost while the link exists.
- A separate planned purchase must be represented by a separate unlinked planned-cost source; Trove must not infer that two linked planned-cost values are separate purchases.
- Actual Expense records never feed Projected Cost.
- MVP Projected Cost must not invent AI/provider estimates.

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

Optionally show an approximate converted home-currency value together with the exchange-rate source/reference and the rate date (or effective timestamp where the provider supplies one).

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

User-facing attachment choices are:

- **Entire trip**,
- **Specific day**, followed by a trip-date selector,
- **Specific place**, followed by itinerary stops grouped by day in itinerary order.

Specific place means a specific itinerary stop, including label-only and custom-location stops. Repeated visits remain distinct and display their planned date/time for disambiguation. Unscheduled stops remain available in an **Unscheduled** group.

Minimum:

- task label.

Optional:

- due date/time,
- note,
- completed state.

A Task due date/time inherits timezone from its attachment context in this order: itinerary item, trip day, then trip reference timezone. The resolved due timezone is persisted with the dated Task and is re-resolved only when the user changes the due date/time or its attached day/item context.

Task Templates are part of the MVP under global Tools and may populate reusable trip tasks without turning Trove into a generic task manager.

Trip Mode supports quick creation and complete/reopen only. Editing and deletion remain on the full Tasks screen. Trip Mode loads the trip's task response once per shell, updates completion optimistically, rolls back failed completion changes with a retry message, and uses the existing offline mutation queue. Task-loading failure must not hide itinerary or other Trip Mode content. Preview uses the same task behavior and underlying data as live Trip Mode.

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

The MVP must support these triggers when notifications are enabled and the required source data exists:

- incomplete Task with a due date/time,
- upcoming Reservation with a date/time,
- leave-by reminder when a timed itinerary item and sufficiently reliable route duration are available.

Additional MVP triggers may include:

- upcoming trip,
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
- the **entire trip itinerary from start date through end date**,
- Trip Places and understandable Place context,
- reservation/accommodation information,
- Tasks,
- contextual Notes,
- pinned/relevant Trip Info,
- expense entry and previously loaded Expense data,
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

- itinerary item create, complete/skip, reorder/move, time/daypart edits, and delete/unschedule,
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

Provide trip offline-readiness state based on the supported categories actually prepared for the **entire trip date range**, not only the current day.

Possible categories include:

- Itinerary
- Places/context
- Reservations/accommodation
- Important selected documents
- Tasks/Notes/Trip Info
- Expenses
- Currency/route context where supported

The minimum Trove-owned payload required for **Ready** is:

- trip identity/dates and required trip metadata,
- every itinerary day and itinerary item for the full trip date range,
- Trip Place identity plus permitted location/display context needed to understand those items,
- applicable Daily Base/Accommodation context,
- implemented travel-critical Reservations, Tasks, Notes, and pinned Trip Info included in the offline contract,
- previously loaded Expense records for the trip plus the ability to queue new Expense entries.

Selected documents are required only when the user has explicitly selected them for offline use. Provider-derived route/weather/currency/place enrichment may affect freshness (`Stale`) but must not make otherwise complete Trove-owned itinerary data disappear.

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

## 29.1 Required MVP Factors

Each factor produces an internal **0–100 factor score** when applicable/evaluable, or an explicit `unknown` / `not applicable` state.

Required MVP factor groups and base weights:

These weights are the initial MVP scoring contract used for implementation and regression testing. They are internal product logic and are not exposed as a formula in normal user-facing UI. Any later recalibration must preserve the product invariants in this section and be covered by the Plan Score calibration/regression task.

| Factor | Base weight | Notes |
| --- | ---: | --- |
| Feasibility | 35% | Includes timing conflicts, opening-hours evidence, reservation/logistics conflicts, and impossible/tight transitions. |
| Travel effort | 25% | Uses known route duration/distance and relevant day/start context. |
| Pace / buffer | 15% | Evaluates whether known activity/travel timing is overpacked or has reasonable breathing room. |
| Route efficiency / backtracking | 10% | Evaluates meaningful geographic inefficiency without automatically optimizing order. |
| Must Go priority fit | 10% | Trip-scoped factor used only in the overall score; it is not assigned arbitrarily to individual days. |
| Place quality | 5% | Supporting provider-backed quality signal only; small rating differences must never outweigh feasibility/travel effort. |

Opening hours and timing conflicts are evidence inside **Feasibility**, not separate independently weighted factors.

Provider-backed **better alternatives are recommendation outputs, not an additional weighted factor**.

Must Go priority fit is always `not applicable` to day scores. For travel-heavy days, other factors that genuinely do not apply (for example Place quality) are also marked `not applicable`; remaining applicable weights are renormalized rather than penalizing the day.

### Initial Factor-Score Rubrics

These are the authoritative initial MVP calibration rules. A factor is evaluable only when at least one required evidence point for its rubric exists. A coarse daypart counts as such an evidence point only where it actually constrains the rule being evaluated; a whole-day range such as Anytime constrains nothing and is not evidence. Missing inputs remain `unknown`; they are not scored as zero. All calculated factor scores are clamped to **0–100**.

**Feasibility** starts at 100. Each distinct known conflict applies only its single highest applicable deduction:

- 50 points: a hard conflict, including overlapping fixed commitments, a planned visit entirely outside known opening hours, or a required route that arrives more than 30 minutes after a fixed start;
- 25 points: a material conflict, including arrival 1–30 minutes after a fixed start, a planned visit partially outside known opening hours, or a coarse daypart that no placement within it can satisfy after required travel;
- 10 points: a tight but still possible transition with less than 15 minutes of positive buffer after required travel.

The same underlying conflict must not be deducted more than once merely because it is detected from multiple evidence sources.

A coarse daypart is evaluated at its best case: a conflict is recorded only when no placement anywhere inside it works. An unsatisfiable daypart stays material however large the shortfall, because the traveller can move a stated preference; the 50-point band is reserved for constraints they cannot move, such as a fixed start or a closed door. A daypart whose every placement falls outside known opening hours is still a hard conflict on those grounds, since the closure is what makes it impossible.

**Travel effort** uses total known local/base-to-item/inter-item route time for the day. Structured long-distance flight/train/ferry journey duration is evaluated as logistics/feasibility rather than local travel effort.

A zero-minute total is evaluable only when all required local/base/inter-item segments are known and their total is actually zero. Missing route segments make this factor `unknown` rather than producing a zero-minute/100 score.

| Known local route time | Score |
| --- | ---: |
| 0–60 minutes | 100 |
| 61–120 minutes | 85 |
| 121–180 minutes | 70 |
| 181–240 minutes | 50 |
| More than 240 minutes | 30 |

**Pace / buffer** uses the lower score produced by the applicable rules below:

- For two or more items with a known or daypart-constrained start, use the smallest positive buffer remaining after activity duration and required travel, measuring a daypart at its best case: at least 30 minutes = 100; 15–29 = 80; 5–14 = 60; 0–4 = 40; negative buffer = 20.
- When known activity durations plus local travel describe most of the day: up to 8 hours = 100; more than 8–10 hours = 75; more than 10–12 hours = 50; more than 12 hours = 25.
- If neither timing/duration rule can be evaluated, the factor is `unknown`.

**Route efficiency / backtracking** applies when at least three stops/base points are routable. Compare planned route duration with the best available duration for the same stops while respecting fixed-order commitments:

| Planned ÷ best available route duration | Score |
| --- | ---: |
| Up to 1.10 | 100 |
| More than 1.10–1.25 | 80 |
| More than 1.25–1.50 | 60 |
| More than 1.50–2.00 | 40 |
| More than 2.00 | 20 |

This comparison is advisory and must not automatically reorder the itinerary.

**Must Go priority fit** is trip-scoped rather than assigned arbitrarily to individual days. It is `not applicable` to day scores. When at least one Trip Place is marked Must Go, the trip-level score is:

`100 × distinct Must Go Trip Places scheduled in the itinerary ÷ total distinct Must Go Trip Places`

**Place quality** uses the mean score of provider-backed places with an available current/permitted public rating:

| Public rating | Place score |
| --- | ---: |
| 4.50–5.00 | 100 |
| 4.00–4.49 | 85 |
| 3.50–3.99 | 70 |
| 3.00–3.49 | 55 |
| Below 3.00 | 40 |

Places without usable rating evidence are excluded rather than penalized. Place quality remains capped at its 5% weight.

## 29.2 Score, Completeness, and Confidence

For evaluable factors, the day score is the weighted average of factor scores using the applicable base weights above, renormalized across factors that are both applicable and evaluable.

**Completeness** and **confidence** are separate internal 0–100 values:

- Completeness = `100 × sum of base weights for evaluable day factors ÷ sum of base weights for applicable day factors`. Must Go is excluded because it is trip-scoped. A factor is evaluable only under its rubric in Section 29.1.
- Confidence = reliability/freshness of the evidence used for the evaluated factors.

For the initial MVP, evaluated evidence receives these reliability values:

- 100: explicit user-owned timing/reservation data or fresh provider/route evidence;
- 75: permitted cached provider/route evidence that is not stale;
- 50: an `AI_ESTIMATED` duration, another normal/estimated duration, or coarse daypart evidence;
- 25: stale evidence that remains safe to use with a visible stale qualification.

An `AI_ESTIMATED` duration stays at the estimated-evidence reliability level until the traveller edits it. That edit promotes its provenance to `USER_OWNED`, after which it receives the user-owned reliability level where the duration is used. Merely applying an AI draft does not promote the estimate.

Evidence too stale or incomplete to support the factor is `unknown` and affects completeness rather than receiving a misleading confidence value. Factor confidence is the mean reliability of the evidence used by that factor. Day confidence is the applicable-factor-weighted mean of evaluated factor confidence values.

Their user-facing presentation (percentage, label, meter, etc.) is a design decision, but the semantics above are authoritative.

A numeric day Plan Score is shown only when:

- completeness is at least **60%**, and
- at least one core factor (**Feasibility** or **Travel effort**) is applicable and evaluable.

Otherwise Trove withholds the number and shows `Not enough information yet` or equivalent. Missing, stale, unknown, or not-applicable evidence must never be treated as a zero/poor score merely to reach the threshold.

## 29.3 Overall Trip Score

The overall trip score uses only days that meet the numeric-score threshold above.

First calculate the completeness-weighted mean of scorable day scores, with each day's contribution weighted by `day completeness / 100`, so low-information days cannot have the same influence as well-evidenced days.

- If Must Go priority fit is `not applicable`, that completeness-weighted day mean is the overall trip score.
- If Must Go priority fit applies, the overall trip score is **90%** of the completeness-weighted day mean plus **10%** of the trip-level Must Go priority-fit score.
- If no trip day is scorable, the overall trip score is withheld even if Must Go priority fit can be calculated.

Repeated evaluation of identical evidence must produce identical results.

The **numeric 0–100 score is canonical** for MVP. User-facing qualitative labels/bands are optional presentation and must not introduce a second scoring meaning or alter calculation semantics.

Calculations use unrounded intermediate values. Displayed factor/day/overall scores are rounded to the nearest whole number using standard half-up rounding.

## 29.4 Explanations and Alternatives

Explanations are generated as concise **What works** and **Worth improving** guidance, with issues prioritized in this order:

1. feasibility/timing conflicts,
2. travel effort,
3. pace/buffer,
4. route efficiency,
5. Must Go fit,
6. supporting Place quality.

That ordering governs which explanation matters most; it does not mean the full set is displayed. Presentation follows a progressive-disclosure model. By default Trove answers only two questions: does this look good, and what should I change. That is a short plain-language verdict derived from the numeric score — shown together with a compact score badge — plus the single highest-priority entry from the ordering above, with its suggested action. The full "N out of 100" score text, the confidence and completeness meters, the remaining explanations, and — at day scope — a compact per-factor status summary appear only when the user explicitly asks for the detail.

Qualitative verdict wording is display-only. It is derived from the canonical numeric score and never feeds back into calculation, consistent with Section 29.3.

Where the numeric score is withheld under Section 29.2, Trove says so in one line and stops. It does not enumerate what it could not determine.

Where there is no result for the scope at all — a day the current calculation does not cover — the surface omits Plan Score rather than presenting an empty one. Nothing is a quieter answer than a panel explaining its own absence.

Better-alternative suggestions must preserve the user's original itinerary until the user explicitly confirms an action. Every suggestion must declare its action type:

- **Replace** — on confirmation, replace the targeted Place reference on the existing itinerary item while preserving compatible item metadata (date/time/daypart/duration/notes/priority); incompatible linked data must be reviewed rather than silently discarded.
- **Add** — on confirmation, create a new itinerary item in the suggested day/position or Unscheduled location shown to the user.

No alternative may silently add, replace, remove, or reorder itinerary items.

Trove may prefill an editable field with a deterministic proposal the user explicitly asked for, such as a suggested start time. A prefilled value changes nothing until the user saves, and abandoning the edit discards it. Trove proposes a value only when it has evidence to derive one from, and says it cannot rather than offering a default dressed as a suggestion.

## 29.5 Recalculation and Boundaries

Relevant itinerary/order/time/place/route/reservation/provider-evidence changes invalidate/recalculate affected results.

A computed result is stored and reused. It is keyed by a digest of every Trove-owned input the rubric reads, so an itinerary, order, timing, place, reservation or Must Go change invalidates it without a separate trigger. Provider evidence cannot be keyed that way — opening hours and ratings move under a plan nobody edited, and are never persisted — so a stored result also expires on age, and is recomputed once a day at the latest. A rubric change invalidates every stored result.

Plan Score remains independent from lifecycle, manual Ready status, Trip Mode availability, Preview availability, and Experience Rating.

Plan Score does not depend on AI: the rubric, weights and evidence rules are the same wherever it is computed. An AI-generated draft is scored from the evidence its own generation already fetched, through the shared evaluator, rather than by a second scoring system. MVP Plan Score must not depend on traffic-aware replanning, disruption-intelligence features, or Smart Cost Forecasting.

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

A Memory persists the resolved local timezone used for its captured timestamp. It inherits from the associated itinerary item/Place/day context, then the trip reference timezone. If the user explicitly corrects the Memory's date/time, day, or Place context, Trove re-resolves and persists the corresponding timezone; ordinary trip changes must not silently reinterpret an existing Memory timestamp.

Photo-only and note-only Memories are valid.

Do not require Experience Rating during capture and do not create Memory-level ratings.

Do not require daily journal entries, streaks, or repeated prompts.

Provider photos must never be copied into Memories or Trove Storage as if they were user-owned Memory media.

## 31.2 Completed Trip Story

Revisiting a finished trip should feel like reading and reliving it, not like reviewing a log.

Structure:

```text
Memories
└── Days                    the narrative spine, in the trip's own order
    └── Memory              rendered exactly once
        Highlights          a way into the spine
        Places              a way into the spine
```

Days is the narrative spine and follows the trip's own progression. Each Memory must be rendered exactly once in the reading flow. Highlights and Places are ways into that spine — entry points, filters, or jumps — and must never become parallel listings of the same Memories.

The reading experience must be visual:

- user photos are the leading element of a Memory wherever they exist,
- the cover carries the top of the story, using a traveller-selected Memory photo first, then the trip cover, editorial imagery, and finally Trove's branded fallback,
- captured date and time are context beneath a Memory, not the heading above it,
- the shape of the trip is felt through its progression rather than enumerated as counts.

Experience Rating for the trip and for a day must remain reachable from the story itself. Rating is offered, never asked: a rating already given is shown as itself, and one not yet given is a single quiet control on the trip and on a day's own chapter marker. It must never appear as a prompt, a question, or a call to action soliciting a rating, and must never stand beside the reading flow as something the page is waiting on. Rating is a deliberate act.

Curation must remain reachable, including by keyboard and screen reader, without those controls narrating the page. Reveal them on request.

The Trip Story should derive from the user's actual trip, itinerary context, notes, highlights, Places, and user-uploaded photos.

Sparse trips must remain valid and should not be padded with fabricated events, provider photos treated as Memories, or fictional narrative. A trip with few Memories, or none, must still read as an intentional page.

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

- A dated/timed itinerary item, reservation, or logistics record must use its applicable local timezone when it can be resolved from its Place/location.
- A trip day resolves its default local timezone in this order: explicit Daily Base, applicable Accommodation, first ordered located itinerary item with a resolvable timezone, then the trip reference timezone.
- Exact-time items without a more specific timezone use the applicable day timezone.
- Cross-timezone transport must preserve separate local departure and arrival times/timezones.
- Home, Trip Mode, Today, notifications, and date-driven lifecycle behavior must not rely on device timezone alone when a more authoritative trip/day/item timezone exists.

### Other Dated Records

All dated MVP records must persist or resolve a deterministic timezone rather than relying on the current device timezone at render time:

- **Tasks:** inherit from attached itinerary item, then trip day, then trip reference timezone. Re-resolve when the user changes the Task's due date/time or attachment context.
- **Expenses:** inherit from linked itinerary item/Place/day where available, otherwise the trip reference timezone. Persist the resolved timezone used to assign the Expense to a local day. Re-resolve only when the user changes its date/time or linked day/item/Place context.
- **Memories:** inherit from capture/associated item/Place/day context, otherwise the trip reference timezone, and persist that timezone with the captured timestamp. Re-resolve only when the user explicitly corrects the Memory's time/day/Place context.
- **Notifications:** use the timezone of the underlying dated source record/event they represent.

### Timezone Stability and Re-resolution

Persisted timezone context must not change merely because the user opens Trove from another device/location.

Re-resolution is scoped to the affected level:

- **Trip reference timezone:** re-resolve when the user changes the destination/Starting Location currently supplying that timezone or explicitly corrects the trip timezone.
- **Day default timezone:** re-resolve when that day's explicit Daily Base, applicable Accommodation, or first ordered located itinerary-item fallback changes.
- **Itinerary/reservation/logistics record:** re-resolve when the user changes that record's local date/time, linked Place/location, or assigned day.
- **Task, Expense, and Memory:** follow the domain-specific triggers under **Other Dated Records**. A later change to a trip/day default does not reinterpret a timezone already persisted on one of these records unless the user changes that record's own date/time or attachment/link context.

Updated trip/day defaults apply to newly created records and records that do not yet have persisted timezone context. Domain-specific rules take precedence over the general trip/day fallback rules for already-persisted dated records.

When timezone re-resolution changes the relationship between an instant and local civil time:

- records anchored to an authoritative instant (for example captured Memory time or provider-confirmed transport time) preserve that instant and recompute their local representation;
- user-entered floating local plans without an authoritative instant preserve the entered local date/time and recompute the derived instant;
- cross-timezone transport preserves its authoritative departure and arrival endpoint semantics independently.

If either rule changes the displayed local calendar day or derived instant, Trove must surface that consequence explicitly rather than silently moving unrelated records.

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

- Light
- Dark

Default:

- Light.

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

Explicit sign-out must remove locally accessible private authenticated data, including selected offline documents and authentication/session material. If unsynchronized local changes exist, Trove must warn that signing out will discard those unsynced local changes before completing sign-out. Cloud data is not deleted.

Offline local data must remain scoped to the authenticated Trove user and must not be exposed when a different user signs in on the same device.

---

# 34. Onboarding

Onboarding is accepted but should be implemented later in the initial development cycle.

Keep it short:

1. Welcome
2. Sign in with the existing Supabase Auth email/password flow
3. Name
4. Home location
5. Preferred/home currency

Existing users with a sufficiently complete Trove Profile should not be forced through onboarding again.

Do not initially ask for detailed travel preferences, destination interests, travel personality, notification permission, location permission, or other unnecessary permissions/configuration.

---

# 35. Future Features Register

These are recorded for future brainstorming and are intentionally not deeply specified. They are **not MVP requirements** unless another section explicitly states a narrower MVP capability.

## 35.1 Further AI

AI-assisted trip creation is approved and specified in Section 7.6. Future AI beyond that bounded creation flow may include:

- AI-assisted itinerary improvement,
- richer Plan Score explanation/help,
- trip Q&A,
- Trip Mode assistance,
- Memory curation.

AI-assisted trip creation does not authorize assistant chat, autonomous post-Apply replanning, booking, or any other future item in this list. MVP deterministic Plan Score calculation/explanations and deterministic provider-backed alternative suggestions remain independent from AI.

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

## 36.3 Approved Post-MVP Roadmap

- AI-assisted trip creation defined in Section 7.6

## 36.4 Deferred

- AI-dependent product features beyond Section 7.6
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

## Phase 8 — AI-Assisted Trip Creation

Implement only after the core planning, travel, Plan Score, and Memories flows are stable.

Sequence:

1. planning-session persistence, generation-run telemetry, retention, and duration provenance;
2. provider-neutral AI gateway and development Vertex configuration;
3. versioned planner contracts and deterministic defaults;
4. capped Google place grounding and provider accounting;
5. authenticated resumable session APIs and rolling quota;
6. one-call generation, grounding, scheduling, and validation pipeline;
7. atomic/idempotent Apply into standard Trove models;
8. AI-first composer with complete manual fallback;
9. draft itinerary/map review, essential editing, warning acknowledgement, and confirmation;
10. security, privacy, cost, quality, operational, responsive, accessibility, and launch gates.

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
