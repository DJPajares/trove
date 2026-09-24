# Trove — Product Requirements Document

**Status:** Approved as the definitive product-requirements source for implementation
**Product:** Trove  
**Category:** Travel Companion  
**Core philosophy:** **Plan it. Live it. Remember it.**

This document defines the current approved product, including the original MVP and approved extensions. It is a requirements contract, not a claim that every requirement has shipped or passed launch validation. Linear tracks implementation, dependencies, and known gaps; README and operational runbooks describe setup and delivery. Implementation differences do not silently amend this contract.

Section 36 summarizes current scope. Section 37 preserves the original delivery sequence as dependency guidance. References to MVP rules elsewhere retain those baseline rules unless a narrower, explicit extension is stated.

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
- Keep the traveller in control: suggestions, scores, and inferred context never silently change their plan or declare them ready.
- Preserve private user content and distinguish planned, estimated, and actually recorded information.
- Make uncertainty and unavailable information understandable without inventing precision or requiring a fully filled-in plan.

## 1.2 Target Users

Trove primarily serves independent travellers managing their own leisure or mixed-purpose trips, including one person organizing a trip for companions. It supports short outings and multi-day, multi-destination travel without requiring a different product model.

The traveller wants a useful plan and easy access to travel details, not a travel-management job. A sparse itinerary, staying with friends, overnight transport, and time deliberately left open are valid. Party size describes the trip; it does not grant companions accounts or editing rights.

Group collaboration, business travel administration, and public destination discovery are not baseline workflows.

## 1.3 Major User Journeys

1. **Collect:** save a provider-backed or Custom Place for later, optionally organize it into collections, and reuse it in a trip without losing the global Saved relationship.
2. **Create:** enter the minimum trip details manually, or generate an AI draft, review assumptions and warnings, then Apply. Both paths lead to the same ordinary Trip.
3. **Plan:** gather Trip Places, schedule repeatable stops or label-only blocks, arrange days, and add reservations, tasks, notes, and costs only when useful. Preview rehearses this same plan; explicit edits are real edits.
4. **Prepare and share:** inspect the plan, optionally declare it Ready, prepare its full offline copy, and explicitly enable a read-only itinerary link when useful. These are independent actions.
5. **Travel:** use Trip Mode for the current stop, next action, directions, and relevant supporting information. Complete, skip, or change the plan; capture expenses and Memories with minimal interruption.
6. **Recover connectivity:** continue supported work from the prepared trip, keep queued changes through reloads, and synchronize without duplicates or silent loss. Resolve ambiguous conflicts explicitly.
7. **Remember:** revisit the completed trip through private Memories, correct captured context, curate Highlights, and optionally rate the actual experience. An uncompleted plan item is not evidence that a visit happened.

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
- Offer bounded AI-assisted trip creation with a complete manual path, while remaining extensible for further AI, social, booking, discovery, translation, and native-app features.

## 2.2 Non-Goals for the Current Product

The current approved scope does not provide:

- social networking,
- real-time collaboration,
- public profiles,
- assistant chat or autonomous replanning,
- business travel administration,
- a separate Travel Wallet,
- booking/purchasing,
- full offline turn-by-turn navigation,
- automatic email parsing,
- live flight tracking,
- health/sleep tracking,
- advanced accounting,
- automatic Smart Cost Forecasting,
- native iOS/Android apps,
- full multilingual UI.

AI-assisted trip creation (Section 7.6) and owner-enabled read-only itinerary links (Section 8.2) are approved extensions to the original MVP. Neither authorizes the broader AI, collaboration, or discovery workflows deferred here.

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

## 3.5 Monorepo Structure

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
- Vertex AI is the initial provider integration. Model identifiers, credentials, and development-credit arrangements belong in deployment configuration and the AI runbook, not in the product contract.
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

Trip Mode may introduce its own Now / Today / Map / Trip navigation, and on mobile that navigation takes the bottom bar for the duration: two navigations stacked on one phone screen is one too many, and the traveller's thumb can only reach the lower one. The global bar and its Create action step aside while a Trip Mode route is open, and return the moment it is left.

Trip Mode must not become the only way out. Wherever it replaces the global bar it must carry a permanent, visible Exit that returns to the trip it belongs to, from which the stable global navigation is one further tap — on every supported form factor. On desktop and tablet, where there is no thumb zone to compete for, the global navigation stays where it is and Trip Mode's own navigation sits beneath its header.

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
- **Completed:** Memories leads. Trip Mode remains reachable as Preview, opening at the first day.

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
- Source permissions and attribution requirements must be compatible with this design. A hidden caption preference is not permission to omit attribution that a provider requires; use a compatible source or the branded fallback.
- Provider alt text is treated as a photographic description of the editorial image, not as factual information about the destination or Place. Place details may show it beneath the active photograph with that distinction clear.
- A subject with no photograph of its own draws on a **shared fallback pool**: photographs of its category rather than of it, resolved once and shared by every subject and every traveller. The pool is not a subject collection and is not bound by the three-photograph limit or the first-photograph rule — a surface picks from it by a stable seed of its own, so one trip keeps its photograph for life while the trip beside it shows a different one. A pool of one is what makes every trip look identical, which is the failure this exists to prevent.
- A global kill switch disables the service. Every surface degrades to the branded fallback, and so does an unreachable provider, an exhausted rate limit, or a subject with no photograph and an empty pool.

The branded fallback stays load-bearing rather than becoming a stopgap: hotlinked photography cannot be bundled into an offline trip copy, so an offline traveller sees it by design. It is specific to the place's category, using the taxonomy in section 13, so a hotel, a restaurant, and a museum never render the same placeholder. A place with no resolvable category — including every Custom Place — falls back to `other`.

