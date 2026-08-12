'use client';

import {
  ArrowLeft,
  CircleAlert,
  Copy,
  ExternalLink,
  Info,
  Link as LinkIcon,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createTripInfo,
  deleteTripInfo,
  fetchTripInfo,
  type TripInfoEntry,
  type TripInfoResponse,
  updateTripInfo,
} from '@/lib/trip-info/api';
import { cn } from '@/lib/utils';

type EditorState =
  | { entry: null; mode: 'closed' }
  | { entry: null; mode: 'create' }
  | { entry: TripInfoEntry; mode: 'edit' };

type TripInfoForm = {
  category: string;
  isPinned: boolean;
  label: string;
  link: string;
  note: string;
  value: string;
};

function createForm(entry: TripInfoEntry | null): TripInfoForm {
  return {
    category: entry?.category ?? '',
    isPinned: entry?.isPinned ?? false,
    label: entry?.label ?? '',
    link: entry?.link ?? '',
    note: entry?.note ?? '',
    value: entry?.value ?? '',
  };
}

export function TripInfoManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripInfo');
  const [data, setData] = useState<TripInfoResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ entry: null, mode: 'closed' });
  const [form, setForm] = useState<TripInfoForm>(() => createForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<TripInfoEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchTripInfo(tripId));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setForm(createForm(null));
    setFormError(null);
    setEditor({ entry: null, mode: 'create' });
  }

  function openEdit(entry: TripInfoEntry) {
    setForm(createForm(entry));
    setFormError(null);
    setEditor({ entry, mode: 'edit' });
  }

  function closeEditor() {
    setEditor({ entry: null, mode: 'closed' });
    setFormError(null);
  }

  function updateForm<Key extends keyof TripInfoForm>(key: Key, value: TripInfoForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  async function copy(value: string, successMessage: string) {
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(successMessage);
    } catch {
      setError(t('copyError'));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = form.label.trim();
    const value = form.value.trim();
    if (!label || !value) {
      setFormError(t('requiredError'));
      return;
    }

    setSaving(true);
    setFormError(null);
    const input = {
      category: form.category.trim() || null,
      isPinned: form.isPinned,
      label,
      link: form.link.trim() || null,
      note: form.note.trim() || null,
      value,
    };
    try {
      if (editor.mode === 'create') {
        await createTripInfo(tripId, input);
      } else if (editor.mode === 'edit') {
        await updateTripInfo(tripId, editor.entry.id, input);
      }
      await refresh();
      closeEditor();
    } catch {
      setFormError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entryToDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteTripInfo(tripId, entryToDelete.id);
      setEntryToDelete(null);
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  function renderEntry(entry: TripInfoEntry) {
    return (
      <Item className="min-h-16 flex-nowrap px-3 py-3" key={entry.id} variant="default">
        <ItemMedia
          className={cn(
            'size-9 rounded-[var(--radius-md)]',
            entry.isPinned ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground',
          )}
          variant="icon"
        >
          {entry.isPinned ? <Pin aria-hidden="true" /> : <Info aria-hidden="true" />}
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1">
          <ItemTitle>{entry.label}</ItemTitle>
          <ItemDescription className="line-clamp-none">
            <span className="block whitespace-pre-wrap break-words text-foreground">
              {entry.value}
            </span>
            {entry.category ? <span className="mt-1 block">{entry.category}</span> : null}
            {entry.note ? (
              <span className="mt-1 block whitespace-pre-wrap">{entry.note}</span>
            ) : null}
            {entry.link ? (
              <a
                className="mt-1 inline-flex items-center gap-1"
                href={entry.link}
                rel="noreferrer"
                target="_blank"
              >
                <LinkIcon aria-hidden="true" className="size-3.5" />
                {t('openLink')}
              </a>
            ) : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="shrink-0 gap-1">
          <Button
            aria-label={t('copyValue', { label: entry.label })}
            onClick={() => void copy(entry.value, t('valueCopied', { label: entry.label }))}
            size="icon-sm"
            variant="ghost"
          >
            <Copy aria-hidden="true" />
          </Button>
          {entry.link ? (
            <Button
              aria-label={t('openLinkLabel', { label: entry.label })}
              nativeButton={false}
              render={<a href={entry.link} rel="noreferrer" target="_blank" />}
              size="icon-sm"
              variant="ghost"
            >
              <ExternalLink aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            aria-label={t('editEntry', { label: entry.label })}
            onClick={() => openEdit(entry)}
            size="icon-sm"
            variant="ghost"
          >
            <Pencil aria-hidden="true" />
          </Button>
        </ItemActions>
      </Item>
    );
  }

  if (status === 'loading') {
    return <PageState className="mx-auto max-w-5xl" kind="loading" title={t('loading')} />;
  }
  if (status === 'error' || !data) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        className="mx-auto max-w-5xl"
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const pinnedEntries = data.entries.filter((entry) => entry.isPinned);
  const otherEntries = data.entries.filter((entry) => !entry.isPinned);

  return (
    <section className="mx-auto w-full max-w-5xl space-y-7">
      <PageHeader
        actions={
          <>
            <Button nativeButton={false} render={<Link href="/trips" />} variant="ghost">
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {t('backToTrips')}
            </Button>
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addEntry')}
            </Button>
          </>
        }
        description={t('description')}
        title={t('title', { trip: data.trip.name })}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">
        {copyStatus}
      </p>

      {data.entries.length === 0 ? (
        <PageState
          actions={
            <Button onClick={openCreate} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstEntry')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<Info aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      ) : (
        <div className="space-y-7">
          {pinnedEntries.length ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">{t('pinned')}</h2>
                <p className="text-sm text-muted-foreground">{t('pinnedDescription')}</p>
              </div>
              <ItemGroup aria-label={t('pinned')} variant="list">
                {pinnedEntries.map(renderEntry)}
              </ItemGroup>
            </section>
          ) : null}
          {otherEntries.length ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">{t('allEntries')}</h2>
                <p className="text-sm text-muted-foreground">{t('allEntriesDescription')}</p>
              </div>
              <ItemGroup aria-label={t('allEntries')} variant="list">
                {otherEntries.map(renderEntry)}
              </ItemGroup>
            </section>
          ) : null}
        </div>
      )}

      <Sheet onOpenChange={(open) => !open && closeEditor()} open={editor.mode !== 'closed'}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(38rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{editor.mode === 'edit' ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>
              {editor.mode === 'edit' ? t('editDescription') : t('createDescription')}
            </SheetDescription>
          </SheetHeader>
          {editor.mode !== 'closed' ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <FieldGroup>
                  {formError ? (
                    <Alert role="alert" variant="destructive">
                      <CircleAlert aria-hidden="true" />
                      <AlertDescription>{formError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="trip-info-label">{t('label')}</FieldLabel>
                    <Input
                      id="trip-info-label"
                      maxLength={120}
                      onChange={(event) => updateForm('label', event.target.value)}
                      placeholder={t('labelPlaceholder')}
                      required
                      value={form.label}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trip-info-value">{t('value')}</FieldLabel>
                    <Textarea
                      id="trip-info-value"
                      maxLength={5_000}
                      onChange={(event) => updateForm('value', event.target.value)}
                      placeholder={t('valuePlaceholder')}
                      required
                      rows={3}
                      value={form.value}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trip-info-category">{t('category')}</FieldLabel>
                    <Input
                      id="trip-info-category"
                      maxLength={100}
                      onChange={(event) => updateForm('category', event.target.value)}
                      placeholder={t('categoryPlaceholder')}
                      value={form.category}
                    />
                    <FieldDescription>{t('categoryHint')}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trip-info-link">{t('link')}</FieldLabel>
                    <Input
                      id="trip-info-link"
                      inputMode="url"
                      maxLength={2_000}
                      onChange={(event) => updateForm('link', event.target.value)}
                      placeholder={t('linkPlaceholder')}
                      type="text"
                      value={form.link}
                    />
                    <FieldDescription>{t('linkHint')}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="trip-info-note">{t('note')}</FieldLabel>
                    <Textarea
                      id="trip-info-note"
                      maxLength={5_000}
                      onChange={(event) => updateForm('note', event.target.value)}
                      placeholder={t('notePlaceholder')}
                      rows={3}
                      value={form.note}
                    />
                  </Field>
                  <Field>
                    <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border p-3">
                      <input
                        checked={form.isPinned}
                        className="mt-0.5 size-4 accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        onChange={(event) => updateForm('isPinned', event.target.checked)}
                        type="checkbox"
                      />
                      <span className="space-y-1">
                        <span className="block text-sm font-medium">{t('pinEntry')}</span>
                        <span className="block text-sm text-muted-foreground">
                          {t('pinEntryHint')}
                        </span>
                      </span>
                    </label>
                  </Field>
                </FieldGroup>
              </div>
              <SheetFooter>
                {editor.mode === 'edit' ? (
                  <Button
                    className="sm:mr-auto"
                    onClick={() => setEntryToDelete(editor.entry)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteEntry')}
                  </Button>
                ) : null}
                <Button onClick={closeEditor} type="button" variant="outline">
                  {t('cancel')}
                </Button>
                <Button disabled={saving} type="submit">
                  {saving
                    ? t('saving')
                    : editor.mode === 'edit'
                      ? t('saveChanges')
                      : t('createEntry')}
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        onOpenChange={(open) => !open && setEntryToDelete(null)}
        open={Boolean(entryToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {entryToDelete ? t('deleteDescription', { label: entryToDelete.label }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteEntry')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
