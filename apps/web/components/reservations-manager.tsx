'use client';

import {
  CircleAlert,
  CloudDownload,
  CloudOff,
  FileText,
  MapPin,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { DatePicker } from '@/components/date-picker';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { MoneyInput } from '@/components/money-input';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TimeInput } from '@/components/time-input';
import { TripSectionHeader } from '@/components/trip-section-header';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  createReservation,
  deleteReservation,
  deleteReservationDocument,
  fetchReservations,
  setReservationDocumentOffline,
  type Reservation,
  type ReservationsResponse,
  type ReservationType,
  updateReservation,
  uploadReservationDocument,
} from '@/lib/reservations/api';

type EditorState =
  | { mode: 'closed'; reservation: null }
  | { mode: 'create'; reservation: null }
  | { mode: 'edit'; reservation: Reservation };

type ReservationForm = {
  accommodationAddress: string;
  applicableDayIds: string[];
  bookingReference: string;
  checkInDate: string;
  checkOutDate: string;
  flightAirline: string;
  flightArrivalAirport: string;
  flightArrivalAuthoritativeInstant: string;
  flightArrivalDate: string;
  flightArrivalTime: string;
  flightArrivalTimeZone: string;
  flightDepartureAirport: string;
  flightDepartureAuthoritativeInstant: string;
  flightDepartureDate: string;
  flightDepartureTime: string;
  flightDepartureTimeZone: string;
  flightGate: string;
  flightNumber: string;
  flightSeat: string;
  flightTerminal: string;
  itineraryItemId: string;
  localDate: string;
  localTime: string;
  notes: string;
  plannedCostAmount: string;
  plannedCostCurrencyCode: string;
  provider: string;
  title: string;
  transportDropoffLocation: string;
  transportOperator: string;
  transportPickupLocation: string;
  transportServiceNumber: string;
  tripPlaceId: string;
  type: ReservationType | 'none';
};

function createForm(
  reservation: Reservation | null,
  preferredCurrency: string | null = null,
): ReservationForm {
  return {
    accommodationAddress: reservation?.accommodationAddress ?? '',
    applicableDayIds: reservation?.applicableDays.map((day) => day.id) ?? [],
    bookingReference: reservation?.bookingReference ?? '',
    checkInDate: reservation?.checkInDate ?? '',
    checkOutDate: reservation?.checkOutDate ?? '',
    flightAirline: reservation?.flight?.airline ?? '',
    flightArrivalAirport: reservation?.flight?.arrival?.airport ?? '',
    flightArrivalAuthoritativeInstant: reservation?.flight?.arrival?.authoritativeInstant ?? '',
    flightArrivalDate: reservation?.flight?.arrival?.localDate ?? '',
    flightArrivalTime: reservation?.flight?.arrival?.localTime ?? '',
    flightArrivalTimeZone: reservation?.flight?.arrival?.timeZone ?? '',
    flightDepartureAirport: reservation?.flight?.departure?.airport ?? '',
    flightDepartureAuthoritativeInstant: reservation?.flight?.departure?.authoritativeInstant ?? '',
    flightDepartureDate: reservation?.flight?.departure?.localDate ?? '',
    flightDepartureTime: reservation?.flight?.departure?.localTime ?? '',
    flightDepartureTimeZone: reservation?.flight?.departure?.timeZone ?? '',
    flightGate: reservation?.flight?.gate ?? '',
    flightNumber: reservation?.flight?.number ?? '',
    flightSeat: reservation?.flight?.seat ?? '',
    flightTerminal: reservation?.flight?.terminal ?? '',
    itineraryItemId: reservation?.itineraryItem?.id ?? 'none',
    localDate: reservation?.localDate ?? '',
    localTime: reservation?.localTime ?? '',
    notes: reservation?.notes ?? '',
    plannedCostAmount: reservation?.plannedCost?.amount ?? '',
    plannedCostCurrencyCode: reservation?.plannedCost?.currencyCode ?? preferredCurrency ?? '',
    provider: reservation?.provider ?? '',
    title: reservation?.title ?? '',
    transportDropoffLocation: reservation?.transport?.dropoffLocation ?? '',
    transportOperator: reservation?.transport?.operator ?? '',
    transportPickupLocation: reservation?.transport?.pickupLocation ?? '',
    transportServiceNumber: reservation?.transport?.serviceNumber ?? '',
    tripPlaceId: reservation?.tripPlace?.id ?? 'none',
    type: reservation?.type ?? 'none',
  };
}