---

# 5. Core Product Architecture

```text
Trove
├── Home
├── Trips
│   └── Trip
│       ├── Overview (summary and entry points)
│       ├── Itinerary — Plan it.
│       │   └── Trip Places (contextual workspace)
│       ├── Trip Mode — Live it. (or Preview)
│       ├── Memories — Remember it.
│       └── Supporting tools
│           ├── Tasks
│           ├── Reservations / Accommodation
│           ├── Expenses
│           └── Trip Info
├── Saved
└── Tools
    ├── Currency
    └── Task Templates
```

The three core experiences have stable navigation under Section 4.5. Overview summarizes the trip; it is not a fourth core experience. Notes live with their context, not in a separate Notes destination. An enabled read-only itinerary link is a limited public projection of the same plan, not another owned trip.

Tools is the fourth stable global navigation destination. Its launcher provides one clear route to each tool without turning the page into a combined utilities dashboard.

## 5.1 Core Concepts

| Concept | Meaning and boundary |
| --- | --- |
| Trip | One owned journey with inclusive dates, a description, and a shared planning/travel/memory context. |
| Place | An internal identity for a provider-backed location or a private Custom Place; it is not a visit. |
| Saved Place | A user's global relationship to a Place for reuse across trips. |
| Trip Place | A trip's working relationship to a Place, whether scheduled or only being considered. |
| Itinerary item / stop | One occurrence of a Place or a label-only block, assigned to a day or Unscheduled. Repeated visits remain distinct. |
| Reservation | A record of a booking or logistics, optionally linked to a stop; it does not itself schedule a stop or record actual spend. |
| Memory | Private user-authored media or text about the experience, with correctable captured context. |
| Trip description | The traveller's framing of the trip; distinct from contextual reminders and from the post-trip story summary. |

## 5.2 Independent Trip Signals

| Signal | Question it answers |
| --- | --- |
| Lifecycle | Is the trip before, within, or after its dates in its reference timezone? |
| Manual readiness | Has the traveller declared the plan Ready? |
| Itinerary coverage | How many trip days contain a scheduled item? |
| Trip preparedness | How much activity/base context is recorded? It does not judge actual preparedness. |
| Ready Offline | Is the full required trip payload available on this device, and how fresh is it? |
| Plan Score | How does the plan evaluate against the available evidence? |
| Experience Rating | How did the traveller rate the actual experience? |

None substitutes for another. A Ready plan can be unavailable offline; an offline-ready trip can be sparsely planned; a high Plan Score does not predict enjoyment.

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

### Changing Trip Dates

The plan is anchored to the start date: **Day 1 stays Day 1**. Moving the start shifts existing planning days by the same calendar-day offset. In the trip editor, changing the start carries the end with it to preserve duration unless the traveller also changes the end. Changing duration adds or removes days at the end, after any shift. Moving earlier and keeping the old end therefore appends empty days rather than prepending them.

- Retained planning days preserve their items, order, names, notes, explicit bases, and timezone context. Floating local plans preserve their local times; derived instants are recomputed under Section 32.1. A daylight-saving gap is surfaced for correction rather than silently choosing a different time.
- Bookings, authoritative transport instants, recorded expenses, captured Memories, and Experience Ratings keep their real-world dates. Existing Task due dates also stay fixed unless explicitly edited; an undated task may follow its planning attachment. Moving a plan must not move a flight, rewrite history, or infer new accommodation coverage from an old day association.
- Show records left outside the trip range or inconsistent with their moved planning attachment in their relevant supporting/history view. Preserve them for correction; do not hide or silently retime them.
- Before shortening a trip with affected content, show the impact and require confirmation. Items on removed days move to **Unscheduled**, preserving their metadata, execution state, Place relationships, and supporting records. Extending adds empty days.
- Day-only notes must be reassigned to a retained day or explicitly discarded before removal; a generic date-change confirmation is not consent to delete them. Day ratings and captured history remain accessible under their original dates even when those dates leave the itinerary range.
- Removing a day must not delete its Tasks, Reservations, Expenses, or Memories. Preserve their dated context and detach invalid planning links. Removing the day assignment from a floating item clears its derived scheduled instant; it does not clear an authoritative event instant.

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
- Lifecycle and Plan Score never set readiness; only the traveller does.
- Trove may suggest marking a plan Ready when the itinerary covers every trip day, and may point out an unmarked plan as departure approaches. Both only ask.
- Trip preparedness, like itinerary coverage, may be shown to the traveller and may inform what Trove asks. Neither ever sets readiness on its own.
- Planning trips marked Ready show that marker wherever trips are listed. The Planning section may group Ready and In Progress trips, ordered by date within each group; readiness never moves a trip into another lifecycle section.

---

# 7. Trip Creation

## 7.1 Required Fields

- Trip name
- Country or countries
- Start date
- End date

Start/end dates are inclusive and end date cannot precede start date.

At least one country is required on every creation path, including AI Apply, and when countries are explicitly saved. Store declared countries as ordered ISO country codes rather than relying on parsing free-text destination names. A country's timezone is a fallback, not proof of the exact timezone of every stop. Legacy trips without countries remain usable without a forced migration or a new requirement on unrelated edits.

## 7.2 Optional Fields

- Destination(s)
- Cover photo
- Travel party size
- Starting location override
- Description

## 7.3 Destinations

