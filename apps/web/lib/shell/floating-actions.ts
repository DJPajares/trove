/**
 * The signed-in quick-actions stack that unfolds from the floating burger button.
 *
 * The order is the hierarchy the traveller reads top to bottom, nearest the
 * trigger first. Search leads because it is the only one that starts something
 * — the other three answer a question about the app rather than about the trip,
 * and they are reached once where search is reached again and again. After it:
 * who they are, what is waiting for them, then how the app looks.
 */
export const floatingActionOrder = ['search', 'account', 'notifications', 'appearance'] as const;

export type FloatingAction = (typeof floatingActionOrder)[number];

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
 * How long the button at `index` waits before it appears. Reversed on the way
 * out, so the stack folds back towards the trigger it came from.
 */
export function floatingActionDelay(index: number, reverse = false) {
  const step = reverse ? floatingActionOrder.length - 1 - index : index;

  return Math.max(0, step) * FLOATING_ACTION_STAGGER_S;
}

/**
 * The round, elevated chip the three controls wear inside the stack. Spelled
 * once here and imported by each of them, the way `lib/navigation.ts` already
 * holds the bottom bar's column classes.
 */
export const floatingActionTriggerClass =
  'rounded-full border-border-subtle bg-background/95 shadow-[var(--nav-action-shadow)] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring supports-[backdrop-filter]:bg-background/90';
