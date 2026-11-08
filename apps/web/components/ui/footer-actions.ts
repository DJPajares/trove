/**
 * The one button layout every drawer and dialog footer shares, so the main
 * action is always in the same place.
 *
 * Write the buttons in this order: an optional lead item (Delete, or a short
 * note) marked `data-footer-lead`, then the secondary action (Cancel, Done),
 * then the primary action last.
 *
 * - On a phone the actions share one row in equal widths, Cancel on the left
 *   and the main action on the right, where a thumb rests. A lead item takes a
 *   line of its own above them, so Delete is never beside Save.
 * - From `sm` up they sit right-aligned in the same order, and the lead item is
 *   pushed to the far left.
 */
export const footerActionsClassName =
  'flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end ' +
  '*:not-data-footer-lead:flex-1 sm:*:not-data-footer-lead:flex-none ' +
  '*:data-footer-lead:basis-full *:data-footer-lead:justify-start sm:*:data-footer-lead:basis-auto sm:*:data-footer-lead:mr-auto';

/** A footer's Delete: quiet red text, never a second filled button beside the main one. */
export const footerDeleteClassName =
  'text-destructive hover:bg-destructive/10 hover:text-destructive';
