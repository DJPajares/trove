import { primaryNavigationDestinations } from '@/lib/navigation';

/**
 * The signed-in quick-actions stack that unfolds from the floating account button.
 *
 * The order is the hierarchy the traveller reads top to bottom, nearest the
 * trigger first. Search leads because it is the only one that starts something;
 * notifications and appearance follow, with the account/profile control at
 * the bottom. On the main destinations search leaves the stack and stands
 * beside the trigger as a button of its own (`searchStandsAlone`).
 */
export const floatingActionOrder = ['search', 'notifications', 'appearance', 'account'] as const;

export type FloatingAction = (typeof floatingActionOrder)[number];

/**
 * Search earns a button of its own on the main destinations - Home, Trips,
 * Saved and Tools - where it is reached for most. Everywhere else the screen's
 * own controls need the corner, so search folds back into the stack, first.
 */
export function searchStandsAlone(pathname: string) {
  return primaryNavigationDestinations.some(({ href }) => pathname === href);
}

/**
 * What the trigger shows for a traveller whose name Trove knows: the first
 * letter of the first and last words of it, never a photograph. Without a name
 * - signed out, or a profile that could not be read - there are no initials,
 * and the trigger keeps its burger.
 */
export function profileInitials(name: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return null;

  const letters = [first, words.length > 1 ? words[words.length - 1] : undefined]
    .map((word) => (word ? Array.from(word)[0] : undefined))
    .filter((letter): letter is string => Boolean(letter));

  return letters.join('').toLocaleUpperCase();
}

/**
 * Seconds between one button appearing and the next.
 *
 * Small on purpose: three buttons at this spacing finish well inside the
 * standard duration, so the stack reads as one gesture rather than a queue.
 * It lives here rather than in `lib/motion.ts` because that module's scale is
 * the shared vocabulary, and a stagger for a single component is not.
 */
export const FLOATING_ACTION_STAGGER_S = 0.04;

/**
 * How long the button at `index` of a stack of `count` waits before it
 * appears. Reversed on the way out, so the stack folds back towards the
 * trigger it came from.
 */
export function floatingActionDelay(
  index: number,
  reverse = false,
  count: number = floatingActionOrder.length,
) {
  const step = reverse ? count - 1 - index : index;

  return Math.max(0, step) * FLOATING_ACTION_STAGGER_S;
}

/**
 * The round, elevated chip the three controls wear inside the stack. Spelled
 * once here and imported by each of them, the way `lib/navigation.ts` already
 * holds the bottom bar's column classes.
 */
export const floatingActionTriggerClass =
  'rounded-full border-border-subtle bg-background/95 shadow-[var(--nav-action-shadow)] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring supports-[backdrop-filter]:bg-background/90';
