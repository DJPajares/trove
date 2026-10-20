'use client';
import { useTripReadOnly } from '@/components/trip-provider';

import { Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * Inline controls on the day's photograph sit inside the swipe that turns the
 * day; a press on them must not start one.
 */
const keepFromSwipe = (event: PointerEvent) => event.stopPropagation();

/**
 * The pencil that says a thing can be edited where it is. A pointer reveals it
 * on hover or focus; a touch screen has no hover, so there it always shows,
 * quietly. Its hit area covers the whole thing it edits, so tapping the title
 * or the note itself starts editing too.
 */
const pencilClassName =
  'grid size-7 shrink-0 place-items-center rounded-full outline-none transition-opacity duration-[var(--motion-fast)] after:absolute after:inset-0 after:rounded-[inherit] focus-visible:opacity-100 focus-visible:ring-2 motion-reduce:transition-none [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:hover:opacity-100 [@media(hover:none)]:opacity-80';

/**
 * The day's title, renamed where it is shown. Empty, the day goes back to
 * being called by its town or its date - which is what the field shows while
 * it is empty, so clearing it is never a guess.
 */
export function DayTitle({
  display,
  headingId,
  name,
  numberLabel,
  onRename,
}: Readonly<{
  /** What the day is called now: its name, else its town or date. */
  display: string;
  headingId: string;
  name: string | null;
  /** "Day 3", read before the title. */
  numberLabel: string;
  onRename: (name: string | null) => Promise<boolean>;
}>) {
  const t = useTranslations('itinerary.planner.inlineEdit');
  const common = useTranslations('itinerary');
  const readOnly = useTripReadOnly();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // Escape, or a save already under way: the blur that follows either must
  // not save again.
  const settled = useRef(false);

  async function commit() {
    if (settled.current) return;
    const next = value.trim() || null;
    if (next === name) {
      setEditing(false);
      return;
    }
    settled.current = true;
    setSaving(true);
    const saved = await onRename(next);
    setSaving(false);
    setFailed(!saved);
    if (saved) setEditing(false);
    else settled.current = false;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    settled.current = true;
    setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="pointer-events-auto mt-1.5"
        onPointerDown={keepFromSwipe}
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          aria-label={t('titleLabel', { day: numberLabel })}
          autoFocus
          className="w-full border-0 border-b border-current/50 bg-transparent p-0 pb-0.5 text-[length:var(--text-section-title)] leading-tight font-semibold tracking-[-0.015em] text-inherit outline-none placeholder:text-current/55 focus:border-current disabled:opacity-70"
          disabled={saving}
          enterKeyHint="done"
          maxLength={120}
          onBlur={() => void commit()}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={display}
          value={value}
        />
        {failed ? (
          <p className="mt-1 text-xs" role="alert">
            {common('dayNameError')}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="relative mt-1.5 flex items-start gap-2">
      <h2
        className="min-w-0 text-[length:var(--text-section-title)] leading-tight font-semibold tracking-[-0.015em] text-balance break-words outline-none"
        id={headingId}
        tabIndex={-1}
      >
        <span className="sr-only">{numberLabel}: </span>
        {display}
      </h2>
      <button
        aria-label={t(name ? 'rename' : 'name', { day: numberLabel })}
        className={cn(
          pencilClassName,
          'pointer-events-auto mt-0.5 bg-white/15 focus-visible:ring-white/70',
        )}
        disabled={readOnly}
        onClick={() => {
          settled.current = false;
          setValue(name ?? '');
          setFailed(false);
          setEditing(true);
        }}
        onPointerDown={keepFromSwipe}
        type="button"
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The day's note, written where it is read. A day without one offers to add
 * one in the same place, quietly.
 */
export function DayNote({
  note,
  onSave,
}: Readonly<{
  note: string | null;
  onSave: (note: string | null) => Promise<boolean>;
}>) {
  const t = useTranslations('itinerary.planner.inlineEdit');
  const common = useTranslations('itinerary');
  const readOnly = useTripReadOnly();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function start() {
    setValue(note ?? '');
    setFailed(false);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const saved = await onSave(value.trim() || null);
    setSaving(false);
    setFailed(!saved);
    if (saved) setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Textarea
          aria-label={t('noteLabel')}
          autoFocus
          disabled={saving}
          maxLength={5_000}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={common('dayNotePlaceholder')}
          rows={3}
          value={value}
        />
        {failed ? (
          <p className="text-sm text-destructive" role="alert">
            {common('dayNoteError')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            disabled={saving}
            onClick={() => setEditing(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {common('cancel')}
          </Button>
          <Button disabled={saving} size="sm" type="submit">
            {saving ? common('saving') : common('save')}
          </Button>
        </div>
      </form>
    );
  }

  if (!note) {
    return (
      <Button
        className="-ml-2.5 text-muted-foreground"
        disabled={readOnly}
        onClick={start}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('addNote')}
      </Button>
    );
  }

  return (
    <div className="relative flex max-w-2xl items-start gap-2 text-sm leading-6 text-text-subtle">
      <Icons.Notes aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap">{note}</p>
      <button
        aria-label={t('editNote')}
        className={cn(pencilClassName, 'text-muted-foreground focus-visible:ring-ring/50')}
        disabled={readOnly}
        onClick={start}
        type="button"
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
