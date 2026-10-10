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
  aiPlanner: { credits: number; maxItineraryDays: number; renewal: CreditRenewalPolicy };
};

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

/** A registry by feature, independent of subscription and AI providers. */
export function getPlanEntitlements(
  plan: PlanKey,
  env: Record<string, string | undefined> = process.env,
): PlanEntitlements {
  const prefix = `TROVE_${plan.toUpperCase()}_AI_PLANNER`;
  const renewal = env[`${prefix}_RENEWAL`]?.trim() || (plan === 'free' ? 'lifetime' : 'monthly');
  if (renewal !== 'lifetime' && renewal !== 'monthly')
    throw new EntitlementError('configuration_invalid', 503);
  return {
    aiPlanner: {
      credits: integer(env, `${prefix}_CREDITS`, plan === 'free' ? 10 : 50, 0, 1_000_000),
      maxItineraryDays: integer(env, `${prefix}_MAX_DAYS`, plan === 'free' ? 10 : 20, 7, 365),
      renewal,
    },
  };
}

export function getAiPlannerBurstLimit(env: Record<string, string | undefined> = process.env) {
  return integer(env, 'TROVE_AI_PLANNER_STARTS_PER_MINUTE', 5, 1, 1_000);
}

/** Storage has structural contracts; entitlement limits are enforced with a run snapshot. */
export function plannerContractMaxDays(env: Record<string, string | undefined> = process.env) {
  return Math.max(
    getPlanEntitlements('free', env).aiPlanner.maxItineraryDays,
    getPlanEntitlements('paid', env).aiPlanner.maxItineraryDays,
  );
}

export function asPlanKey(value: string): PlanKey {
  if (value !== 'free' && value !== 'paid')
    throw new EntitlementError('configuration_invalid', 503);
  return value;
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
