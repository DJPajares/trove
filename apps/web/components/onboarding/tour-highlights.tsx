'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

const HIGHLIGHTS = [
  { icon: Icons.Ai, key: 'ai' },
  { icon: Icons.Saved, key: 'finds' },
  { icon: Icons.Offline, key: 'offline' },
  { icon: Icons.Expenses, key: 'money' },
] as const;

type HighlightKey = (typeof HIGHLIGHTS)[number]['key'];

const ROWS = ['one', 'two', 'three'] as const;
const ROW =
  'flex items-baseline justify-between gap-3 border-t border-border-subtle py-2 text-sm first:border-t-0';
const DETAIL = 'text-xs text-muted-foreground tabular-nums';
const EXAMPLE = 'text-[0.625rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase';

/**
 * Four things worth knowing before a first trip, one at a time: pick a card and
 * its panel shows the feature at work. The panels are illustrations with
 * example data from the copy catalogue; nothing is drafted, saved or converted.
 */
export function TourHighlights() {
  const t = useTranslations('onboarding.tour.highlights');
  const [selected, setSelected] = useState<HighlightKey>('ai');
  const [drafted, setDrafted] = useState(false);
  const [offline, setOffline] = useState(false);
  const switchId = useId();
  const panelId = useId();

  return (
    <div className="grid gap-3">
      <div aria-label={t('label')} className="grid grid-cols-2 gap-2" role="tablist">
        {HIGHLIGHTS.map(({ icon: Icon, key }) => {
          const active = selected === key;
          return (
            <button
              aria-controls={panelId}
              aria-selected={active}
              className={cn(
                'grid min-h-[4.75rem] content-start gap-1.5 rounded-[var(--radius-xl)] border p-3 text-left outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
                active
                  ? 'border-primary bg-surface-tint'
                  : 'border-border-subtle bg-card hover:bg-surface-hover',
              )}
              key={key}
              onClick={() => setSelected(key)}
              role="tab"
              type="button"
            >
              <span
                className={cn(
                  'grid size-[1.875rem] place-items-center rounded-[var(--radius-md)]',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-brand',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="text-sm leading-tight font-semibold">{t(`${key}.title`)}</span>
            </button>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className="grid gap-3 rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-4"
        id={panelId}
        role="tabpanel"
      >
        <p className="text-sm leading-6 text-pretty text-muted-foreground">
          {t(`${selected}.description`)}
        </p>

        {selected === 'ai' ? (
          <>
            <p className="rounded-[var(--radius-md)] bg-muted px-3 py-2.5 font-journal text-[1.0625rem] leading-snug font-normal">
              {t('ai.prompt')}
            </p>
            {drafted ? (
              <ul className="motion-safe:animate-in motion-safe:duration-300 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
                {ROWS.map((row) => (
                  <li className={ROW} key={row}>
                    <span className="min-w-0">
                      <span className="font-semibold">{t(`ai.days.${row}.label`)}</span>
                      {' · '}
                      {t(`ai.days.${row}.name`)}
                    </span>
                    <span className={DETAIL}>{t(`ai.days.${row}.count`)}</span>
                  </li>
                ))}
                <li className={cn(ROW, 'text-muted-foreground')}>{t('ai.more')}</li>
              </ul>
            ) : (
              <Button className="justify-self-start" onClick={() => setDrafted(true)} size="sm">
                <Icons.Ai aria-hidden="true" data-icon="inline-start" />
                {t('ai.action')}
              </Button>
            )}
          </>
        ) : null}

        {selected === 'finds' ? (
          <ul>
            {ROWS.map((row) => (
              <li className={ROW} key={row}>
                <span className="font-semibold">{t(`finds.towns.${row}.name`)}</span>
                <span className={DETAIL}>{t(`finds.towns.${row}.count`)}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {selected === 'offline' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-semibold" htmlFor={switchId}>
                {t('offline.switch')}
              </label>
              <Switch checked={offline} id={switchId} onCheckedChange={setOffline} />
            </div>
            <p
              className={cn(
                'flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-[0.8125rem]',
                offline ? 'bg-surface-tint font-semibold' : 'bg-muted text-muted-foreground',
              )}
            >
              {offline ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-brand" />
              ) : (
                <Icons.Offline aria-hidden="true" className="size-4 shrink-0" />
              )}
              {offline ? t('offline.on') : t('offline.off')}
            </p>
          </>
        ) : null}

        {selected === 'money' ? (
          <>
            <ul>
              {ROWS.map((row) => (
                <li className={ROW} key={row}>
                  <span>{t(`money.rows.${row}.name`)}</span>
                  <span className={DETAIL}>{t(`money.rows.${row}.amount`)}</span>
                </li>
              ))}
              <li className={cn(ROW, 'font-semibold')}>
                <span>{t('money.total')}</span>
                <span className="tabular-nums">{t('money.totalValue')}</span>
              </li>
            </ul>
            <p className={EXAMPLE}>{t('example')}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
