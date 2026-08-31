# AI planning browser validation

The responsive and accessibility gate for AI-assisted trip creation. Run it
against a signed-in account at both a mobile width (375x812) and a desktop
width, and record the result here before launch.

## Checklist

| #   | Check                                                                                                               | Cost         |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Composer opens from **New trip**, defaults to **Plan with AI**, and shows the remaining daily quota                 | free         |
| 2   | **Create manually** switches to the manual form and creating a trip there still works                               | free         |
| 3   | Every control in both tabs is reachable and operable by keyboard, with tab/tabpanel roles and labelled date buttons | free         |
| 4   | No string is hardcoded - every label resolves through `next-intl`                                                   | free         |
| 5   | Reduced motion is respected                                                                                         | free         |
| 6   | Neither width scrolls horizontally                                                                                  | free         |
| 7   | Generate produces a draft, and refreshing mid-generation recovers the session                                       | **billable** |
| 8   | Review shows the map, Google attribution, and unresolved Custom Places                                              | **billable** |
| 9   | Editing the draft, acknowledging a material warning, and Apply produce a Trip                                       | **billable** |
| 10  | Retrying Apply returns the same Trip and creates no duplicate                                                       | **billable** |
| 11  | Quota exhaustion, provider outage, and both kill switches degrade to the manual path                                | **billable** |

Checks 7-11 dispatch a real Vertex generation and real Google grounding calls, so
each run costs money. They are the same steps as the Manual Test on WDL-224 and
belong to whoever runs the launch.

## Result - 2026-08-31, local `:3000`

Checks 1-6 verified. Checks 7-11 not run: they spend real provider money and
were deliberately left for the launch operator.

| #   | Result                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pass. Composer opens as a bottom sheet at 375x812 and a side sheet on desktop, defaults to **Plan with AI**, and reports `5 AI plans available in the next 24 hours` from `/ai/planning-sessions/availability`.                                                                                          |
| 2   | Pass. **Create manually** renders the trip name, start/end date, and destination fields unchanged.                                                                                                                                                                                                       |
| 3   | Pass. Focusable order is tab, tab, tabpanel, name input, both date buttons, destination input, Cancel, Create trip, Close. Dates expose `Change Start date, currently ...`; every icon is `aria-hidden`; generation status uses `role="status"` with `aria-live="polite"` and errors use `role="alert"`. |
| 4   | Pass. No literal user-facing string in `ai-planning-composer.tsx` or `ai-planning-review.tsx`; all resolve through `next-intl`.                                                                                                                                                                          |
| 5   | Pass, by construction. Neither component introduces its own motion, and `apps/web/app/globals.css` collapses every transition and animation to 1ms under `prefers-reduced-motion: reduce`.                                                                                                               |
| 6   | Pass at both widths.                                                                                                                                                                                                                                                                                     |

Also observed: every API call from the browser succeeded, including the
`OPTIONS` preflights on `/ai/planning-sessions/recovery`, `/trips`, and
`/notifications`.
