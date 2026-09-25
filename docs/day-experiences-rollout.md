# WDL-292 rollout

This is a coordinated schema/API deployment, not a rolling mixed-version rollout.
The migration copies day ratings and reflection notes to date-owned records and
removes their old columns. It cannot reconstruct dates changed before migration.

1. Back up the database and stop/drain all API writers, including old deployments.
2. Apply the committed Prisma migration using the established deployment process.
3. Deploy the matching API and web builds before restoring traffic. Do not restart
   an older API against this schema. The old day-ID rating URL is supported by the
   new API, but stale shrink confirmations must be reviewed again.
4. Verify an existing day rating and note, a rating-only story, note reassignment,
   and rejection of a stale shrink confirmation before restoring normal traffic.

If migration fails, leave writers stopped and investigate; Prisma migration status
must be reconciled before retrying. After migration, roll back application changes
only with a compatible API. Restoring the pre-migration database requires a planned
restore and reconciliation of any new writes; do not copy historical reflections
back onto moved planning days.

Production migration and deployment require human approval. This task does not
authorize applying this migration to production.
