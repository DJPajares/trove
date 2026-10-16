'use client';

import { useTranslations } from 'next-intl';
import { useId, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Keep previews compact, but never leave clipped descriptions inaccessible. */
export function ExpandableDescription({
  className,
  lines = 1,
  name,
  text,
}: Readonly<{ className?: string; lines?: 1 | 2; name: string; text: string }>) {
  const t = useTranslations('placeDescription');
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const expanded = open && overflow;

  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      setOverflow(element.scrollHeight > lineHeight * lines + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [lines, text]);

  return (
    <div className={cn('relative z-10 min-w-0', className)}>
      <p
        className={cn(
          'whitespace-pre-wrap [overflow-wrap:anywhere]',
          !expanded && (lines === 1 ? 'line-clamp-1' : 'line-clamp-2'),
        )}
        id={id}
        ref={paragraph}
      >
        {text}
      </p>
      {overflow ? (
        <Button
          aria-controls={id}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'collapseFor' : 'expandFor', { name })}
          className="h-9 text-xs"
          onClick={() => setOpen((value) => !value)}
          size="sm"
          type="button"
          variant="link"
        >
          {t(expanded ? 'showLess' : 'showMore')}
        </Button>
      ) : null}
    </div>
  );
}
