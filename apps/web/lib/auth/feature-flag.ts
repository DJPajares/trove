export function isSignUpDisabled(environment: Readonly<Record<string, string | undefined>>) {
  const value = environment.TROVE_SIGN_UP_DISABLED?.trim().toLowerCase();

  return value === '1' || value === 'true';
}