- Zero, one, or multiple destinations are allowed.
- Destinations may represent cities, regions, or countries.
- A trip may span multiple countries without creating separate trips, which is
  why the required country field takes several.
- Destinations remain free text and optional. They say where inside a country a
  traveller is going; the country field says which countries, declared rather
  than inferred from those strings.
- Manual creation asks for countries and leaves destinations for later. AI creation may include reviewed destinations when applying the draft.
- A trip's reference time zone comes from its declared country when no
  destination resolves one, rather than from parsing a destination string. The
  declared country is also what an editorial photograph pictures a trip by when
  it has no destination and no cover of its own.

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
- Traveller-supplied exact times are retained as fixed commitments. Other activities begin with Morning/Afternoon/Evening/Anytime intent, then Trove assigns an estimated exact local time when its deterministic timing pass can find a feasible placement from the itinerary order, duration, and available opening-hours/route evidence. When it cannot, the original daypart remains the honest fallback.
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

- The review uses the normal itinerary and map language and shows assumptions, Custom Places, unverified/not-checked evidence, conflicts, how much of the plan was verified, and material warnings. Verification means the place's identity was resolved; it is not a guarantee of hours, route feasibility, or availability. Provider names need not be part of the decision copy, but required source attribution remains available under Section 11.
- The draft evaluates Plan Score from the opening-hours, rating, and route evidence that the same run already fetched, with no additional provider requests for scoring. The shared thresholds in Section 29 determine whether a number is shown; insufficient evidence withholds it. The result is a generation-time assessment. An immutable plan does not make its evidence permanently fresh: retain its evidence/evaluation timestamps and apply the age limits in Section 29.5.
- The draft is immutable. It is exactly what the run produced, and no surface may reorder, retime, replace, remove, or otherwise edit it. A traveller who wants a different plan uses Regenerate.
- Review accepts trip title and optional description overrides as session metadata. They persist across reloads and Regenerate, carry to the Trip on Apply, and do not change the draft revision or its warning acknowledgement. Clearing a title override restores the generated title. Neither field edits the itinerary.
- Review must also resolve the required country metadata before Apply. Inferred countries are disclosed as assumptions; the traveller can supply or correct them without a new model call. Countries cannot be silently omitted or invented. A correction does not rewrite the immutable stops or dates; it invalidates any assessment dependent on the previous country/timezone context and requires acknowledgement of affected warnings before Apply. Correcting metadata is not a way to relocate the generated itinerary; that requires Regenerate or ordinary editing after Apply.
- Regenerate consumes the normal model quota and preserves the previous valid draft if it fails.
- Material warnings require explicit acknowledgement before Apply. Non-material unresolved places remain allowed.
- Apply is authenticated, atomic, revision-safe, and idempotent. A failure creates no partial records, and concurrent/repeated successful requests resolve to the same applied Trip.
- Apply may create only the reviewed **Trip, destinations, Daily Bases, Trip Places, Custom Places, and itinerary items**. It must not create Saved Place relationships, reservations, Tasks, Notes, Expenses, budgets, Memories, notifications, bookings, or other trip records.
- Applied records use the existing domain models, ownership rules, and editing surfaces. An AI-created Trip is an ordinary Trove Trip after Apply.
- Reusing the draft's score on Apply preserves the original evidence age and estimates' provenance. Apply never resets the score's freshness clock; expired evidence cannot become a fresh numeric score on the new Trip. A stale assessment does not by itself prevent Apply once its limitations and material warnings are acknowledged.

### 7.6.5 Sessions, Quotas, Retention, and Recovery

- Trove creates an owner-scoped `AiPlanningSession` before model dispatch. It stores lifecycle status/stage, raw prompt while needed, schema-versioned draft JSON, optimistic draft revision, expiry, warning acknowledgement, and the applied Trip reference.
- Generation is synchronous from the traveller's perspective but resumable: refreshing the client recovers the same session, current stage, and latest valid revision rather than starting another run.
- A failed initial Generate creates no Trip. A failed Regenerate preserves the prior valid draft and revision.
- A content-free `AiGenerationRun` records provider, model, token counts, latency, result/error classification, and timestamps for quota and operations. It stores no prompt or model output.
- Each account may dispatch at most **five** Generate/Regenerate model runs in a rolling 24-hour window. Reads, correcting review metadata, warning acknowledgement, Cancel, and Apply do not consume this quota.
- Unapplied planning sessions expire after seven days. Apply or Cancel immediately removes the raw prompt and draft; expiry cleanup removes them no later than the retention boundary.
- Expired sessions cannot be read or applied. Retention covers private session metadata and derived review content as well as the prompt/draft; only the applied Trip's ordinary content and content-free operational/idempotency records may survive terminal-session cleanup. A cleanup schedule must meet these bounds rather than extending them implicitly.
- Content-free generation-run telemetry is retained for 30 days, then deleted. Ownership, cross-user isolation, and deletion follow the private-data rules in Section 33.3.
- Initial launch is available to all signed-in users after security, privacy, quality, cost, and browser-validation gates pass. It is not a cohort-only feature, but global and budget kill switches remain mandatory.

### 7.6.6 Itinerary Duration Provenance

Each itinerary duration records one of:

- `USER_OWNED` — explicitly supplied or later edited by the traveller;
- `AI_ESTIMATED` — proposed by AI and not yet confirmed through a duration edit.

Existing and manually created itinerary durations are `USER_OWNED`. Editing an `AI_ESTIMATED` duration promotes it to `USER_OWNED`; provenance never silently changes in the opposite direction.

---

# 8. Trip Ownership & Sharing

