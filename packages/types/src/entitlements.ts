/** API-owned values. Clients display these; they never decide allowances. */
export type PlanKey = 'free' | 'paid';
export type CreditRenewalPolicy = 'lifetime' | 'monthly';

export type AiPlannerEntitlementSnapshot = {
  tier: PlanKey;
  allowance: number;
  usedCredits: number;
  reservedCredits: number;
  availableCredits: number;
  renewalPolicy: CreditRenewalPolicy;
  periodStart: string;
  periodEnd: string | null;
  nextRenewalAt: string | null;
  maxItineraryDays: number;
};
