# Local stay grounding verification

This simulation models the Google Places v1 Text Search response shape consumed
by Trove's existing provider. Names and identities are synthetic; it checks no
availability or prices. It was built from the provider contract already used in
this repository, rather than an organization-owned cloud mock.

Start it without publishing or recording cloud history:

```sh
postman simulation run postman/simulations/multi-stay.sim.yaml --port 4900 --no-history --output ndjson
```

In another terminal:

```sh
pnpm --filter @trove/api exec tsx scripts/verify-ai-stays.ts
```

The verifier uses the real HTTP provider and grounder, with an in-memory identity
sink and no model or database calls. It checks three accommodations, an undated
stay, transfers, checkout, a 503 response, and the zero-call exhausted budget.
Read the simulation's request events to confirm the Google member was reached.
Other endpoints return 501. Stop the simulation with Ctrl-C.