Trips are **private by default and edited only by their owner**. Read-only itinerary links in Section 8.2 are the sole approved public exception; they do not expose the whole Trip.

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

Future-ready fields do not authorize additional collaboration, discovery, or sharing workflows beyond Section 8.2.

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

Shared With Me, collaborators, saved itineraries, Copy to My Trips, public discovery, and source-attribution UI remain deferred.

## 8.2 Read-Only Itinerary Links

An owner may explicitly enable a link so companions can read the plan without an account. Anyone who receives the link can read its limited contents and pass it on; it is not an invitation restricted to named people. Sharing stays off by default, is not enabled by copying a URL, and grants no editing rights.

The public projection contains only:

- trip name, description, countries, and inclusive dates;
- scheduled days' dates, names, and notes;
- scheduled stops' names, addresses/custom location text, dayparts, local start/end times, durations, and notes, including scheduled Custom Places and label-only blocks.

It excludes Saved and Trip Place collections, Unscheduled items, costs/budgets/Expenses, priority, completion/skip state, provider IDs and coordinates, Tasks, Reservations and their documents, Trip Info, Memories, Experience Ratings, private media, and account details. Shared notes and addresses may contain personal information; the owner must see what will be disclosed before enabling sharing. While enabled, the link reflects subsequent edits to these shared fields.

Rules:

- Enabling and disabling sharing require server confirmation and are not queued offline. A failed change must not be presented as successful.
- After revocation, subsequent public reads must be denied, including through application/CDN caches. Private, revoked, missing, and deleted trips produce the same unavailable response. Revocation cannot recall a copy already viewed or saved by a recipient.
- Public reads use only the allowlisted projection and permitted stored Place context; they cannot trigger billable provider calls or expose authenticated endpoints. Missing or expired provider detail degrades to available context.
- The page is excluded from indexing and discovery. It offers no maps, Trip Mode, copying into an owned Trip, collaborator management, expiry, or recipient permissions in the current scope.
- Private Custom Places remain owner-owned. Sharing a scheduled stop's name/address/notes exposes only that projection, not access to its underlying private Place record.

---

# 9. Home

Home is contextual and should show the most relevant current state.

## 9.1 No Upcoming Trip

Prioritize:

- Create Trip,
- previous Memories.

Saved Places are not surfaced on Home. They have a destination of their own in
global navigation, and a list of them here competed with the one thing this
state exists to offer.

## 9.2 Upcoming/Planning Trip

Prioritize:

- next trip,
- countdown,
- readiness,
- Continue Planning,
- Preview Trip Mode,
- relevant preparation/offline readiness when useful.

The following coverage measures are the only defined planning-progress indicators. Do not add another generic score or status beside them.

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

### Trip preparedness

Home and Trips may show **trip preparedness** as a compact informational
measure for trips still being planned. It describes recorded activity/base coverage, not whether the traveller is prepared to depart.

Where itinerary coverage counts days with items, preparedness also counts days with a recorded base. A base is not proof of a booked hotel or a night covered. Flexible days, stays with friends, and overnight transport do not require artificial items or accommodation entries to satisfy this measure. Low coverage never blocks travel or manual Ready.

- `daysPlanned`: trip days containing at least one itinerary item assigned to
  that day. The same measure as coverage's `plannedDays`, reused rather than
  redefined.
- `daysWithStay`: trip days with a resolvable base - a daily base, a daily
  base departure, or an accommodation reservation covering that day. It
  resolves the same way the itinerary's own routing resolves a day's base, so
  the measure and the itinerary can never disagree.
- The two components carry equal weight.
- `percentage`: of the two marks available per trip day, the share actually
  made.
- A single-day trip has no night to cover, so the stay component does not
  apply and preparedness uses only the planned-days percentage. A component that does not
  apply leaves the denominator rather than scoring zero.
- Preparedness is advisory. It is independent from trip lifecycle, manual
  readiness, and Plan Score, and must never change any of them.
- Preparedness is not readiness and must never be labelled as it. Readiness is
  the traveller's own declaration; preparedness only describes what is on the
  plan.
- Planning-phase surfaces show it. Trips marked Ready, active trips, and
  completed trips omit it.

## 9.3 Active Trip

Prioritize:

- current trip,
- next itinerary item,
- Trip Mode, offered as continuing the trip rather than opening a mode.

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

This evidence is resolved on demand for a surface or calculation that needs it, not persisted as a permanent Trove-owned dataset. Any transient reuse must remain within provider permissions and retain its original age. Stored derived assessments follow their own expiry rules and must not become a back door for retaining raw mutable evidence.

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

When a functional Place surface uses provider photos, use the current provider photo URL/reference obtained through current provider data and preserve required attribution. Google Places photos are not a decorative source for trip covers or generic thumbnails.

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

- Trove may retain dated snapshots of durable Place display/location data and travel legs already requested by a user, subject to provider permission. The internal maximum is 30 days; shorter provider-specific limits take precedence. Fresh permitted snapshots should be reused, and stale snapshots refreshed on demand rather than through blanket background fetching.
- Provider-backed Places may use only provider-permitted cached display/location data for the offline experience.
- Cached provider-derived data is a snapshot, not canonical truth, and should retain source/freshness or last-updated context where relevant.
- Stale data must not be presented as guaranteed current data when freshness materially affects a decision.
- When connectivity returns, Trove should refresh/re-resolve mutable provider data where appropriate.
- Trove must not promise permanent/full offline Google Places or Google Maps data.
- If provider-derived detail is unavailable offline, Trove should preserve understandable Trove-owned itinerary/relationship context rather than fabricate missing provider information.

