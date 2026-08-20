import { isPlanScoreDisabled } from './feature-flag';

export function isPlanScoreEnabled() {
  return !isPlanScoreDisabled(process.env);
}
