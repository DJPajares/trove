export function isPlanScoreDisabled(environment: Readonly<Record<string, string | undefined>>) {
  const value = environment.PLAN_SCORE_DISABLED?.trim().toLowerCase();

  return value === '1' || value === 'true';
}