## 11.8 Provider Cost and Attribution Boundaries

- Request the least expensive fields sufficient for the surface or calculation. Identity/location-only use must not fetch hours, ratings, or photos merely because a richer response is available.
- Bound fan-out across trips, days, and repeated Places. Reuse permitted evidence within one operation; navigation and background refresh must not repeatedly purchase the same data without a product need.
- Preserve source/freshness metadata and required attribution. Editorial imagery follows Section 4.8 separately; its hidden credit captions do not waive attribution requirements for functional provider data.
- Provider outages, quotas, or kill switches must degrade enrichment without preventing access to Trove-owned plans or manual editing. Public itinerary reads never dispatch billable provider requests.
- Internal cache durations and UI preferences never override provider permissions. Do not claim that every field from a provider has the same caching or attribution allowance.

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

The traveller may locate or correct a Custom Place later from its details. They can enter location information or explicitly request a lookup and choose a candidate. Ambiguous matches are presented for selection; failure leaves the Place unchanged and does not trigger retries on every visit. No bulk background resolution is implied.

Locating updates the owned Custom Place's location without silently converting it into a shared canonical provider Place. Existing Saved, Trip Place, itinerary, and Memory relationships keep their identity; affected maps and routes use the corrected location. Provider-derived lookup data remains subject to Section 11 even when used to locate a Custom Place.

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
- Repeated visits to the same Place are separate itinerary items sharing one Trip Place. Completing, skipping, or attaching a Task to one visit does not affect the others.
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

Trip-date-change behavior is authoritative in Section 6.1: moving the start preserves ordinal planning days, then duration changes are reconciled at the end. Removal requires the content-preservation and confirmation rules there.

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
- explicit end time,
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

An explicit end time requires an exact start and defines the duration; conflicting end-time and duration values cannot both be authoritative. A same-day end must follow its start. Overnight/cross-timezone transport uses explicit departure and arrival dates/timezones under Section 19.2 rather than guessing that an earlier clock time means tomorrow.

## 17.4 Reordering

Support:

- drag-and-drop,
- move earlier/later,
- move to another day,
- duplicate,
- remove,
- unschedule.

Drag-and-drop must not be the only mechanism.

Deleting a stop does not delete linked Reservations, Tasks, Expenses, or Memories. Detach the removed stop link, preserve the records and their own dated context, and keep them reachable in the relevant trip views. Duplication creates another planning occurrence; it does not duplicate bookings, actual expenses, captured Memories, or completion/skip history.

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

This contributes to Plan Score when enough evidence exists.

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

Global navigation must remain reachable while Trip Mode provides its own Now / Today / Map / Trip navigation, under the terms in Section 4.5.

Trip Mode is read standing up, one-handed, outdoors, often while walking. Its chrome is therefore held to what a traveller cannot supply themselves: the way out, the trip's name as a quiet anchor, and the local time. A trip's cover photograph, its country and its date range belong to the surfaces that introduce a trip, not to the one that runs it — on a phone they cost most of the first screen, and the answer to "what do I need right now" must not begin below the fold.

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

- the live traveller clock or selected Preview clock defined in Section 32.1, preserving authoritative item instants,
- exact time/daypart when available,
- itinerary order,
- completed/skipped state.

Missing timing/location data must produce an honest fallback rather than fabricated precision.

Where a leave-by time exists it is stated as time remaining rather than as a clock reading, with the absolute time kept alongside it. A traveller reads the countdown and puts the phone away; a clock reading asks them to do the arithmetic first.

Contextual Tasks in Now:

- show separate **Here** and **Next** groups for tasks attached to the current and destination itinerary items,
- show every relevant task and do not repeat one itinerary item when current and next resolve to the same stop,
- keep open tasks prominent and completed tasks available in collapsed secondary content,
- quick-add attaches to current stop, then next stop, then current day, then the trip.

### Today

Today opens on the day being lived, scrolled to the stop in progress rather than to the start of the day, and offers every other day of the trip without leaving Trip Mode. Reading another day never moves the traveller's own "now": no item outside the current day is ever marked as happening.

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

The map is the view. It fills the screen it is given, with the day's route summary, stops, base and location controls carried over it rather than stacked above it.

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
- selected reservation documents.

The Trip view places a dedicated Tasks section immediately after the summary. Trip-level tasks are expanded and prominent. Completed trip-level tasks remain reopenable in collapsed secondary content. Day- and stop-specific tasks remain accessible through one collapsed **Tasks by day and place** disclosure, grouped in itinerary order. The section provides trip-prefilled quick-add and a path to the full Tasks screen; Tasks are not repeated in the generic Trip tools list.

---

# 21. Preview Trip Mode

Every planning or completed owned trip may open the real Trip Mode UI in a clearly labelled **Preview** state, regardless of In Progress / Ready status. Active trips use live Trip Mode by default. Preview never changes the trip's lifecycle or pretends a completed journey is live.

Users may select:

- trip day,
- simulated point/time of day.

The active Preview surface exposes direct controls for trip day and local time, so neither value sits behind a generic Edit action. The selected time is interpreted in that day's resolved timezone, not the device timezone used for live Trip Mode.

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

## 21.3 Weather Context

Weather supports planning and travel across Home, Itinerary, and Trip Mode. It is contextual information, not a separate planning or disruption engine.

