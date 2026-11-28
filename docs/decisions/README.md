# Architecture decisions

Each Architecture Decision Record (ADR) captures one decision: its context, the choice made, the
alternatives considered, and the consequences. Add the next number for each new architecture
change. It needs the user's approval (CLAUDE.md "Human Control") and a row in the PRD Decision Log (§41).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-stack.md) | Stack: Next.js web, Fastify API, Supabase, Prisma, pnpm + Turborepo, Vercel | Accepted |
| [0002](0002-provider-data-caching.md) | Provider data: resolve on demand, with a bounded 30-day cache and a separate editorial imagery track | Accepted |
