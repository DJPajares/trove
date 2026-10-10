-- Existing assignments remain active. Entitlements stay private to the API.
ALTER TABLE "trove"."user_entitlements"
  ADD COLUMN "subscription_status" VARCHAR(20) NOT NULL DEFAULT 'active',
  ADD CONSTRAINT "user_entitlements_subscription_status"
    CHECK ("subscription_status" IN ('active', 'inactive'));