- Distinguish current conditions, a forecast for a named date/hour and location, and an archived forecast saved for a past trip day. An archived forecast records what was predicted, not what actually happened, and must never become an observed-weather claim in Memories.
- Prefer the relevant day's located base, then a located stop, then useful trip context. If a nearby day or trip location supplies a fallback, disclose that location rather than imply a precise forecast for an unlocated stop. Do not infer physical location from a timezone name.
- Show hourly evidence only for the date/location it describes. Browsing another day or Preview must not reuse today's conditions as that day's forecast. Dates outside the available forecast horizon have an honest unavailable state.
- Evidence age is measured from its source observation or forecast retrieval, not from when a client reloaded a cached response. Current conditions that are too old become unavailable as current; a dated forecast may remain useful with its original date, location, and freshness context.
- Retain available forecasts for past trip days as archived forecasts. Do not fabricate an archive for days that were never fetched, and do not let later date/location edits relabel an old forecast as evidence for a different day or place.
- Offline/provider failure preserves useful dated cached forecasts with honest context. Freshness details may be progressively disclosed; no stale reading may be presented as current. Weather failure never hides the itinerary or triggers automatic replanning.

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

- day,
- owned Custom Place or the user's Saved/Trip Place relationship,
- itinerary item,
- reservation.

The trip itself has a Description for its purpose and framing, not a second trip-level Notes field. Practical trip-wide reference information belongs in Trip Info. Notes on shared provider-backed Places must remain private relationship content, never shared canonical Place data. Day and scheduled-item notes are included only in an explicitly enabled itinerary link under Section 8.2.

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

Current Tools:

- Currency
- Task Templates

No global Notes tool.

## 26.1 Travel Wallet — Deferred

Potential documents:

- passport,
- visa,
- insurance,
- ticket,
- flight confirmation,
- booking document.

Travel Wallet is explicitly outside the current baseline. A separate passport/visa/insurance document library requires a future scoped product and security decision; it is not an optional implementation choice within another task.

Reservation attachments remain in scope under Section 19.1, including explicit selection for offline use under Section 28. These do not depend on or imply a global Wallet.

Core planning, Trip Mode, offline travel, and Memories must not depend on Travel Wallet.

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
- a minimal invitation to revisit post-trip Memories, without soliciting an Experience Rating.

Do not add:

- streaks,
- re-engagement nags,
- random promotional notifications.

Core functionality must remain available even if notifications are disabled/unavailable.

Notification permission should be requested contextually after user intent/usefulness is established, not automatically during first-run onboarding.

### Delivery and Event Validity

- Required reminders must support delivery while the Trove page/PWA is closed on supported platforms, with permission granted and connectivity available. Foreground polling alone does not satisfy this requirement. Platform restrictions, delivery delays, and offline devices mean exact-time delivery and offline alarms are not guaranteed.
- Provide in-app notifications plus optional browser/PWA delivery, global controls, and per-trip mute. Denial or lack of background support is visible in notification settings and leaves the in-app experience usable.
- Use the underlying event's persisted timezone/instant, not the receiving device's timezone. The live Trip Mode clock exception does not silently retime Task or Reservation reminders.
- Revalidate an event before dispatch: completed Tasks, removed/cancelled events, completed/skipped stops, muted trips, and events no longer actionable must not produce reminders. Schedule edits replace the obsolete reminder; reconnecting must not deliver a backlog of expired alarms.
- Deduplicate each event reminder across retries. A material event change may produce a replacement reminder, not repeated messages for unchanged data.
- Use known event and route evidence. Background delivery is not authorization for unbounded provider polling, live traffic monitoring, or automatic replanning.

Advanced disruption monitoring, traffic-aware replanning, weather-driven replanning, live flight monitoring, and broader travel intelligence remain future features.

---

# 28. Offline Requirements

Offline support is core.

## 28.1 Guaranteed Offline Experience

After successful preparation for offline use, Trove must preserve the following supported travel information. Merely visiting one trip screen does not guarantee the full trip is prepared:

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
- reservation documents explicitly selected and successfully downloaded for offline use.

Provider-derived cached data must follow the provider/freshness rules in Section 11.7.

Critical itinerary/place information must remain understandable without live map tiles or fresh provider calls.

Preparation must report incomplete or failed downloads and unavailable local storage; it cannot claim Ready when the required payload is missing. Local copies are device-specific and may be removed by browser/OS storage clearing. Re-check availability rather than treating a past successful preparation as a permanent guarantee.

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

The offline write contract is:

| Domain | Supported offline writes |
| --- | --- |
| Itinerary | Create label-only items or use already available Trip Places; complete/skip and undo; reorder/move; edit local timing/daypart/duration and item notes; delete/unschedule. |
| Day context | Edit day name and note; move/swap planning contents between existing days without retiming real-world records. |
| Tasks | Create, edit, complete/reopen, and delete within the prepared trip. |
| Expenses | Create, edit, and delete while preserving original amount/currency and dated context. |
| Trip Info | Create, edit, and delete. |
| Memories | Capture note-only or photo Memories, queue media upload, and delete/cancel queued captures without uploading them later. |

Offline support does not imply provider search/grounding, AI generation or Apply, new routing, reservation editing/document download, public-share changes, or trip creation/date-range changes/deletion. Those require connectivity; cached reads remain available. Other contextual notes are readable when prepared, but write support is limited to the domains above. Post-trip Memory curation beyond capture/deletion requires connectivity.

Synchronization requires a valid server session; loss of authorization pauses the queue without losing local work or leaking it to another account. If the cloud trip has been deleted, do not recreate it by replaying queued edits. Explain the conflict and require an explicit decision before discarding pending work.

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
- travel-critical Reservations, Tasks, Notes, and pinned Trip Info included in the offline contract,
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

