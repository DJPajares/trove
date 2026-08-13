'use client';

import { Bell, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { useNotifications } from '@/components/notifications-provider';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';

export function NotificationCenter() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { markAllRead, markRead, notifications, refresh, status } = useNotifications();
  if (status === 'unavailable') return null;

  const count = notifications.length;
  return (
    <Popover onOpenChange={(open) => open && void refresh()}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t('centerButton', { count })}
            className="relative"
            disabled={status === 'loading'}
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <Bell aria-hidden="true" className="size-4" />
        {count ? (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0"
        sideOffset={8}
      >
        <PopoverHeader className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <PopoverTitle className="font-semibold">{t('centerTitle')}</PopoverTitle>
              <PopoverDescription className="mt-1 leading-5">
                {t('centerDescription')}
              </PopoverDescription>
            </div>
            {count ? (
              <Button
                onClick={() => void markAllRead().catch(() => undefined)}
                size="xs"
                variant="ghost"
              >
                <CheckCheck aria-hidden="true" data-icon="inline-start" />
                {t('markAllRead')}
              </Button>
            ) : null}
          </div>
        </PopoverHeader>

        {count ? (
          <div className="max-h-80 overflow-y-auto" role="list">
            {notifications.slice(0, 5).map((notification) => (
              <Link
                className="block border-b border-border px-4 py-3 outline-none last:border-b-0 hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                href={notification.actionPath}
                key={notification.id}
                onClick={() => void markRead(notification.id).catch(() => undefined)}
                role="listitem"
              >
                <span className="block text-sm font-medium text-foreground">
                  {t(`kinds.${notification.kind}.centerTitle`, {
                    label: notification.label,
                  })}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {t('centerMeta', {
                    time: new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: notification.timeZone,
                    }).format(new Date(notification.eventAt)),
                    trip: notification.trip.name,
                  })}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-4 py-7 text-center">
            <p className="text-sm font-medium text-foreground">{t('emptyTitle')}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {status === 'error' ? t('loadError') : t('emptyDescription')}
            </p>
          </div>
        )}

        <div className="border-t border-border p-2">
          <Button
            className="w-full justify-start"
            nativeButton={false}
            render={<Link href="/profile#notifications" />}
            size="sm"
            variant="ghost"
          >
            <Settings aria-hidden="true" data-icon="inline-start" />
            {t('manage')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
