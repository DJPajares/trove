'use client';

import { useTranslations } from 'next-intl';
import { useRef, type ComponentProps } from 'react';

import { PlanScorePanel } from '@/components/plan-score-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * A day's score, opened from the chip on its header: the breakdown the chip
 * stands for, already showing because opening it was the request (PRD 29.4).
 * The panel is the same one every other surface uses, so nothing about the
 * score reads differently here.
 */
export function PlanScoreSheet({
  onOpenChange,
  open,
  panel,
  title,
}: Readonly<{
  onOpenChange: (open: boolean) => void;
  open: boolean;
  panel: Omit<
    ComponentProps<typeof PlanScorePanel>,
    'className' | 'defaultDetailsOpen' | 'headingLevel' | 'surface'
  >;
  title: string;
}>) {
  const t = useTranslations('itinerary');
  const placesPending = useRef(false);

  return (
    <Sheet
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next && placesPending.current) {
          placesPending.current = false;
          panel.onOpenTripPlaces?.();
        }
      }}
      open={open}
    >
      <SheetContent
        className="w-full md:data-[side=right]:w-[min(32rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+1.5rem)] sm:px-6">
          {open ? (
            <PlanScorePanel
              {...panel}
              onOpenTripPlaces={
                panel.onOpenTripPlaces
                  ? () => {
                      placesPending.current = true;
                      onOpenChange(false);
                    }
                  : undefined
              }
              className="border-t-0 pt-4"
              defaultDetailsOpen
              headingLevel={2}
              surface="inset"
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
