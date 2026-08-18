-- Every snapshot taken before the language chokepoint stored NULL when the
-- caller named no language, while callers that named `en` stored `en`. The two
-- could never read each other's snapshot, so the app re-billed Google for
-- places it already had. Normalising the existing rows to the default means
-- those snapshots stay usable instead of all missing at once on deploy.
UPDATE "place_provider_refs"
   SET "cached_language_code" = 'en'
 WHERE "cached_language_code" IS NULL
   AND "cached_at" IS NOT NULL;
