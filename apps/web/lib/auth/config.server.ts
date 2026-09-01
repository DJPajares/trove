import { isSignUpDisabled } from './feature-flag';

export function isSignUpEnabled() {
  return !isSignUpDisabled(process.env);
}
