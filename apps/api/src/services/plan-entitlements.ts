import type { CreditRenewalPolicy, PlanKey } from '@trove/types';

export class EntitlementError extends Error {
  constructor(
    public readonly code:
      'configuration_invalid' | 'quota_exceeded' | 'itinerary_day_limit_exceeded' | 'rate_limited',
    public readonly statusCode: 400 | 429 | 503,
    public readonly retryAt: Date | null = null,
    public readonly maxItineraryDays: number | null = null,
  ) {
    super(code);
  }
}

export type PlanEntitlements = {
  readonly aiPlanner: {
    readonly credits: number;
    readonly maxItineraryDays: number;
    readonly renewal: CreditRenewalPolicy;
  };
};

/** Product definitions, grouped by feature and independent of payment providers. */
export const SUBSCRIPTION_PLANS = {
  free: { aiPlanner: { credits: 10, maxItineraryDays: 10, renewal: 'lifetime' } },
  paid: { aiPlanner: { credits: 50, maxItineraryDays: 20, renewal: 'monthly' } },
} as const satisfies Readonly<Record<PlanKey, PlanEntitlements>>;

export const subscriptionPlanKeys = Object.keys(SUBSCRIPTION_PLANS) as readonly PlanKey[];

function integer(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new EntitlementError('configuration_invalid', 503);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new EntitlementError('configuration_invalid', 503);
  return value;
}

export function getPlanEntitlements(plan: PlanKey): PlanEntitlements {
  return SUBSCRIPTION_PLANS[asPlanKey(plan)];
}

export function getAiPlannerBurstLimit(env: Record<string, string | undefined> = process.env) {
  return integer(env, 'TROVE_AI_PLANNER_STARTS_PER_MINUTE', 5, 1, 1_000);
}

/** Storage has structural contracts; entitlement limits are enforced with a run snapshot. */
export function plannerContractMaxDays() {
  return Math.max(
    ...Object.values(SUBSCRIPTION_PLANS).map((plan) => plan.aiPlanner.maxItineraryDays),
  );
}

export function asPlanKey(value: string): PlanKey {
  if (!Object.hasOwn(SUBSCRIPTION_PLANS, value))
    throw new EntitlementError('configuration_invalid', 503);
  return value as PlanKey;
}

export function creditPeriod(anchor: Date, now: Date, renewal: CreditRenewalPolicy) {
  if (renewal === 'lifetime') return { startAt: anchor, endAt: null };
  const anniversary = (offset: number) => {
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() + offset;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        year,
        month,
        Math.min(anchor.getUTCDate(), lastDay),
        anchor.getUTCHours(),
        anchor.getUTCMinutes(),
        anchor.getUTCSeconds(),
        anchor.getUTCMilliseconds(),
      ),
    );
  };
  let offset = Math.max(
    0,
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      anchor.getUTCMonth(),
  );
  if (anniversary(offset) > now && offset > 0) offset -= 1;
  return { startAt: anniversary(offset), endAt: anniversary(offset + 1) };
}
