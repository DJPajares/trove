import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * The square a Stay is drawn in, everywhere a day is drawn: a bed, so it reads
 * as where the traveller sleeps without a key, and - where the day's stops are
 * numbered - its number in the corner. The number is what tells two Stays in one
 * day apart: the one the day leaves from and the one it ends at.
 *
 * The map draws its pins outside React, so it builds the same mark from
 * `stayMarkElement` with these classes.
 */
export const STAY_MARK_CLASS =
  'relative grid shrink-0 place-items-center rounded-[var(--radius-md)] border-2';
export const STAY_MARK_BADGE_CLASS =
  'absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full border border-background bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums';

export function StayMarkContent({
  iconClassName,
  number,
}: Readonly<{ iconClassName?: string; number?: number | null }>) {
  return (
    <>
      <Icons.DailyBase aria-hidden="true" className={cn('size-4', iconClassName)} />
      {number ? (
        <span aria-hidden="true" className={STAY_MARK_BADGE_CLASS}>
          {number}
        </span>
      ) : null}
    </>
  );
}

/** lucide's bed-double, the icon `Icons.DailyBase` draws, for DOM-built map pins. */
const BED_PATHS = [
  'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8',
  'M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4',
  'M12 4v6',
  'M2 18h20',
];

export function stayMarkElement(className: string, number: number | null) {
  const element = document.createElement('span');
  element.className = cn(STAY_MARK_CLASS, className);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'size-4');
  for (const d of BED_PATHS) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  element.append(svg);
  if (number) {
    const badge = document.createElement('span');
    badge.className = STAY_MARK_BADGE_CLASS;
    badge.textContent = String(number);
    element.append(badge);
  }
  return element;
}
