'use client';

import { Bell, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { useNotifications } from '@/components/notifications-provider';
import { PageState } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { floatingActionTriggerClass } from '@/lib/shell/floating-actions';
import { cn } from '@/lib/utils';

type NotificationCenterProps = {
  onNavigate?: () => void;
  triggerVariant?: 'floating' | 'icon';
};

export function NotificationCenter({
  onNavigate,
  triggerVariant = 'icon',
}: Readonly<NotificationCenterProps> = {}) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const { markAllRead, markRead, notifications, refresh, status } = useNotifications();
  const floating = triggerVariant === 'floating';
  if (status === 'unavailable') return null;

  const count = notifications.length;
  return (
    <Popover onOpenChange={(open) => open && void refresh()}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t('centerButton', { count })}
            className={cn('relative text-foreground', floating && floatingActionTriggerClass)}
            data-translucent-surface={floating ? '' : undefined}
            disabled={status === 'loading'}
            size={floating ? 'icon' : 'icon-sm'}
            type="button"
            variant="ghost"
          />
        }
      >
        <Bell aria-hidden="true" className={floating ? 'size-5' : 'size-4'} />
        {count ? (
          <Badge
            className={floating ? 'absolute top-1 right-1' : 'absolute top-0.5 right-0.5'}
            size="count"
            variant="solid"
          >
            {count > 9 ? '9+' : count}
          </Badge>
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
          <div className="max-h-80 overflow-y-auto">
            <ItemGroup variant="list">
              {notifications.slice(0, 5).map((notification) => (
                <Item
                  key={notification.id}
                  render={
                    <Link
                      href={notification.actionPath}
                      onClick={() => {
                        onNavigate?.();
                        void markRead(notification.id).catch(() => undefined);
                      }}
                      role="listitem"
                    />
                  }
                  size="sm"
                >
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      {t(`kinds.${notification.kind}.centerTitle`, {
                        label: notification.label,
                      })}
                    </ItemTitle>
                    <ItemDescription>
                      {t('centerMeta', {
                        time: new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: notification.timeZone,
                        }).format(new Date(notification.eventAt)),
                        trip: notification.trip.name,
                      })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </div>
        ) : (
          <PageState
            className="px-4"
            description={status === 'error' ? t('loadError') : t('emptyDescription')}
            headingLevel={2}
            kind={status === 'error' ? 'error' : 'empty'}
            title={t('emptyTitle')}
          />
        )}

        <div className="border-t border-border p-2">
          <Button
            className="w-full justify-start"
            nativeButton={false}
            render={<Link href="/profile#notifications" onClick={onNavigate} />}
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