Plan Score is part of the current product and depends on stable planning and route behavior.

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
- 50: an `AI_ESTIMATED` duration, an AI-estimated exact start, another normal/estimated duration, or coarse daypart evidence;
- 25: stale evidence that remains safe to use with a visible stale qualification.

An `AI_ESTIMATED` duration or exact start stays movable and at the estimated-evidence reliability level until the traveller edits that value. The edit promotes the changed value's provenance to `USER_OWNED`, after which it receives the user-owned reliability level where it is used. Merely applying an AI draft does not promote either estimate.

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

A computed result is stored and reused. It is keyed by a digest of every Trove-owned input the rubric reads, so an itinerary, order, timing, place, reservation or Must Go change invalidates it without a separate trigger. Provider evidence cannot be keyed that way — opening hours and ratings move under a plan nobody edited, and are never persisted — so a stored result also expires after at most 24 hours. A rubric change invalidates every stored result.

Age is measured from the original evaluation/evidence timestamps, never from a cache read or AI Apply. An expired result is not a current score: when online, recompute on the next request using permitted fresh evidence; when unavailable, show a dated stale assessment or withhold the number. This is demand-driven expiry, not a requirement to call providers daily for every idle trip.

An immutable AI draft retains its original generation-time assessment without buying new evidence merely because review is reopened. Once that assessment expires, it is labelled stale rather than current. Regenerate may produce new evidence within the normal run cap; after Apply the ordinary trip's recalculation rules apply. Reuse across Apply preserves timestamps and requires matching scoring inputs.

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

Memories are part of the current product and build on the shared planning/travel context.

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

Planned stops are context, not proof of a visit. Do not mark an activity completed, invent a Memory, or imply that archived forecast weather was observed merely because the trip dates have passed. Records kept from dates outside a later-edited itinerary remain accessible by their captured dates under Section 6.1.

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
3. the deterministic default timezone of the first declared country that has one,
4. trip Starting Location,
5. Profile home location,
6. device timezone captured as the final fallback when the trip is created/first resolved.

The fallback must be persisted/resolved deterministically so lifecycle does not change merely because the user later opens the same trip from another device timezone.

A country may contain multiple timezones. Its configured default is an explicit fallback, not an assertion that all its destinations use that zone. More specific resolved location context takes precedence. Timezone resolution must not require another creation field or a provider call for every stop on every read; unresolved locations remain honestly on their documented fallback.

### Day and Item Timezones

- A dated/timed itinerary item, reservation, or logistics record must use its applicable local timezone when it can be resolved from its Place/location.
- A trip day resolves its default local timezone in this order: explicit Daily Base, applicable Accommodation, first ordered located itinerary item with a resolvable timezone, then the trip reference timezone.
- Exact-time items without a more specific timezone use the applicable day timezone.
- Cross-timezone transport must preserve separate local departure and arrival times/timezones.
- Home, notifications, and date-driven lifecycle behavior must not rely on device timezone alone when a more authoritative trip/day/item timezone exists. Trip lifecycle in particular stays on the trip reference timezone, so a trip does not change phase because its owner boarded a plane.
- **Live Trip Mode is the exception, and deliberately so.** It answers "what do I need right now" against the device's timezone: its current day, stop phases, dayparts, and leave-by time use the traveller's clock. Floating local plans are re-grounded for this live calculation only; stored plan times and lifecycle are unchanged. The device timezone is clock context, not proof of physical location. An authoritative instant is never re-grounded — a flight leaves when it leaves. Offline live calculations follow the same rule.
- **Preview** uses the selected trip day and simulated local time in that day's resolved timezone. It does not adopt the device timezone or alter stored timestamps. Browsing a different day in live Today is not Preview and does not move the traveller's current moment to that day.

### Other Dated Records

All dated MVP records must persist or resolve a deterministic timezone rather than relying on the current device timezone at render time:

- **Tasks:** inherit from attached itinerary item, then trip day, then trip reference timezone. Re-resolve when the user changes the Task's due date/time or attachment context.
- **Expenses:** inherit from linked itinerary item/Place/day where available, otherwise the trip reference timezone. Persist the resolved timezone used to assign the Expense to a local day. Re-resolve only when the user changes its date/time or linked day/item/Place context.
- **Memories:** inherit from capture/associated item/Place/day context, otherwise the trip reference timezone, and persist that timezone with the captured timestamp. Re-resolve only when the user explicitly corrects the Memory's time/day/Place context.
- **Notifications:** use the timezone of the underlying dated source record/event they represent. A leave-by reminder uses the item's planned location/day context; when the device clock differs, live Trip Mode must distinguish its traveller-clock calculation from that scheduled reminder rather than silently rescheduling the event.

### Timezone Stability and Re-resolution

Persisted timezone context must not change merely because the user opens Trove from another device/location.

Re-resolution is scoped to the affected level:

- **Trip reference timezone:** re-resolve when the user changes the destination, ordered countries, or Starting Location supplying that timezone, adds a more authoritative location source, or explicitly corrects the trip timezone. Preserve an existing explicit correction on unrelated edits. An explicit correction is supported context, not a required field in the trip editor.
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

For private application data:

- authenticated owners alone may read or mutate their private trips and user-owned relationships/content;
- this includes Saved relationships, Trip Places, user-owned Custom Places, itinerary data, reservations, uploaded documents, Tasks, Notes, Trip Info, Expenses, Experience Ratings, Memories, and uploaded media;
- private uploaded files/media must enforce the same ownership boundary;
- shared canonical/provider Place identity or public provider data must never expose another user's private Saved/Trip relationships, notes, trip information, Memories, or other private content.

