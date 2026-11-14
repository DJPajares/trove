'use client';

import { Plus } from 'lucide-react';
import { motion, type Transition } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';

import { NavActiveIndicator } from '@/components/nav-active-indicator';
import { usePrimaryAction } from '@/components/primary-action-provider';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { motionEase } from '@/lib/motion';
import {
  isImmersiveTripPath,
  isNavigationPathActive,
  primaryNavigationDestinations,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

/** A small settle as a tab becomes current: a dip, a slight overshoot, rest. */
const iconSelectTransition: Transition = {
  duration: 0.32,
  ease: motionEase,
  times: [0, 0.55, 1],
};

type NavigationItem = {
  /**
   * Which cell this destination takes in the mobile bar's five-column grid.
   * Static strings rather than an index, because Tailwind cannot generate a
   * class from a value it only sees at runtime. Column three is left empty for
   * the create action. Ignored by the desktop variant.
   */
  column: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};

type PrimaryNavigationProps = {
  variant: 'desktop' | 'mobile';
};

/**
 * The desktop rail, with one underline that slides to the current page.
 *
 * The underline is placed from the links' own offsets inside the rail rather
 * than shared between them with `layoutId`: a layout animation measures against
 * the page, so navigating while scrolled (the new page opens at the top, and the
 * header slides back down) made the line travel up or down instead of along.
 * Offsets within the rail do not know about either, so it only ever moves
 * sideways.
 */
function DesktopNavigation({
  items,
  label,
  pathname,
}: Readonly<{ items: NavigationItem[]; label: string; pathname: string }>) {
  const rail = useRef<HTMLElement | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  // The first mark is placed, not animated into place from nowhere.
  const [placed, setPlaced] = useState(false);
  const activeHref = items.find(({ href }) => isNavigationPathActive(pathname, href))?.href ?? null;

  useLayoutEffect(() => {
    const measure = () => {
      const link = activeHref ? links.current.get(activeHref) : null;
      setMark(link ? { left: link.offsetLeft, width: link.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    for (const link of links.current.values()) observer.observe(link);
    return () => observer.disconnect();
  }, [activeHref]);

  useEffect(() => {
    if (mark) setPlaced(true);
  }, [mark]);

  return (
    <nav aria-label={label} className="relative hidden items-center gap-1 md:flex" ref={rail}>
      {items.map(({ href, label: text }) => {
        const active = href === activeHref;

        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative isolate rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            href={href}
            key={href}
            ref={(element) => {
              if (element) links.current.set(href, element);
              else links.current.delete(href);
            }}
            scroll={href === '/trips' ? false : undefined}
          >
            <span className="relative">{text}</span>
          </Link>
        );
      })}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-[-1px] left-0 h-0.5 rounded-full bg-brand',
          placed &&
            'transition-[transform,width,opacity] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none',
        )}
        style={{
          opacity: mark ? 1 : 0,
          transform: `translateX(${mark ? mark.left + 12 : 0}px)`,
          width: mark ? Math.max(0, mark.width - 24) : 0,
        }}
      />
    </nav>
  );
}

export function PrimaryNavigation({ variant }: Readonly<PrimaryNavigationProps>) {
  const pathname = usePathname();
  const t = useTranslations('navigation');
  const { openCreateTrip } = useTripCreation();
  const primaryAction = usePrimaryAction();
  const icons = { home: Icons.Home, saved: Icons.Saved, tools: Icons.Tools, trips: Icons.Trips };
  const items: NavigationItem[] = primaryNavigationDestinations.map(({ column, href, key }) => ({
    column,
    href,
    icon: icons[key],
    label: t(key),
  }));

  // Trip Mode and the Memories journal own the bottom of the screen while a
  // traveller is in them. The desktop rail stays: there is no thumb zone to
  // compete for up there.
  if (variant === 'mobile' && isImmersiveTripPath(pathname)) return null;

  if (variant === 'desktop') {
    return <DesktopNavigation items={items} label={t('primary')} pathname={pathname} />;
  }

  return (
    // The bar itself only sizes and positions. Its surface is a separate masked
    // layer, because the mask that carves the notch would otherwise carve the
    // create action out of existence along with it. Padding lives on the content
    // wrapper for the same reason: `inset-0` resolves against the padding box
    // while the mask resolves against the border box, and the two must agree.
    <div className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] h-[calc(var(--bottom-bar-height)+var(--safe-bottom))] md:hidden">
      {/* The hairline is its own layer, cut to the same silhouette grown by 1px,
          because a `border-top` can only draw the flat part and would die at the
          shoulders where the curve begins. */}
      <span
        aria-hidden="true"
        className="nav-notch-edge absolute -top-px right-0 bottom-0 left-0 z-0 bg-border-subtle"
      />
      <span
        aria-hidden="true"
        className="nav-notch-surface absolute inset-0 z-0 bg-background/96 backdrop-blur supports-[backdrop-filter]:bg-background/90"
        data-translucent-surface
      />
      <div className="relative z-10 mx-auto h-full max-w-xl px-[max(0.5rem,var(--safe-left),var(--safe-right))] pt-2 pb-[var(--safe-bottom)]">
        <nav aria-label={t('mobile')} className="h-full">
          <ul className="grid grid-cols-5 gap-1">
            {items.map(({ column, href, icon: Icon, label }) => {
              const active = isNavigationPathActive(pathname, href);

              return (
                <li className={column} key={href}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative isolate flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active
                        ? 'font-semibold text-brand [--icon-stroke:var(--icon-stroke-emphasis)]'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={href}
                    scroll={href === '/trips' ? false : undefined}
                  >
                    {active ? <NavActiveIndicator /> : null}
                    <motion.span
                      animate={{ scale: active ? [0.86, 1.06, 1] : 1 }}
                      className="grid place-items-center"
                      initial={false}
                      transition={iconSelectTransition}
                    >
                      <Icon aria-hidden="true" className="size-5" />
                    </motion.span>
                    <span className="max-w-full truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Creation is an action, not a destination: the shared sheet opens over
          whichever screen the traveller is already using. It sits outside the
          masked surface and rides above the notch rather than inside it, so the
          curve reads as the bar giving way to the button.

          What it creates is the screen's to name. On a day of the itinerary the
          nearest thing to make is a stop on that day, and in the saved library
          it is another place; a screen that claims the button says so through
          the primary action registry, and everywhere else it starts a trip. The
          icon and its place never move, so the button stays the same button. */}
      <Button
        aria-label={primaryAction?.label ?? t('createTrip')}
        className="absolute top-[calc(-1*var(--nav-action-overhang))] left-1/2 z-20 size-[var(--nav-action-size)] -translate-x-1/2 rounded-full bg-primary text-primary-foreground shadow-[var(--nav-action-shadow)] transition-[background-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-brand-strong hover:shadow-[var(--nav-action-shadow-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:translate-y-px"
        onClick={primaryAction?.onTrigger ?? openCreateTrip}
        type="button"
      >
        <Plus aria-hidden="true" className="size-7" />
      </Button>
    </div>
  );
}
