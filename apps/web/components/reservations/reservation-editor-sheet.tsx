'use client';

import {
  ChevronDown,
  CircleAlert,
  CloudDownload,
  CloudOff,
  FileText,
  Trash2,
  Upload,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';

import { useTripReadOnly } from '@/components/trip-provider';
import { CurrencyCombobox } from '@/components/currency-combobox';
import { DatePicker } from '@/components/date-picker';
import { MoneyInput } from '@/components/money-input';
import { SearchSelect, timeZoneOptions } from '@/components/reservations/search-select';
import { TimeInput } from '@/components/time-input';
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
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetFooter, SheetHeading } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  createReservation,
  deleteReservationDocument,
  ReservationsApiError,
  setReservationDocumentOffline,
  updateReservation,
  uploadReservationDocument,
  type Reservation,
  type ReservationInput,
  type ReservationsResponse,
  type ReservationType,
} from '@/lib/reservations/api';
import { isJourneyType, stayDayIds } from '@/lib/reservations/view';
import { cn } from '@/lib/utils';

/** The kinds most bookings are, first; the rest one tap away. */
const PRIMARY_TYPES: readonly ReservationType[] = [
  'flight',
  'accommodation',
  'train',
  'restaurant',
  'attraction',
  'rental_car',
];
const MORE_TYPES: readonly ReservationType[] = ['bus', 'ferry', 'tour', 'other'];

type Endpoint = { date: string; instant: string; time: string; timeZone: string };

type Form = {
  accommodationAddress: string;
  applicableDayIds: string[];
  arrival: Endpoint;
  bookingReference: string;
  checkInDate: string;
  checkOutDate: string;
  departure: Endpoint;
  flightAirline: string;
  flightArrivalAirport: string;
  flightDepartureAirport: string;
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
  type: ReservationType | null;
};

function endpointFrom(
  endpoint:
    | {
        authoritativeInstant?: string | null;
        localDate?: string | null;
        localTime?: string | null;
        timeZone?: string | null;
      }
    | null
    | undefined,
): Endpoint {
  return {
    date: endpoint?.localDate ?? '',
    instant: endpoint?.authoritativeInstant ?? '',
    time: endpoint?.localTime ?? '',
    timeZone: endpoint?.timeZone ?? '',
  };
}

/**
 * The form a reservation opens in. A booking saved before its type had its own
 * date fields kept only the plain date, so that date seeds the departure or
 * check-in here - editing never shows a dated booking as undated.
 */
function createForm(
  reservation: Reservation | null,
  type: ReservationType | null,
  preferredCurrency: string | null,
): Form {
  const kind = reservation?.type ?? type;
  const legacy = {
    date: reservation?.localDate ?? '',
    instant: '',
    time: reservation?.localTime ?? '',
    timeZone: reservation?.timeZone ?? '',
  };
  const journey = reservation?.flight ?? reservation?.transport ?? null;
  const departure = endpointFrom(journey?.departure);
  return {
    accommodationAddress: reservation?.accommodationAddress ?? '',
    applicableDayIds: reservation?.applicableDays.map((day) => day.id) ?? [],
    arrival: endpointFrom(journey?.arrival),
    bookingReference: reservation?.bookingReference ?? '',
    checkInDate: reservation?.checkInDate ?? (kind === 'accommodation' ? legacy.date : ''),
    checkOutDate: reservation?.checkOutDate ?? '',
    departure:
      (kind === 'flight' || isJourneyType(kind)) && !departure.date && legacy.date
        ? legacy
        : departure,
    flightAirline: reservation?.flight?.airline ?? '',
    flightArrivalAirport: reservation?.flight?.arrival?.airport ?? '',
    flightDepartureAirport: reservation?.flight?.departure?.airport ?? '',
    flightGate: reservation?.flight?.gate ?? '',
    flightNumber: reservation?.flight?.number ?? '',
    flightSeat: reservation?.flight?.seat ?? '',
    flightTerminal: reservation?.flight?.terminal ?? '',
    itineraryItemId: reservation?.itineraryItem?.id ?? '',
    localDate: legacy.date,
    localTime: legacy.time,
    notes: reservation?.notes ?? '',
    plannedCostAmount: reservation?.plannedCost?.amount ?? '',
    plannedCostCurrencyCode: reservation?.plannedCost?.currencyCode ?? preferredCurrency ?? '',
    provider: reservation?.provider ?? '',
    title: reservation?.title ?? '',
    transportDropoffLocation: reservation?.transport?.dropoffLocation ?? '',
    transportOperator: reservation?.transport?.operator ?? '',
    transportPickupLocation: reservation?.transport?.pickupLocation ?? '',
    transportServiceNumber: reservation?.transport?.serviceNumber ?? '',
    tripPlaceId: reservation?.tripPlace?.id ?? '',
    type: kind,
  };
}