function isStructuredTransport(type: ReservationForm['type']) {
  return (
    type === 'bus' ||
    type === 'ferry' ||
    type === 'other' ||
    type === 'rental_car' ||
    type === 'train'
  );
}

function hasInvalidFlightEndpoint(input: { date: string; time: string; timeZone: string }) {
  return Boolean(
    (input.time && !input.date) ||
    ((input.date || input.time) && !input.timeZone) ||
    (!input.date && input.timeZone),
  );
}

export function ReservationsManager({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('reservations');
  const locale = useLocale();
  const { preferredCurrency } = usePreferences();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const formatDate = (value: string) => dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
  const formatFileSize = (bytes: number) =>
    bytes < 1024 * 1024
      ? t('documentKilobytes', { value: Math.ceil(bytes / 1024) })
      : t('documentMegabytes', { value: (bytes / (1024 * 1024)).toFixed(1) });
  const [data, setData] = useState<ReservationsResponse | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', reservation: null });
  const [form, setForm] = useState<ReservationForm>(() => createForm(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reservationToDelete, setReservationToDelete] = useState<Reservation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offlineDocumentId, setOfflineDocumentId] = useState<string | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<{
    id: string;
    reservation: Reservation;
  } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchReservations(tripId));
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, [tripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setForm(createForm(null, preferredCurrency));
    setFormError(null);
    setEditor({ mode: 'create', reservation: null });
  }

  function openEdit(reservation: Reservation) {
    setForm(createForm(reservation));
    setFormError(null);
    setEditor({ mode: 'edit', reservation });
  }

  function closeEditor() {
    setEditor({ mode: 'closed', reservation: null });
    setFormError(null);
  }

  function updateForm<Key extends keyof ReservationForm>(key: Key, value: ReservationForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function toggleApplicableDay(dayId: string) {
    setForm((current) => ({
      ...current,
      applicableDayIds: current.applicableDayIds.includes(dayId)
        ? current.applicableDayIds.filter((id) => id !== dayId)
        : [...current.applicableDayIds, dayId],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormError(t('titleRequired'));
      return;
    }
    if (form.localTime && !form.localDate) {
      setFormError(t('dateRequiredForTime'));
      return;
    }
    if (form.plannedCostAmount && !form.plannedCostCurrencyCode) {
      setFormError(t('plannedCostPairError'));
      return;
    }
    if (form.checkInDate && form.checkOutDate && form.checkOutDate < form.checkInDate) {
      setFormError(t('accommodationDatesError'));
      return;
    }
    if (
      form.type === 'flight' &&
      (hasInvalidFlightEndpoint({
        date: form.flightDepartureDate,
        time: form.flightDepartureTime,
        timeZone: form.flightDepartureTimeZone,
      }) ||
        hasInvalidFlightEndpoint({
          date: form.flightArrivalDate,
          time: form.flightArrivalTime,
          timeZone: form.flightArrivalTimeZone,
        }))
    ) {
      setFormError(t('flightEndpointError'));
      return;
    }

    setSaving(true);
    setFormError(null);
    const input = {
      accommodationAddress: form.accommodationAddress.trim() || null,
      applicableDayIds: form.type === 'accommodation' ? form.applicableDayIds : [],
      bookingReference: form.bookingReference.trim() || null,
      checkInDate: form.checkInDate || null,
      checkOutDate: form.checkOutDate || null,
      flight:
        form.type === 'flight'
          ? {
              airline: form.flightAirline.trim() || null,
              arrival: {
                airport: form.flightArrivalAirport.trim() || null,
                authoritativeInstant: form.flightArrivalAuthoritativeInstant || null,
                localDate: form.flightArrivalDate || null,
                localTime: form.flightArrivalTime || null,
                timeZone: form.flightArrivalTimeZone.trim() || null,
              },
              departure: {
                airport: form.flightDepartureAirport.trim() || null,
                authoritativeInstant: form.flightDepartureAuthoritativeInstant || null,
                localDate: form.flightDepartureDate || null,
                localTime: form.flightDepartureTime || null,
                timeZone: form.flightDepartureTimeZone.trim() || null,
              },
              gate: form.flightGate.trim() || null,
              number: form.flightNumber.trim() || null,
              seat: form.flightSeat.trim() || null,
              terminal: form.flightTerminal.trim() || null,
            }
          : null,
      itineraryItemId: form.itineraryItemId === 'none' ? null : form.itineraryItemId,
      localDate: form.localDate || null,
      localTime: form.localTime || null,
      notes: form.notes.trim() || null,
      plannedCost: form.plannedCostAmount
        ? { amount: form.plannedCostAmount, currencyCode: form.plannedCostCurrencyCode }
        : null,
      provider: form.provider.trim() || null,
      title,
      tripPlaceId: form.tripPlaceId === 'none' ? null : form.tripPlaceId,
      transport: isStructuredTransport(form.type)
        ? {
            dropoffLocation: form.transportDropoffLocation.trim() || null,
            operator: form.transportOperator.trim() || null,
            pickupLocation: form.transportPickupLocation.trim() || null,
            serviceNumber: form.transportServiceNumber.trim() || null,
          }
        : null,
      type: form.type === 'none' ? null : form.type,
    };
    try {
      if (editor.mode === 'create') {
        await createReservation(tripId, input);
      } else if (editor.mode === 'edit') {
        await updateReservation(tripId, editor.reservation.id, input);
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
    if (!reservationToDelete) return;
    setDeleting(true);
    try {
      await deleteReservation(tripId, reservationToDelete.id);
      setReservationToDelete(null);
      closeEditor();
      await refresh();
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const reservation = editor.mode === 'edit' ? editor.reservation : null;
    event.target.value = '';
    if (!file || !reservation) return;
    setUploading(true);
    setFormError(null);
    try {
      await uploadReservationDocument(tripId, reservation.id, file);
      await refresh();
    } catch {
      setFormError(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleAttachmentDelete() {
    if (!attachmentToDelete) return;
    setDeleting(true);
    try {
      await deleteReservationDocument(
        tripId,
        attachmentToDelete.reservation.id,
        attachmentToDelete.id,
      );
      setAttachmentToDelete(null);
      await refresh();
    } catch {
      setFormError(t('deleteDocumentError'));
    } finally {
      setDeleting(false);
    }
  }

  async function toggleOfflineDocument(
    reservation: Reservation,
    attachment: Reservation['attachments'][number],
  ) {
    setOfflineDocumentId(attachment.id);
    setFormError(null);
    try {
      await setReservationDocumentOffline(
        tripId,
        reservation.id,
        attachment,
        !attachment.offlineSelected,
      );
      await refresh();
    } catch {
      setFormError(t('offlineDocumentError'));
    } finally {
      setOfflineDocumentId(null);
    }
  }

  if (status === 'loading') {
    return <PageState kind="loading" loadingShape="list" title={t('loading')} />;
  }
  if (status === 'error' || !data) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const editingReservation =
    editor.mode === 'edit'
      ? (data.reservations.find((reservation) => reservation.id === editor.reservation.id) ??
        editor.reservation)
      : null;

  return (
    <section className="space-y-7">
      <TripSectionHeader
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('addReservation')}
          </Button>
        }
        currentSection="reservations"
        description={t('description')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {data.reservations.length === 0 ? (
        <PageState
          actions={
            <Button onClick={openCreate} variant="outline">
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('addFirstReservation')}
            </Button>
          }
          className="min-h-64 justify-center"
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<ReceiptText aria-hidden="true" />}
          title={t('emptyTitle')}
        />
      ) : (
        <ItemGroup aria-label={t('reservationList')} variant="list">
          {data.reservations.map((reservation) => (
            <Item className="flex-nowrap px-3 py-3" key={reservation.id}>
              <ItemMedia
                className="size-10 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground"
                variant="icon"
              >
                {reservation.type === 'accommodation' ? (
                  <MapPin aria-hidden="true" />
                ) : (
                  <ReceiptText aria-hidden="true" />
                )}
              </ItemMedia>
              <ItemContent className="min-w-0 gap-1">
                <ItemTitle>{reservation.title}</ItemTitle>
                <ItemDescription className="line-clamp-none">
                  <span className="flex flex-wrap gap-x-2 gap-y-1">
                    {reservation.localDate ? (
                      <span className="font-medium text-foreground">
                        {reservation.localTime
                          ? t('dateTime', {
                              date: formatDate(reservation.localDate),
                              time: reservation.localTime,
                            })
                          : formatDate(reservation.localDate)}
                      </span>
                    ) : null}
                    {reservation.type ? <span>{t(`types.${reservation.type}`)}</span> : null}
                    {reservation.tripPlace?.name ? <span>{reservation.tripPlace.name}</span> : null}
                  </span>
                  {reservation.type === 'accommodation' && reservation.applicableDays.length ? (
                    <span className="mt-1 block">
                      {t('applicableDayCount', { count: reservation.applicableDays.length })}
                    </span>
                  ) : null}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="shrink-0">
                <Button
                  aria-label={t('editReservation', { title: reservation.title })}
                  onClick={() => openEdit(reservation)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}

      <Sheet onOpenChange={(open) => !open && closeEditor()} open={editor.mode !== 'closed'}>
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(42rem,calc(100%-0.5rem))]"
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
                    <FieldLabel htmlFor="reservation-title">{t('reservationTitle')}</FieldLabel>
                    <Input
                      id="reservation-title"
                      maxLength={300}
                      onChange={(event) => updateForm('title', event.target.value)}
                      placeholder={t('reservationTitlePlaceholder')}
                      required
                      value={form.title}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="reservation-type">{t('type')}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          updateForm('type', value as ReservationType | 'none')
                        }
                        value={form.type}
                      >
                        <SelectTrigger id="reservation-type" className="w-full">
                          <SelectValue>
                            {form.type === 'none' ? t('noType') : t(`types.${form.type}`)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noType')}</SelectItem>
                          {(
                            [
                              'flight',
                              'accommodation',
                              'restaurant',
                              'attraction',
                              'train',
                              'rental_car',
                              'ferry',
                              'bus',
                              'tour',
                              'other',
                            ] as const
                          ).map((type) => (
                            <SelectItem key={type} value={type}>
                              {t(`types.${type}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="reservation-provider">{t('provider')}</FieldLabel>
                      <Input
                        id="reservation-provider"
                        maxLength={200}
                        onChange={(event) => updateForm('provider', event.target.value)}
                        placeholder={t('providerPlaceholder')}
                        value={form.provider}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t('date')}</FieldLabel>
                      <DatePicker
                        id="reservation-date"
                        label={t('date')}
                        onChange={(value) => updateForm('localDate', value)}
                        value={form.localDate}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="reservation-time">{t('time')}</FieldLabel>
                      <TimeInput
                        id="reservation-time"
                        onValueChange={(value) => updateForm('localTime', value)}
                        value={form.localTime}
                      />
                      <FieldDescription>{t('timeHint')}</FieldDescription>
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="reservation-place">{t('linkedPlace')}</FieldLabel>
                      <Select
                        onValueChange={(value) => updateForm('tripPlaceId', value ?? 'none')}
                        value={form.tripPlaceId}
                      >
                        <SelectTrigger id="reservation-place" className="w-full">
                          <SelectValue>
                            {form.tripPlaceId === 'none'
                              ? t('noLinkedPlace')
                              : (data.tripPlaces.find((place) => place.id === form.tripPlaceId)
                                  ?.name ?? t('unnamedPlace'))}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedPlace')}</SelectItem>
                          {data.tripPlaces.map((place) => (
                            <SelectItem key={place.id} value={place.id}>
                              {place.name ?? t('unnamedPlace')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="reservation-item">{t('linkedItem')}</FieldLabel>
                      <Select
                        onValueChange={(value) => updateForm('itineraryItemId', value ?? 'none')}
                        value={form.itineraryItemId}
                      >
                        <SelectTrigger id="reservation-item" className="w-full">
                          <SelectValue>
                            {form.itineraryItemId === 'none'
                              ? t('noLinkedItem')
                              : (data.itineraryItems.find(
                                  (item) => item.id === form.itineraryItemId,
                                )?.label ?? t('unnamedItem'))}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('noLinkedItem')}</SelectItem>
                          {data.itineraryItems.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.label ?? t('unnamedItem')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="reservation-reference">{t('bookingReference')}</FieldLabel>
                    <Input
                      id="reservation-reference"
                      maxLength={300}
                      onChange={(event) => updateForm('bookingReference', event.target.value)}
                      placeholder={t('bookingReferencePlaceholder')}
                      value={form.bookingReference}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <Field>
                      <FieldLabel htmlFor="reservation-cost">{t('plannedCost')}</FieldLabel>
                      <MoneyInput
                        id="reservation-cost"
                        onValueChange={(value) => updateForm('plannedCostAmount', value)}
                        placeholder={t('plannedCostPlaceholder')}
                        value={form.plannedCostAmount}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="reservation-currency">{t('currency')}</FieldLabel>
                      <CurrencyCombobox
                        aria-label={t('currency')}
                        id="reservation-currency"
                        onValueChange={(value) => updateForm('plannedCostCurrencyCode', value)}
                        placeholder={t('currencyPlaceholder')}
                        value={form.plannedCostCurrencyCode}
                      />
                    </Field>
                  </div>
                  {form.type === 'flight' ? (
                    <section
                      aria-labelledby="flight-details-heading"
                      className="space-y-4 border-t pt-5"
                    >
                      <div>
                        <h3 className="text-base font-semibold" id="flight-details-heading">
                          {t('flightDetails')}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('flightDetailsHint')}
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="flight-airline">{t('airline')}</FieldLabel>
                          <Input
                            id="flight-airline"
                            maxLength={200}
                            onChange={(event) => updateForm('flightAirline', event.target.value)}
                            placeholder={t('airlinePlaceholder')}
                            value={form.flightAirline}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="flight-number">{t('flightNumber')}</FieldLabel>
                          <Input
                            id="flight-number"
                            maxLength={100}
                            onChange={(event) => updateForm('flightNumber', event.target.value)}
                            placeholder={t('flightNumberPlaceholder')}
                            value={form.flightNumber}
                          />
                        </Field>
                      </div>
                      <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                          <p className="text-sm font-medium">{t('departure')}</p>
                          <Field>
                            <FieldLabel htmlFor="flight-departure-airport">
                              {t('airport')}
                            </FieldLabel>
                            <Input
                              id="flight-departure-airport"
                              maxLength={100}
                              onChange={(event) =>
                                updateForm('flightDepartureAirport', event.target.value)
                              }
                              placeholder={t('airportPlaceholder')}
                              value={form.flightDepartureAirport}
                            />
                          </Field>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel>{t('date')}</FieldLabel>
                              <DatePicker
                                id="flight-departure-date"
                                label={t('date')}
                                onChange={(value) => updateForm('flightDepartureDate', value)}
                                value={form.flightDepartureDate}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="flight-departure-time">{t('time')}</FieldLabel>
                              <TimeInput
                                id="flight-departure-time"
                                onValueChange={(value) => updateForm('flightDepartureTime', value)}
                                value={form.flightDepartureTime}
                              />
                            </Field>
                          </div>
                          <Field>
                            <FieldLabel htmlFor="flight-departure-time-zone">
                              {t('timeZone')}
                            </FieldLabel>
                            <Input
                              id="flight-departure-time-zone"
                              maxLength={100}
                              onChange={(event) =>
                                updateForm('flightDepartureTimeZone', event.target.value)
                              }
                              placeholder={t('timeZonePlaceholder')}
                              value={form.flightDepartureTimeZone}
                            />
                          </Field>
                        </div>
                        <div className="space-y-4">
                          <p className="text-sm font-medium">{t('arrival')}</p>
                          <Field>
                            <FieldLabel htmlFor="flight-arrival-airport">{t('airport')}</FieldLabel>
                            <Input
                              id="flight-arrival-airport"
                              maxLength={100}
                              onChange={(event) =>
                                updateForm('flightArrivalAirport', event.target.value)
                              }
                              placeholder={t('airportPlaceholder')}
                              value={form.flightArrivalAirport}
                            />
                          </Field>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel>{t('date')}</FieldLabel>
                              <DatePicker
                                id="flight-arrival-date"
                                label={t('date')}
                                onChange={(value) => updateForm('flightArrivalDate', value)}
                                value={form.flightArrivalDate}
                              />
                            </Field>
                            <Field>
                              <FieldLabel htmlFor="flight-arrival-time">{t('time')}</FieldLabel>
                              <TimeInput
                                id="flight-arrival-time"
                                onValueChange={(value) => updateForm('flightArrivalTime', value)}
                                value={form.flightArrivalTime}
                              />
                            </Field>
                          </div>
                          <Field>
                            <FieldLabel htmlFor="flight-arrival-time-zone">
                              {t('timeZone')}
                            </FieldLabel>
                            <Input
                              id="flight-arrival-time-zone"
                              maxLength={100}
                              onChange={(event) =>
                                updateForm('flightArrivalTimeZone', event.target.value)
                              }
                              placeholder={t('timeZonePlaceholder')}
                              value={form.flightArrivalTimeZone}
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <Field>
                          <FieldLabel htmlFor="flight-terminal">{t('terminal')}</FieldLabel>
                          <Input
                            id="flight-terminal"
                            maxLength={100}
                            onChange={(event) => updateForm('flightTerminal', event.target.value)}
                            value={form.flightTerminal}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="flight-gate">{t('gate')}</FieldLabel>
                          <Input
                            id="flight-gate"
                            maxLength={100}
                            onChange={(event) => updateForm('flightGate', event.target.value)}
                            value={form.flightGate}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="flight-seat">{t('seat')}</FieldLabel>
                          <Input
                            id="flight-seat"
                            maxLength={100}
                            onChange={(event) => updateForm('flightSeat', event.target.value)}
                            value={form.flightSeat}
                          />
                        </Field>
                      </div>
                    </section>
                  ) : null}
                  {isStructuredTransport(form.type) ? (
                    <section
                      aria-labelledby="transport-details-heading"
                      className="space-y-4 border-t pt-5"
                    >
                      <div>
                        <h3 className="text-base font-semibold" id="transport-details-heading">
                          {t('transportDetails')}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('transportDetailsHint')}
                        </p>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="transport-operator">{t('operator')}</FieldLabel>
                          <Input
                            id="transport-operator"
                            maxLength={200}
                            onChange={(event) =>
                              updateForm('transportOperator', event.target.value)
                            }
                            placeholder={t('operatorPlaceholder')}
                            value={form.transportOperator}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="transport-service-number">
                            {t('serviceNumber')}
                          </FieldLabel>
                          <Input
                            id="transport-service-number"
                            maxLength={100}
                            onChange={(event) =>
                              updateForm('transportServiceNumber', event.target.value)
                            }
                            placeholder={t('serviceNumberPlaceholder')}
                            value={form.transportServiceNumber}
                          />
                        </Field>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel htmlFor="transport-pickup-location">
                            {t('pickupLocation')}
                          </FieldLabel>
                          <Input
                            id="transport-pickup-location"
                            maxLength={300}
                            onChange={(event) =>
                              updateForm('transportPickupLocation', event.target.value)
                            }
                            value={form.transportPickupLocation}
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="transport-dropoff-location">
                            {t('dropoffLocation')}
                          </FieldLabel>
                          <Input
                            id="transport-dropoff-location"
                            maxLength={300}
                            onChange={(event) =>
                              updateForm('transportDropoffLocation', event.target.value)
                            }
                            value={form.transportDropoffLocation}
                          />
                        </Field>
                      </div>
                    </section>
                  ) : null}
                  {form.type === 'accommodation' ? (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field>
                          <FieldLabel>{t('checkIn')}</FieldLabel>
                          <DatePicker
                            id="reservation-check-in"
                            label={t('checkIn')}
                            onChange={(value) => updateForm('checkInDate', value)}
                            value={form.checkInDate}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>{t('checkOut')}</FieldLabel>
                          <DatePicker
                            id="reservation-check-out"
                            label={t('checkOut')}
                            onChange={(value) => updateForm('checkOutDate', value)}
                            value={form.checkOutDate}
                          />
                        </Field>
                      </div>
                      <Field>
                        <FieldLabel htmlFor="reservation-address">
                          {t('accommodationAddress')}
                        </FieldLabel>
                        <Textarea
                          id="reservation-address"
                          maxLength={2_000}
                          onChange={(event) =>
                            updateForm('accommodationAddress', event.target.value)
                          }
                          placeholder={t('accommodationAddressPlaceholder')}
                          rows={2}
                          value={form.accommodationAddress}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>{t('applicableDays')}</FieldLabel>
                        <FieldDescription>{t('applicableDaysHint')}</FieldDescription>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {data.days.map((day) => (
                            <label
                              className="flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-sm"
                              key={day.id}
                            >
                              <input
                                checked={form.applicableDayIds.includes(day.id)}
                                className="size-4 accent-primary"
                                onChange={() => toggleApplicableDay(day.id)}
                                type="checkbox"
                              />
                              <span>{day.date}</span>
                            </label>
                          ))}
                        </div>
                      </Field>
                    </>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="reservation-notes">{t('notes')}</FieldLabel>
                    <Textarea
                      id="reservation-notes"
                      maxLength={5_000}
                      onChange={(event) => updateForm('notes', event.target.value)}
                      placeholder={t('notesPlaceholder')}
                      rows={3}
                      value={form.notes}
                    />
                  </Field>
                  {editingReservation ? (
                    <Field>
                      <FieldLabel>{t('documents')}</FieldLabel>
                      <FieldDescription>{t('documentsHint')}</FieldDescription>
                      <div className="mt-2 space-y-2">
                        {editingReservation.attachments.map((attachment) => (
                          <div
                            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border p-2"
                            key={attachment.id}
                          >
                            <FileText
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                            {attachment.url ? (
                              <a
                                className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
                                href={attachment.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {attachment.fileName}
                              </a>
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {attachment.fileName}
                              </span>
                            )}
                            <span className="shrink-0 text-right text-xs text-muted-foreground">
                              <span className="block">{formatFileSize(attachment.sizeBytes)}</span>
                              {attachment.offlineAvailable ? (
                                <span className="block text-status-success">
                                  {t('availableOffline')}
                                </span>
                              ) : null}
                            </span>
                            <Button
                              aria-label={t(
                                attachment.offlineSelected
                                  ? 'removeDocumentOffline'
                                  : 'saveDocumentOffline',
                                { fileName: attachment.fileName },
                              )}
                              disabled={offlineDocumentId === attachment.id}
                              onClick={() =>
                                void toggleOfflineDocument(editingReservation, attachment)
                              }
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              {attachment.offlineSelected ? (
                                <CloudOff aria-hidden="true" />
                              ) : (
                                <CloudDownload aria-hidden="true" />
                              )}
                            </Button>
                            <Button
                              aria-label={t('deleteDocument', { fileName: attachment.fileName })}
                              onClick={() =>
                                setAttachmentToDelete({
                                  id: attachment.id,
                                  reservation: editingReservation,
                                })
                              }
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        <label className="inline-flex">
                          <input
                            accept="application/pdf,image/jpeg,image/png,image/webp"
                            className="sr-only"
                            disabled={uploading}
                            onChange={handleUpload}
                            type="file"
                          />
                          <span className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-input px-3 py-2 text-sm font-medium">
                            <Upload aria-hidden="true" className="size-4" />
                            {uploading ? t('uploading') : t('addDocument')}
                          </span>
                        </label>
                      </div>
                    </Field>
                  ) : null}
                </FieldGroup>
              </div>
              <SheetFooter>
                {editor.mode === 'edit' ? (
                  <Button
                    className="sm:mr-auto"
                    onClick={() => setReservationToDelete(editor.reservation)}
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" data-icon="inline-start" />
                    {t('deleteReservation')}
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
                      : t('createReservation')}
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        onOpenChange={(open) => !open && setReservationToDelete(null)}
        open={Boolean(reservationToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { title: reservationToDelete?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteReservation')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => !open && setAttachmentToDelete(null)}
        open={Boolean(attachmentToDelete)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDocumentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDocumentDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleAttachmentDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteDocumentAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