The only approved public exception is the owner-enabled, allowlisted itinerary projection in Section 8.2. It never grants general access to the Trip, underlying private records, or uploaded media. Further sharing/collaboration requires an explicit future decision.

### Deletion Boundaries

Deleting a Trip requires explicit confirmation naming that its itinerary, supporting records, Memories, and private trip media will be removed. Revoke its public projection and remove private files as well as database records; incomplete media cleanup must be retried rather than silently abandoned. Global Saved relationships, their collections, and shared canonical Place identities are not deleted with the Trip.

Removing an itinerary item, day, Saved relationship, or Trip Place is narrower than deleting a Trip and follows Sections 6.1, 14.2, 15.1, and 17.4. Independently owned supporting/history records survive removal of a planning link. Local-copy removal is separate from cloud deletion.

## 33.4 Offline Storage

Users should be able to:

- see offline trip storage/readiness,
- refresh offline data,
- inspect pending/failed sync where relevant,
- delete local/offline copies.

Deleting local offline content must not delete the cloud trip.

Removing a local copy must first synchronize pending work or obtain explicit confirmation to discard it. A deleted cloud trip must not leave a usable public link or be silently recreated by another device's queue. A disconnected device cannot discover remote deletion until reconnecting; clear its obsolete copy once deletion is known while surfacing any pending-work conflict.

Explicit sign-out must remove locally accessible private authenticated data, including selected offline documents and authentication/session material. If unsynchronized local changes exist, Trove must warn that signing out will discard those unsynced local changes before completing sign-out. Cloud data is not deleted.

Offline local data must remain scoped to the authenticated Trove user and must not be exposed when a different user signs in on the same device.

---

# 34. Onboarding

Onboarding is part of the current product and collects only the essentials needed to enter it.

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

These are recorded for future brainstorming and are intentionally not deeply specified. They are **outside the current baseline** unless another section explicitly states a narrower approved capability.

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
- collaboration/invitation-based sharing beyond the read-only links in Section 8.2,
- Shared With Me,
- saved itineraries from others,
- copying trips,
- comments/recommendations,
- possible traveller profiles.

The model may keep future-ready ownership/source/visibility fields without implementing these workflows. Read-only link sharing is already defined in Section 8.2 and does not imply them.

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

# 36. Current Approved Scope

This section is the authoritative high-level scope summary, combining the original MVP with approved extensions. Detailed behavior remains defined by the relevant feature sections above. Inclusion is a requirement, not evidence of implementation or production validation; Linear owns delivery status.

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
- current, forecast, and archived Weather context
- contextual Notifications, including closed-app reminders on supported platforms
- Offline support
- reservation attachments and explicitly selected offline documents
- Profile/Settings
- onboarding
- responsive/accessibility/PWA polish

## 36.3 Approved Extensions to the Original MVP

- AI-assisted trip creation defined in Section 7.6
- read-only itinerary links defined in Section 8.2

## 36.4 Deferred

- AI-dependent product features beyond Section 7.6
- social/collaboration/invitation workflows beyond Section 8.2
- separate Travel Wallet
- business travel administration
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

# 37. Delivery History and Dependency Guidance

This records the original phased delivery approach, not the current backlog or an instruction to rebuild shipped features. Linear is authoritative for current tasks, status, and dependencies. Preserve the intent: shared planning/travel foundations support later scoring, Memories, and AI; feature presence does not establish that every acceptance or launch gate has passed.

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

Depends on stable core planning/route behavior.

## Phase 7 — Memories

Originally sequenced after the core planning/travel and scoring foundations.

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

Originally sequenced after the core planning, travel, Plan Score, and Memories flows were stable. These dependencies remain relevant when changing shared behavior.

Sequence:

1. planning-session persistence, generation-run telemetry, retention, and duration provenance;
2. provider-neutral AI gateway and development Vertex configuration;
3. versioned planner contracts and deterministic defaults;
4. capped Google place grounding and provider accounting;
5. authenticated resumable session APIs and rolling quota;
6. one-call generation, grounding, scheduling, and validation pipeline;
7. atomic/idempotent Apply into standard Trove models;
8. AI-first composer with complete manual fallback;
9. immutable draft itinerary/map review, editable trip metadata, warning acknowledgement, and confirmation;
10. security, privacy, cost, quality, operational, responsive, accessibility, and launch gates.

---

# 38. Testing Strategy

Validate the changed product behavior and its important invariants:

- use focused unit tests for business rules, scoring, authorization, and data integrity rather than incidental implementation details,
- do not add E2E tests unless explicitly requested,
- verify user-facing workflows in the built-in browser, including applicable offline, responsive, accessibility, and failure states,
- still run appropriate:
  - linting,
  - type checking,
  - build validation,
  - focused manual or automated checks for the changed functionality.

For documentation-only changes, validate consistency, references, formatting, and scenario walkthroughs. Do not report product, provider, deployment, or browser gates as passed when only the specification was reviewed. AGENTS.md owns the execution workflow.

---

# 39. Product Success Criteria

The Trove experience is successful when a traveller can:

1. create a trip manually with minimal required information or review and apply an AI draft without losing the manual fallback,
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
12. receive contextual/actionable reminders when enabled, including with the app closed on supported connected platforms,
13. see a trustworthy Plan Score when sufficient evidence exists,
14. complete the journey and later preserve it through private Memories and Experience Rating,
15. share only the intended read-only itinerary and revoke subsequent access,
16. move or shorten a plan without silently changing bookings or losing recorded history.

The product must remain understandable without requiring the user to learn a complex travel-management system.
