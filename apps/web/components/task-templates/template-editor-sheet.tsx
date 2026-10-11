'use client';

import { CircleAlert, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { TaskTemplateInput } from '@/lib/tasks/api';

export const MAX_TEMPLATE_TASKS = 20;

type DraftItem = { label: string; note: string | null };

/** What the editor opens on. `key` changes on every opening so the form starts fresh. */
export type TemplateDraft = { items: DraftItem[]; key: number; name: string };

type TemplateEditorSheetProps = {
  draft: TemplateDraft | null;
  editing: boolean;
  onClose: () => void;
  onDelete?: () => void;
  onSubmit: (input: TaskTemplateInput) => Promise<void>;
};

/**
 * A template as a list you write in place: the name in the journal serif, then
 * one task per line. Return starts the next line, blank lines are dropped on
 * save, and a task's note (set elsewhere) rides along untouched.
 */
export function TemplateEditorSheet({
  draft,
  editing,
  onClose,
  onDelete,
  onSubmit,
}: Readonly<TemplateEditorSheetProps>) {
  const t = useTranslations('taskTemplates');

  return (
    <Sheet onOpenChange={(open) => !open && onClose()} open={Boolean(draft)}>
      <SheetContent
        className="w-full gap-0 md:data-[side=right]:w-[min(34rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        {draft ? (
          <EditorForm
            draft={draft}
            editing={editing}
            key={draft.key}
            onDelete={onDelete}
            onSubmit={onSubmit}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditorForm({
  draft,
  editing,
  onDelete,
  onSubmit,
}: Readonly<Omit<TemplateEditorSheetProps, 'draft' | 'onClose'> & { draft: TemplateDraft }>) {
  const t = useTranslations('taskTemplates');
  const [name, setName] = useState(draft.name);
  const [items, setItems] = useState<DraftItem[]>(
    draft.items.length ? draft.items : [{ label: '', note: null }],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);

  // A new line takes focus once it exists, so typing a list never leaves the keyboard.
  useEffect(() => {
    if (pendingFocus.current === null) return;
    inputs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  });

  function insertAfter(index: number) {
    if (items.length >= MAX_TEMPLATE_TASKS) return;
    setItems((current) => current.toSpliced(index + 1, 0, { label: '', note: null }));
    pendingFocus.current = index + 1;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const kept = items
      .map((item) => ({ label: item.label.trim(), note: item.note }))
      .filter((item) => item.label);
    if (!trimmedName || !kept.length) {
      setError(t('requiredError'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        items: kept.map((item) => (item.note ? item : { label: item.label })),
        name: trimmedName,
      });
    } catch {
      setError(t('saveError'));
      setSaving(false);
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <SheetHeader className="gap-1 border-b-0 px-5 pt-6 pb-0 sm:px-6">
        <SheetTitle className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {editing ? t('editTitle') : t('createTitle')}
        </SheetTitle>
        <label className="block">
          <span className="sr-only">{t('name')}</span>
          <input
            autoComplete="off"
            className="w-full border-0 border-b border-border-subtle bg-transparent pt-1 pb-2.5 font-journal text-[2.25rem] leading-tight text-foreground outline-none placeholder:text-text-subtle focus-visible:border-brand"
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('namePlaceholder')}
            value={name}
          />
        </label>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4 sm:px-6">
        {error ? (
          <Alert className="mb-3" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-baseline justify-between pb-1">
          <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            {t('templateTasks')}
          </h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.filter((item) => item.label.trim()).length}
          </span>
        </div>
        <ol>
          {items.map((item, index) => (
            <li
              className="flex items-center gap-3 border-b border-border-subtle focus-within:border-brand"
              key={index}
            >
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-full border-[1.5px] border-secondary-foreground/40"
              />
              <Input
                aria-label={t('taskLabel', { number: index + 1 })}
                className="h-12 rounded-none border-0 bg-transparent px-0 text-base shadow-none hover:border-0 focus-visible:ring-0 md:text-base dark:bg-transparent"
                maxLength={200}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((entry, entryIndex) =>
                      entryIndex === index ? { ...entry, label: event.target.value } : entry,
                    ),
                  )
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  insertAfter(index);
                }}
                placeholder={t('taskPlaceholder')}
                ref={(element) => {
                  inputs.current[index] = element;
                }}
                value={item.label}
              />
              <Button
                aria-label={t('removeTask', { number: index + 1 })}
                className="text-muted-foreground"
                disabled={items.length === 1}
                onClick={() =>
                  setItems((current) => current.filter((_, entryIndex) => entryIndex !== index))
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          className="mt-1 -ml-2 h-11 px-2 text-brand"
          disabled={items.length >= MAX_TEMPLATE_TASKS}
          onClick={() => insertAfter(items.length - 1)}
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('addTemplateTask')}
        </Button>
        {items.length >= MAX_TEMPLATE_TASKS ? (
          <p className="text-xs text-muted-foreground">
            {t('taskLimit', { count: MAX_TEMPLATE_TASKS })}
          </p>
        ) : null}
      </div>

      <SheetFooter className="gap-3 px-5 pt-4 sm:px-6">
        <SheetDescription className="text-[0.8125rem] leading-5">
          {editing ? t('editNote') : t('createNote')}
        </SheetDescription>
        <div className="flex gap-2">
          {editing && onDelete ? (
            <Button
              aria-label={t('deleteTemplate')}
              className="size-12 rounded-full"
              disabled={saving}
              onClick={onDelete}
              size="icon"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
          <Button className="h-12 flex-1 rounded-full text-base" disabled={saving} type="submit">
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}