export type ReservationEditor =
  | { mode: 'closed' }
  | { mode: 'create'; type: ReservationType | null }
  | { mode: 'edit'; reservation: Reservation };

type ReservationEditorSheetProps = {
  data: ReservationsResponse;
  defaultTimeZone: string;
  editor: ReservationEditor;
  onClose: () => void;
  onDelete: (reservation: Reservation) => void;
  onDocumentsChanged: () => Promise<void>;
  onSaved: () => Promise<void>;
  preferredCurrency: string | null;
  tripId: string;
};

/**
 * Adding a booking asks for what a traveller needs on the road and nothing
 * else: what it is, when, and the reference they will be asked for. Places,
 * itinerary stops, time zones, costs and the finer details of a flight or a
 * train wait under More details. Times default to the trip's own time zone,
 * so none has to be typed to save.
 */
export function ReservationEditorSheet(props: Readonly<ReservationEditorSheetProps>) {
  const t = useTranslations('reservations');
  const readOnly = useTripReadOnly();
  const open = props.editor.mode !== 'closed';
  const key =
    props.editor.mode === 'edit'
      ? props.editor.reservation.id
      : props.editor.mode === 'create'
        ? `create-${props.editor.type ?? 'any'}`
        : 'closed';

  return (
    <Sheet onOpenChange={(next) => !next && props.onClose()} open={open}>
      <SheetContent
        className="w-full gap-0 md:data-[side=right]:w-[min(36rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
      >
        <SheetHeading
          description={
            readOnly
              ? t('viewDescription')
              : props.editor.mode === 'edit'
                ? undefined
                : t('createDescription')
          }
          title={
            readOnly
              ? t('viewTitle')
              : props.editor.mode === 'edit'
                ? t('editTitle')
                : t('createTitle')
          }
        />
        {props.editor.mode !== 'closed' ? <EditorForm key={key} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function EditorForm({
  data,
  defaultTimeZone,
  editor,
  onClose,
  onDelete,
  onDocumentsChanged,
  onSaved,
  preferredCurrency,
  tripId,
}: Readonly<ReservationEditorSheetProps>) {
  const t = useTranslations('reservations');
  const readOnly = useTripReadOnly();
  const locale = useLocale();
  const editing = editor.mode === 'edit' ? editor.reservation : null;
  const [form, setForm] = useState<Form>(() => {
    const initial = createForm(
      editing,
      editor.mode === 'create' ? editor.type : null,
      preferredCurrency,
    );
    // A new booking starts in the trip's own time zone, shown under More
    // details, so a time never needs a zone typed before it can save.
    if (!editing) {
      initial.departure.timeZone = defaultTimeZone;
      initial.arrival.timeZone = defaultTimeZone;
    }
    return initial;
  });
  // A stay follows its dates until the traveller picks its nights themselves;
  // one saved with exactly its dates' nights is still following them.
  const [nightsChosen, setNightsChosen] = useState(() => {
    const saved = editing?.applicableDays.map((day) => day.id) ?? [];
    if (!saved.length) return false;
    const fromDates = stayDayIds(form.checkInDate, form.checkOutDate, data.days);
    return saved.length !== fromDates.length || saved.some((id) => !fromDates.includes(id));
  });
  const [showMoreTypes, setShowMoreTypes] = useState(() =>
    Boolean(form.type && MORE_TYPES.includes(form.type)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offlineDocumentId, setOfflineDocumentId] = useState<string | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);

  const isFlight = form.type === 'flight';
  const isJourney = isJourneyType(form.type);
  const isStay = form.type === 'accommodation';
  const isCar = form.type === 'rental_car';
  const zones = useMemo(() => timeZoneOptions(locale), [locale]);
  const dayLabel = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    });
    const order = new Map(
      data.days
        .toSorted((left, right) => left.date.localeCompare(right.date))
        .map((day, index) => [day.id, index + 1]),
    );
    return (day: { date: string; id: string }) =>
      t('dayOption', {
        date: format.format(new Date(`${day.date}T00:00:00.000Z`)),
        number: order.get(day.id) ?? 0,
      });
  }, [data.days, locale, t]);
  const stayDays = nightsChosen
    ? form.applicableDayIds
    : stayDayIds(form.checkInDate, form.checkOutDate, data.days);

  function update<Key extends keyof Form>(key: Key, value: Form[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  }
  function updateEndpoint(side: 'arrival' | 'departure', patch: Partial<Endpoint>) {
    // An edited time is the traveller's, so a stored exact instant no longer speaks for it.
    setForm((current) => ({ ...current, [side]: { ...current[side], ...patch, instant: '' } }));
    setError(null);
  }

  const placeOptions = useMemo(
    () =>
      data.tripPlaces.map((place) => ({
        label: place.name ?? t('unnamedPlace'),
        value: place.id,
      })),
    [data.tripPlaces, t],
  );
  const stopOptions = useMemo(() => {
    const days = new Map(data.days.map((day) => [day.id, day]));
    return data.itineraryItems.map((item) => {
      const day = item.dayId ? days.get(item.dayId) : null;
      return {
        hint: day ? dayLabel(day) : t('unscheduledStop'),
        label: item.label ?? t('unnamedItem'),
        value: item.id,
      };
    });
  }, [data.days, data.itineraryItems, dayLabel, t]);

  // What More details already holds, so an edited booking says it has more.
  const filledDetails = [
    form.tripPlaceId,
    form.itineraryItemId,
    form.provider,
    form.notes,
    form.plannedCostAmount,
    isFlight ? form.flightAirline : '',
    isFlight ? form.flightDepartureAirport || form.flightArrivalAirport : '',
    isFlight ? form.flightTerminal || form.flightGate || form.flightSeat : '',
    isJourney ? form.transportOperator || form.transportServiceNumber : '',
    isJourney ? form.transportPickupLocation || form.transportDropoffLocation : '',
    isStay ? form.accommodationAddress : '',
  ].filter((value) => value.trim()).length;
  const [moreOpen, setMoreOpen] = useState(() => readOnly || filledDetails > 0);

  function endpointInput(endpoint: Endpoint) {
    return {
      authoritativeInstant: endpoint.instant || null,
      localDate: endpoint.date || null,
      localTime: endpoint.date ? endpoint.time || null : null,
      timeZone: endpoint.date ? endpoint.timeZone || defaultTimeZone : null,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const title = form.title.trim();
    if (!title) return setError(t('titleRequired'));
    const journeyLike = isFlight || isJourney;
    if (
      journeyLike ? form.departure.time && !form.departure.date : form.localTime && !form.localDate
    ) {
      return setError(t('dateRequiredForTime'));
    }
    if (journeyLike && form.arrival.time && !form.arrival.date) {
      return setError(t('dateRequiredForTime'));
    }
    if (form.plannedCostAmount && !form.plannedCostCurrencyCode) {
      return setError(t('plannedCostPairError'));
    }
    if (isStay && form.checkInDate && form.checkOutDate && form.checkOutDate < form.checkInDate) {
      return setError(t('accommodationDatesError'));
    }

    // The booking's own date is read from wherever its type keeps it, so it is
    // never entered twice and the list, Plan Score and Trip Mode agree.
    const when = journeyLike
      ? {
          localDate: form.departure.date || null,
          localTime: form.departure.date ? form.departure.time || null : null,
        }
      : isStay
        ? {
            localDate: form.checkInDate || null,
            localTime: form.checkInDate === form.localDate ? form.localTime || null : null,
          }
        : {
            localDate: form.localDate || null,
            localTime: form.localDate ? form.localTime || null : null,
          };

    const input: ReservationInput = {
      accommodationAddress: isStay ? form.accommodationAddress.trim() || null : null,
      applicableDayIds: isStay ? stayDays : [],
      bookingReference: form.bookingReference.trim() || null,
      checkInDate: isStay ? form.checkInDate || null : null,
      checkOutDate: isStay ? form.checkOutDate || null : null,
      flight: isFlight
        ? {
            airline: form.flightAirline.trim() || null,
            arrival: {
              airport: form.flightArrivalAirport.trim() || null,
              ...endpointInput(form.arrival),
            },
            departure: {
              airport: form.flightDepartureAirport.trim() || null,
              ...endpointInput(form.departure),
            },
            gate: form.flightGate.trim() || null,
            number: form.flightNumber.trim() || null,
            seat: form.flightSeat.trim() || null,
            terminal: form.flightTerminal.trim() || null,
          }
        : null,
      itineraryItemId: form.itineraryItemId || null,
      ...when,
      notes: form.notes.trim() || null,
      plannedCost: form.plannedCostAmount
        ? { amount: form.plannedCostAmount, currencyCode: form.plannedCostCurrencyCode }
        : null,
      provider: form.provider.trim() || null,
      title,
      transport: isJourney
        ? {
            arrival: endpointInput(form.arrival),
            departure: endpointInput(form.departure),
            dropoffLocation: form.transportDropoffLocation.trim() || null,
            operator: form.transportOperator.trim() || null,
            pickupLocation: form.transportPickupLocation.trim() || null,
            serviceNumber: form.transportServiceNumber.trim() || null,
          }
        : null,
      tripPlaceId: form.tripPlaceId || null,
      type: form.type,
    };

    setSaving(true);
    setError(null);
    try {
      if (editing) await updateReservation(tripId, editing.id, input);
      else await createReservation(tripId, input);
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(
        t(
          saveError instanceof ReservationsApiError &&
            (saveError.code === 'invalid_transport_details' ||
              saveError.code === 'invalid_flight_details')
            ? 'journeyTimingError'
            : 'saveError',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (readOnly || !file || !editing) return;
    setUploading(true);
    setError(null);
    try {
      await uploadReservationDocument(tripId, editing.id, file);
      await onDocumentsChanged();
    } catch {
      setError(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function toggleOffline(attachment: Reservation['attachments'][number]) {
    if (readOnly || !editing) return;
    setOfflineDocumentId(attachment.id);
    setError(null);
    try {
      await setReservationDocumentOffline(
        tripId,
        editing.id,
        attachment,
        !attachment.offlineSelected,
      );
      await onDocumentsChanged();
    } catch {
      setError(t('offlineDocumentError'));
    } finally {
      setOfflineDocumentId(null);
    }
  }

  async function deleteAttachment() {
    if (readOnly || !editing || !attachmentToDelete) return;
    setDeletingAttachment(true);
    try {
      await deleteReservationDocument(tripId, editing.id, attachmentToDelete);
      setAttachmentToDelete(null);
      await onDocumentsChanged();
    } catch {
      setError(t('deleteDocumentError'));
    } finally {
      setDeletingAttachment(false);
    }
  }

  const titlePlaceholder = t(`titlePlaceholders.${form.type ?? 'none'}`);
  const departLabel = isCar ? t('pickUp') : isStay ? t('checkIn') : t('departs');
  const arriveLabel = isCar ? t('dropOff') : t('arrives');
  const latest = editing
    ? (data.reservations.find((reservation) => reservation.id === editing.id) ?? editing)
    : null;

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <fieldset disabled={readOnly} className="contents">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pt-4 pb-6">
          {error ? (
            <Alert role="alert" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <fieldset className="min-w-0 space-y-2.5">
            <legend className="pb-2.5 text-sm font-semibold">{t('whatDidYouBook')}</legend>
            <ChipGroup
              className="gap-2"
              multiple={false}
              onValueChange={([value]) =>
                update('type', (value as ReservationType | undefined) ?? null)
              }
              value={form.type ? [form.type] : []}
            >
              {[...PRIMARY_TYPES, ...(showMoreTypes ? MORE_TYPES : [])].map((type) => (
                <Chip className="h-9 px-3.5 text-[0.8125rem]" key={type} value={type}>
                  {t(`types.${type}`)}
                </Chip>
              ))}
            </ChipGroup>
            {showMoreTypes ? null : (
              <Button
                className="-ml-2 h-9 px-2 text-brand"
                onClick={() => setShowMoreTypes(true)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('moreTypes')}
              </Button>
            )}
          </fieldset>

          <Field>
            <FieldLabel htmlFor="reservation-title">{t('reservationTitle')}</FieldLabel>
            <Input
              autoComplete="off"
              id="reservation-title"
              maxLength={300}
              onChange={(event) => update('title', event.target.value)}
              placeholder={titlePlaceholder}
              value={form.title}
            />
          </Field>

          {isFlight ? (
            <Field>
              <FieldLabel htmlFor="flight-number">{t('flightNumber')}</FieldLabel>
              <Input
                autoComplete="off"
                id="flight-number"
                maxLength={100}
                onChange={(event) => update('flightNumber', event.target.value)}
                placeholder={t('flightNumberPlaceholder')}
                value={form.flightNumber}
              />
            </Field>
          ) : null}

          {isFlight || isJourney ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <DateTimePair
                date={form.departure.date}
                id="reservation-departure"
                label={departLabel}
                onDate={(date) => updateEndpoint('departure', { date })}
                onTime={(time) => updateEndpoint('departure', { time })}
                time={form.departure.time}
              />
              <DateTimePair
                date={form.arrival.date}
                id="reservation-arrival"
                label={arriveLabel}
                min={form.departure.date || undefined}
                onDate={(date) => updateEndpoint('arrival', { date })}
                onTime={(time) => updateEndpoint('arrival', { time })}
                time={form.arrival.time}
              />
            </div>
          ) : isStay ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel>{t('checkIn')}</FieldLabel>
                <DatePicker
                  id="reservation-check-in"
                  label={t('checkIn')}
                  onChange={(value) => update('checkInDate', value)}
                  value={form.checkInDate}
                />
              </Field>
              <Field>
                <FieldLabel>{t('checkOut')}</FieldLabel>
                <DatePicker
                  id="reservation-check-out"
                  label={t('checkOut')}
                  min={form.checkInDate || undefined}
                  onChange={(value) => update('checkOutDate', value)}
                  value={form.checkOutDate}
                />
              </Field>
            </div>
          ) : (
            <DateTimePair
              date={form.localDate}
              id="reservation-when"
              label={t('when')}
              onDate={(date) => update('localDate', date)}
              onTime={(time) => update('localTime', time)}
              time={form.localTime}
            />
          )}

          <Field>
            <FieldLabel htmlFor="reservation-reference">{t('bookingReference')}</FieldLabel>
            <Input
              autoCapitalize="characters"
              autoComplete="off"
              className="font-mono tracking-[0.04em]"
              id="reservation-reference"
              maxLength={300}
              onChange={(event) => update('bookingReference', event.target.value)}
              placeholder={t('bookingReferencePlaceholder')}
              value={form.bookingReference}
            />
          </Field>

          <Collapsible onOpenChange={setMoreOpen} open={readOnly || moreOpen}>
            <CollapsibleTrigger className="group/more min-h-11 w-full justify-between border-t border-border-subtle pt-3 text-base font-semibold text-foreground hover:text-foreground">
              <span>
                {filledDetails ? t('moreDetailsCount', { count: filledDetails }) : t('moreDetails')}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]/more:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-5 pt-4">
                {placeOptions.length ? (
                  <Field>
                    <FieldLabel htmlFor="reservation-place">{t('place')}</FieldLabel>
                    <SearchSelect
                      aria-describedby={isStay ? 'reservation-place-hint' : undefined}
                      id="reservation-place"
                      label={t('place')}
                      onValueChange={(value) => update('tripPlaceId', value)}
                      options={placeOptions}
                      placeholder={t('notLinked')}
                      value={form.tripPlaceId}
                    />
                    {isStay ? (
                      <FieldDescription id="reservation-place-hint">
                        {t('stayPlaceHint')}
                      </FieldDescription>
                    ) : null}
                  </Field>
                ) : null}

                {stopOptions.length ? (
                  <Field>
                    <FieldLabel htmlFor="reservation-stop">{t('itineraryStop')}</FieldLabel>
                    <SearchSelect
                      id="reservation-stop"
                      label={t('itineraryStop')}
                      onValueChange={(value) => update('itineraryItemId', value)}
                      options={stopOptions}
                      placeholder={t('notLinked')}
                      value={form.itineraryItemId}
                    />
                  </Field>
                ) : null}

                {isStay ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="reservation-address">
                        {t('accommodationAddress')}
                      </FieldLabel>
                      <Textarea
                        id="reservation-address"
                        maxLength={2_000}
                        onChange={(event) => update('accommodationAddress', event.target.value)}
                        placeholder={t('accommodationAddressPlaceholder')}
                        rows={2}
                        value={form.accommodationAddress}
                      />
                    </Field>
                    {data.days.length ? (
                      <fieldset className="min-w-0 space-y-2">
                        <legend className="text-sm font-medium">{t('nights')}</legend>
                        <p className="text-sm text-muted-foreground">
                          {nightsChosen ? t('nightsChosenHint') : t('nightsFollowHint')}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {data.days
                            .toSorted((left, right) => left.date.localeCompare(right.date))
                            .map((day) => {
                              const on = stayDays.includes(day.id);
                              return (
                                <Button
                                  aria-pressed={on}
                                  className="h-9 rounded-full px-3 text-[0.8125rem] shadow-none"
                                  key={day.id}
                                  onClick={() => {
                                    setNightsChosen(true);
                                    update(
                                      'applicableDayIds',
                                      on
                                        ? stayDays.filter((id) => id !== day.id)
                                        : [...stayDays, day.id],
                                    );
                                  }}
                                  size="sm"
                                  type="button"
                                  variant={on ? 'default' : 'outline'}
                                >
                                  {dayLabel(day)}
                                </Button>
                              );
                            })}
                        </div>
                        {nightsChosen && form.checkInDate ? (
                          <Button
                            className="-ml-2 h-9 px-2 text-brand"
                            onClick={() => setNightsChosen(false)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            {t('matchStayDates')}
                          </Button>
                        ) : null}
                      </fieldset>
                    ) : null}
                  </>
                ) : null}

                {isFlight ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="flight-airline">{t('airline')}</FieldLabel>
                      <Input
                        id="flight-airline"
                        maxLength={200}
                        onChange={(event) => update('flightAirline', event.target.value)}
                        placeholder={t('airlinePlaceholder')}
                        value={form.flightAirline}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="flight-from">{t('fromAirport')}</FieldLabel>
                        <Input
                          id="flight-from"
                          maxLength={100}
                          onChange={(event) => update('flightDepartureAirport', event.target.value)}
                          placeholder={t('airportPlaceholder')}
                          value={form.flightDepartureAirport}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="flight-to">{t('toAirport')}</FieldLabel>
                        <Input
                          id="flight-to"
                          maxLength={100}
                          onChange={(event) => update('flightArrivalAirport', event.target.value)}
                          placeholder={t('airportPlaceholder')}
                          value={form.flightArrivalAirport}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {(
                        [
                          ['flightTerminal', 'terminal'],
                          ['flightGate', 'gate'],
                          ['flightSeat', 'seat'],
                        ] as const
                      ).map(([key, label]) => (
                        <Field key={key}>
                          <FieldLabel htmlFor={`reservation-${label}`}>{t(label)}</FieldLabel>
                          <Input
                            id={`reservation-${label}`}
                            maxLength={100}
                            onChange={(event) => update(key, event.target.value)}
                            value={form[key]}
                          />
                        </Field>
                      ))}
                    </div>
                  </>
                ) : null}

                {isJourney ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="transport-operator">{t('operator')}</FieldLabel>
                        <Input
                          id="transport-operator"
                          maxLength={200}
                          onChange={(event) => update('transportOperator', event.target.value)}
                          value={form.transportOperator}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="transport-service">{t('serviceNumber')}</FieldLabel>
                        <Input
                          id="transport-service"
                          maxLength={100}
                          onChange={(event) => update('transportServiceNumber', event.target.value)}
                          value={form.transportServiceNumber}
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field>
                        <FieldLabel htmlFor="transport-pickup">{t('pickupLocation')}</FieldLabel>
                        <Input
                          id="transport-pickup"
                          maxLength={300}
                          onChange={(event) =>
                            update('transportPickupLocation', event.target.value)
                          }
                          value={form.transportPickupLocation}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="transport-dropoff">{t('dropoffLocation')}</FieldLabel>
                        <Input
                          id="transport-dropoff"
                          maxLength={300}
                          onChange={(event) =>
                            update('transportDropoffLocation', event.target.value)
                          }
                          value={form.transportDropoffLocation}
                        />
                      </Field>
                    </div>
                  </>
                ) : null}

                {isFlight || isJourney ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(['departure', 'arrival'] as const).map((side) => (
                      <Field key={side}>
                        <FieldLabel htmlFor={`reservation-${side}-zone`}>
                          {t('timeZoneFor', {
                            side: side === 'departure' ? departLabel : arriveLabel,
                          })}
                        </FieldLabel>
                        <SearchSelect
                          id={`reservation-${side}-zone`}
                          label={t('timeZoneFor', {
                            side: side === 'departure' ? departLabel : arriveLabel,
                          })}
                          onValueChange={(timeZone) => updateEndpoint(side, { timeZone })}
                          options={zones}
                          placeholder={defaultTimeZone.replaceAll('_', ' ')}
                          value={form[side].timeZone}
                        />
                      </Field>
                    ))}
                  </div>
                ) : null}

                {isFlight || isJourney ? null : (
                  <Field>
                    <FieldLabel htmlFor="reservation-provider">{t('provider')}</FieldLabel>
                    <Input
                      id="reservation-provider"
                      maxLength={200}
                      onChange={(event) => update('provider', event.target.value)}
                      placeholder={t('providerPlaceholder')}
                      value={form.provider}
                    />
                  </Field>
                )}

                <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
                  <Field>
                    <FieldLabel htmlFor="reservation-cost">{t('plannedCost')}</FieldLabel>
                    <MoneyInput
                      id="reservation-cost"
                      onValueChange={(value) => update('plannedCostAmount', value)}
                      placeholder={t('plannedCostPlaceholder')}
                      value={form.plannedCostAmount}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="reservation-currency">{t('currency')}</FieldLabel>
                    <CurrencyCombobox
                      aria-label={t('currency')}
                      id="reservation-currency"
                      onValueChange={(value) => update('plannedCostCurrencyCode', value)}
                      placeholder={t('currencyPlaceholder')}
                      value={form.plannedCostCurrencyCode}
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="reservation-notes">{t('notes')}</FieldLabel>
                  <Textarea
                    id="reservation-notes"
                    maxLength={5_000}
                    onChange={(event) => update('notes', event.target.value)}
                    placeholder={t('notesPlaceholder')}
                    rows={3}
                    value={form.notes}
                  />
                </Field>
              </div>
            </CollapsiblePanel>
          </Collapsible>

          <section aria-labelledby="reservation-documents" className="space-y-2.5">
            <h3 className="text-base font-semibold" id="reservation-documents">
              {t('documents')}
            </h3>
            {latest ? (
              <>
                <p className="text-sm text-muted-foreground">{t('documentsHint')}</p>
                <ul className="space-y-2">
                  {latest.attachments.map((attachment) => (
                    <li
                      className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-border-subtle bg-card p-2 pl-3"
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
                      {attachment.offlineAvailable ? (
                        <span className="shrink-0 text-xs text-status-success">
                          {t('availableOffline')}
                        </span>
                      ) : null}
                      <Button
                        aria-label={t(
                          attachment.offlineSelected
                            ? 'removeDocumentOffline'
                            : 'saveDocumentOffline',
                          { fileName: attachment.fileName },
                        )}
                        aria-pressed={attachment.offlineSelected}
                        disabled={offlineDocumentId === attachment.id}
                        onClick={() => void toggleOffline(attachment)}
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
                        onClick={() => setAttachmentToDelete(attachment.id)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <label className="inline-flex">
                  <input
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="peer sr-only"
                    disabled={uploading}
                    onChange={handleUpload}
                    type="file"
                  />
                  <span className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-semibold peer-focus-visible:ring-3 peer-focus-visible:ring-ring/40">
                    <Upload aria-hidden="true" className="size-4" />
                    {uploading ? t('uploading') : t('addDocument')}
                  </span>
                </label>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('documentsAfterSave')}</p>
            )}
          </section>
        </div>
      </fieldset>
      <SheetFooter className="flex-row items-center gap-2 px-5 pt-4">
        {editing && !readOnly ? (
          <Button
            aria-label={t('deleteReservation')}
            className="size-12 shrink-0 rounded-full"
            onClick={() => onDelete(editing)}
            size="icon"
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          className="h-12 flex-1 rounded-full text-base"
          disabled={readOnly || saving}
          type="submit"
        >
          {saving ? t('saving') : editing ? t('saveChanges') : t('createReservation')}
        </Button>
      </SheetFooter>

      <AlertDialog
        onOpenChange={(next) => !next && setAttachmentToDelete(null)}
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
              disabled={readOnly || deletingAttachment}
              onClick={() => void deleteAttachment()}
              variant="destructive"
            >
              {deletingAttachment ? t('deleting') : t('deleteDocumentAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function DateTimePair({
  date,
  id,
  label,
  min,
  onDate,
  onTime,
  time,
}: Readonly<{
  date: string;
  id: string;
  label: string;
  min?: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
  time: string;
}>): ReactNode {
  const t = useTranslations('reservations');
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="pb-2 text-sm font-medium">{label}</legend>
      <div className={cn('grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2')}>
        <DatePicker
          id={`${id}-date`}
          label={t('dateOf', { label })}
          min={min}
          onChange={onDate}
          value={date}
        />
        <TimeInput
          aria-label={t('timeOf', { label })}
          id={`${id}-time`}
          onValueChange={onTime}
          value={time}
        />
      </div>
    </fieldset>
  );
}
