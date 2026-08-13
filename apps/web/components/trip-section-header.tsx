'use client';

import {
  ArrowLeft,
  CalendarCheck2,
  ChevronDown,
  CircleDollarSign,
  Info,
  ListChecks,
  MapPinned,
  ReceiptText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type TripSection = 'itinerary' | 'places' | 'tasks' | 'reservations' | 'expenses' | 'info';

type TripSectionHeaderProps = {
  actions?: ReactNode;
  currentSection: TripSection;
  description: string;
  title: string;
  tripId: string;
};

type SectionDefinition = {
  icon: LucideIcon;
  labelKey: 'itinerary' | 'places' | 'tasks' | 'reservations' | 'expenses' | 'tripInfo';
  path: TripSection;
  route: string;
};

const sections: SectionDefinition[] = [
  { icon: CalendarCheck2, labelKey: 'itinerary', path: 'itinerary', route: 'itinerary' },
  { icon: MapPinned, labelKey: 'places', path: 'places', route: 'places' },
  { icon: ListChecks, labelKey: 'tasks', path: 'tasks', route: 'tasks' },
  { icon: ReceiptText, labelKey: 'reservations', path: 'reservations', route: 'reservations' },
  { icon: CircleDollarSign, labelKey: 'expenses', path: 'expenses', route: 'expenses' },
  { icon: Info, labelKey: 'tripInfo', path: 'info', route: 'info' },
];

export function TripSectionHeader({
  actions,
  currentSection,
  description,
  title,
  tripId,
}: Readonly<TripSectionHeaderProps>) {
  const t = useTranslations('trips');
  const activeSection = sections.find((section) => section.path === currentSection) ?? sections[0]!;
  const ActiveIcon = activeSection.icon;

  return (
    <header className="space-y-5" data-slot="trip-section-header">
      <Link
        className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm font-medium text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        href="/trips"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('title')}
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-[clamp(1.875rem,5vw,2.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-pretty text-foreground">
            {title}
          </h1>
          <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <nav aria-label={t('tripNavigation')} className="hidden border-b border-border md:block">
        <ul className="flex items-center gap-1 overflow-x-auto pb-2">
          {sections.map(({ icon: Icon, labelKey, path, route }) => {
            const active = path === currentSection;
            return (
              <li key={path}>
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40',
                    active
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  )}
                  href={`/trips/${tripId}/${route}`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {t(labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button className="w-full justify-between" type="button" variant="outline" />}
          >
            <span className="inline-flex items-center gap-2">
              <ActiveIcon aria-hidden="true" className="size-4" />
              {t(activeSection.labelKey)}
            </span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--anchor-width)">
            <DropdownMenuLabel>{t('tripNavigation')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sections.map(({ icon: Icon, labelKey, path, route }) => (
              <DropdownMenuLinkItem
                aria-current={path === currentSection ? 'page' : undefined}
                key={path}
                render={<Link href={`/trips/${tripId}/${route}`} />}
              >
                <Icon aria-hidden="true" className="size-4" />
                {t(labelKey)}
              </DropdownMenuLinkItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
