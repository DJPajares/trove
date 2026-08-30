/**
 * The one create action the bottom bar's plus button performs on the screen the
 * traveller is looking at. `label` is its accessible name, taken from the
 * wording that screen already uses for the same action rather than invented a
 * second time.
 */
export type PrimaryAction = {
  label: string;
  onTrigger: () => void;
};

/** The registered action together with the screen that claimed it. */
export type PrimaryActionSlot = { action: PrimaryAction; owner: symbol } | null;

/**
 * The slot after `owner` registers `action`, or releases it by passing `null`.
 *
 * Registering is last one wins: whoever spoke most recently is the screen in
 * front of the traveller. Releasing is not, and that asymmetry is the whole
 * point — a route change mounts the arriving screen while the leaving one is
 * still on its way out, so a release that always cleared would wipe the action
 * the new screen had just registered and quietly hand the button back to its
 * global default.
 */
export function resolvePrimaryActionSlot(
  current: PrimaryActionSlot,
  owner: symbol,
  action: PrimaryAction | null,
): PrimaryActionSlot {
  if (action) return { action, owner };

  return current?.owner === owner ? null : current;
}
