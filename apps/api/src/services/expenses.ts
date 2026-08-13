import { getPrismaClient, type Prisma } from '@trove/db';

import { totalByCurrency, projectedCostTotals, resolveExpenseTimeZone } from './expenses-rules.js';
import { formatLocalTime, parseLocalTime } from './itinerary-rules.js';
import { formatDateOnly } from './trip-rules.js';

export type ExpenseCategory = 'activities' | 'food' | 'other' | 'shopping' | 'stay' | 'transport';

export type MoneyInput = { amount: string; currencyCode: string };

export type ExpenseInput = {
  amount?: string;
  category?: ExpenseCategory | null;
  currencyCode?: string;
  itineraryItemId?: string | null;
  localDate?: string | null;
  localTime?: string | null;
  note?: string | null;
  title?: string | null;
  tripPlaceId?: string | null;
};

export class ExpenseNotFoundError extends Error {
  constructor(
    code:
      'expense_not_found' | 'itinerary_item_not_found' | 'trip_not_found' | 'trip_place_not_found',
  ) {
    super(code);
  }
}

export class ExpenseValidationError extends Error {
  constructor(
    public readonly code:
      'invalid_budget' | 'invalid_expense' | 'invalid_expense_date' | 'invalid_expense_time',
  ) {
    super(code);
  }
}

export class ExpenseConflictError extends Error {
  constructor() {
    super('expense_conflict');
  }
}

const expenseInclude = {
  itineraryDay: { select: { date: true, id: true } },
  itineraryItem: {
    select: {
      customLabel: true,
      customLocation: true,
      id: true,
      itineraryDayId: true,
      itineraryDay: { select: { defaultTimeZone: true } },
      timeZone: true,
      tripPlace: { include: { place: true } },
    },
  },
  tripPlace: { include: { place: true } },
} as const;

type ExpenseRecord = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

function parseDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDateOnly(date) !== value) {
    throw new ExpenseValidationError('invalid_expense_date');
  }
  return date;
}

function normalizeOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function mapCategory(value: ExpenseCategory | null | undefined) {
  const values = {
    activities: 'ACTIVITIES',
    food: 'FOOD',
    other: 'OTHER',
    shopping: 'SHOPPING',
    stay: 'STAY',
    transport: 'TRANSPORT',
  } as const;
  return value ? values[value] : null;
}

function serializeCategory(value: string | null) {
  const values: Record<string, ExpenseCategory> = {
    ACTIVITIES: 'activities',
    FOOD: 'food',
    OTHER: 'other',
    SHOPPING: 'shopping',
    STAY: 'stay',
    TRANSPORT: 'transport',
  };
  return value ? (values[value] ?? null) : null;
}

function serializeTimeZoneSource(value: string | null) {
  const values: Record<
    string,
    'itinerary_day' | 'itinerary_item' | 'trip_place' | 'trip_reference'
  > = {
    ITINERARY_DAY: 'itinerary_day',
    ITINERARY_ITEM: 'itinerary_item',
    TRIP_PLACE: 'trip_place',
    TRIP_REFERENCE: 'trip_reference',
  };
  return value ? (values[value] ?? null) : null;
}

function itemLabel(item: NonNullable<ExpenseRecord['itineraryItem']>) {
  return item.customLabel ?? item.customLocation ?? item.tripPlace?.place.customName ?? null;
}

function serializeExpense(expense: ExpenseRecord) {
  return {
    amount: expense.amount.toFixed(2),
    category: serializeCategory(expense.category),
    createdAt: expense.createdAt.toISOString(),
    currencyCode: expense.currencyCode.trim(),
    id: expense.id,
    itineraryDay: expense.itineraryDay
      ? { date: formatDateOnly(expense.itineraryDay.date), id: expense.itineraryDay.id }
      : null,
    itineraryItem: expense.itineraryItem
      ? { id: expense.itineraryItem.id, label: itemLabel(expense.itineraryItem) }
      : null,
    localDate: expense.localDate ? formatDateOnly(expense.localDate) : null,
    localTime: formatLocalTime(expense.localTime),
    note: expense.note,
    timeZone: expense.timeZone,
    timeZoneSource: serializeTimeZoneSource(expense.timeZoneSource),
    title: expense.title,
    tripPlace: expense.tripPlace
      ? {
          id: expense.tripPlace.id,
          name: expense.tripPlace.place.customName,
          placeId: expense.tripPlace.placeId,
        }
      : null,
    updatedAt: expense.updatedAt.toISOString(),
  };
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      budgetAmount: true,
      budgetCurrencyCode: true,
      id: true,
      name: true,
      referenceTimeZone: true,
    },
  });
  if (!trip) throw new ExpenseNotFoundError('trip_not_found');
  return trip;
}

async function findTripPlace(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripPlaceId: string | null,
) {
  if (!tripPlaceId) return null;
  const tripPlace = await transaction.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    include: { place: true },
  });
  if (!tripPlace) throw new ExpenseNotFoundError('trip_place_not_found');
  return tripPlace;
}

async function findItineraryItem(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryItemId: string | null,
) {
  if (!itineraryItemId) return null;
  const item = await transaction.itineraryItem.findFirst({
    where: { id: itineraryItemId, tripId },
    include: { itineraryDay: { select: { defaultTimeZone: true } } },
  });
  if (!item) throw new ExpenseNotFoundError('itinerary_item_not_found');
  return item;
}

async function findDayForDate(
  transaction: Prisma.TransactionClient,
  tripId: string,
  localDate: Date | null,
) {
  if (!localDate) return null;
  return transaction.itineraryDay.findFirst({
    where: { date: localDate, tripId },
    select: { defaultTimeZone: true, id: true },
  });
}

function dateTimeData(input: {
  itineraryDay: Awaited<ReturnType<typeof findDayForDate>>;
  itineraryItem: Awaited<ReturnType<typeof findItineraryItem>>;
  localDate: string | null;
  localTime: string | null;
  tripPlace: Awaited<ReturnType<typeof findTripPlace>>;
  tripTimeZone: string;
}) {
  if (!input.localDate) {
    if (input.localTime) throw new ExpenseValidationError('invalid_expense_time');
    return {
      itineraryDayId: null,
      localDate: null,
      localTime: null,
      timeZone: null,
      timeZoneResolvedAt: null,
      timeZoneSource: null,
    };
  }

  try {
    const resolution = resolveExpenseTimeZone({
      itineraryDayTimeZone: input.itineraryDay?.defaultTimeZone ?? null,
      itineraryItemTimeZone:
        input.itineraryItem?.timeZone ?? input.itineraryItem?.itineraryDay?.defaultTimeZone ?? null,
      tripPlaceTimeZone: input.tripPlace?.place.customTimeZone ?? null,
      tripTimeZone: input.tripTimeZone,
    });
    return {
      itineraryDayId: input.itineraryDay?.id ?? null,
      localDate: parseDateOnly(input.localDate),
      localTime: input.localTime ? parseLocalTime(input.localTime) : null,
      timeZone: resolution.timeZone,
      timeZoneResolvedAt: new Date(),
      timeZoneSource: resolution.source,
    };
  } catch (error) {
    if (error instanceof ExpenseValidationError) throw error;
    throw new ExpenseValidationError('invalid_expense_time');
  }
}

function budgetData(value: MoneyInput | null) {
  if (!value) return { budgetAmount: null, budgetCurrencyCode: null };
  return {
    budgetAmount: value.amount,
    budgetCurrencyCode: value.currencyCode.trim().toUpperCase(),
  };
}

async function resolveExpenseLinks(
  transaction: Prisma.TransactionClient,
  tripId: string,
  input: { itineraryItemId: string | null; localDate: string | null; tripPlaceId: string | null },
) {
  const localDate = input.localDate ? parseDateOnly(input.localDate) : null;
  const [itineraryDay, itineraryItem, tripPlace] = await Promise.all([
    findDayForDate(transaction, tripId, localDate),
    findItineraryItem(transaction, tripId, input.itineraryItemId),
    findTripPlace(transaction, tripId, input.tripPlaceId),
  ]);
  return { itineraryDay, itineraryItem, tripPlace };
}

async function getExpenseForUpdate(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
  expenseId: string,
) {
  await findOwnedTrip(transaction, userId, tripId);
  const expense = await transaction.expense.findFirst({
    where: { id: expenseId, tripId },
    include: expenseInclude,
  });
  if (!expense) throw new ExpenseNotFoundError('expense_not_found');
  return expense;
}

function requiresTimeZoneReresolution(input: ExpenseInput) {
  return (
    input.itineraryItemId !== undefined ||
    input.localDate !== undefined ||
    input.localTime !== undefined ||
    input.tripPlaceId !== undefined
  );
}

export async function listExpenses(userId: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: {
      expenses: {
        include: expenseInclude,
        orderBy: [{ localDate: 'desc' }, { createdAt: 'desc' }],
      },
      itineraryDays: { orderBy: { date: 'asc' }, select: { date: true, id: true } },
      itineraryItems: {
        orderBy: [{ itineraryDayId: 'asc' }, { position: 'asc' }],
        select: {
          customLabel: true,
          customLocation: true,
          id: true,
          itineraryDayId: true,
          plannedCostAmount: true,
          plannedCostCurrencyCode: true,
          tripPlace: { include: { place: true } },
        },
      },
      reservations: {
        select: {
          itineraryItemId: true,
          localDate: true,
          plannedCostAmount: true,
          plannedCostCurrencyCode: true,
        },
      },
      tripPlaces: { include: { place: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!trip) throw new ExpenseNotFoundError('trip_not_found');

  const actualByDay = new Map<
    string,
    Array<{ amount: (typeof trip.expenses)[number]['amount']; currencyCode: string }>
  >();
  for (const expense of trip.expenses) {
    if (!expense.itineraryDayId) continue;
    const values = actualByDay.get(expense.itineraryDayId) ?? [];
    values.push({ amount: expense.amount, currencyCode: expense.currencyCode });
    actualByDay.set(expense.itineraryDayId, values);
  }
  const dayIdByDate = new Map(trip.itineraryDays.map((day) => [formatDateOnly(day.date), day.id]));
  const itineraryDayByItemId = new Map(
    trip.itineraryItems.map((item) => [item.id, item.itineraryDayId]),
  );
  const reservationLinkedItemIds = new Set(
    trip.reservations
      .filter(
        (reservation) =>
          reservation.itineraryItemId &&
          reservation.plannedCostAmount &&
          reservation.plannedCostCurrencyCode,
      )
      .map((reservation) => reservation.itineraryItemId),
  );
  const projectedByDay = new Map<
    string,
    Array<{ amount: { toFixed: (precision: number) => string }; currencyCode: string }>
  >();
  const addProjectedCost = (
    dayId: string | null | undefined,
    value: { amount: { toFixed: (precision: number) => string }; currencyCode: string },
  ) => {
    if (!dayId) return;
    const values = projectedByDay.get(dayId) ?? [];
    values.push(value);
    projectedByDay.set(dayId, values);
  };

  for (const item of trip.itineraryItems) {
    if (
      item.plannedCostAmount &&
      item.plannedCostCurrencyCode &&
      !reservationLinkedItemIds.has(item.id)
    ) {
      addProjectedCost(item.itineraryDayId, {
        amount: item.plannedCostAmount,
        currencyCode: item.plannedCostCurrencyCode,
      });
    }
  }

  for (const reservation of trip.reservations) {
    if (!reservation.plannedCostAmount || !reservation.plannedCostCurrencyCode) continue;
    const dayId =
      (reservation.itineraryItemId
        ? itineraryDayByItemId.get(reservation.itineraryItemId)
        : null) ??
      (reservation.localDate ? dayIdByDate.get(formatDateOnly(reservation.localDate)) : null);
    addProjectedCost(dayId, {
      amount: reservation.plannedCostAmount,
      currencyCode: reservation.plannedCostCurrencyCode,
    });
  }

  return {
    actualSpend: totalByCurrency(
      trip.expenses.map((expense) => ({
        amount: expense.amount,
        currencyCode: expense.currencyCode,
      })),
    ),
    budget:
      trip.budgetAmount && trip.budgetCurrencyCode
        ? { amount: trip.budgetAmount.toFixed(2), currencyCode: trip.budgetCurrencyCode.trim() }
        : null,
    days: trip.itineraryDays.map((day) => ({
      actualSpend: totalByCurrency(actualByDay.get(day.id) ?? []),
      date: formatDateOnly(day.date),
      id: day.id,
      projectedCost: totalByCurrency(projectedByDay.get(day.id) ?? []),
    })),
    expenses: trip.expenses.map(serializeExpense),
    itineraryItems: trip.itineraryItems.map((item) => ({
      id: item.id,
      label: item.customLabel ?? item.customLocation ?? item.tripPlace?.place.customName ?? null,
    })),
    projectedCost: projectedCostTotals({
      itineraryItems: trip.itineraryItems,
      reservations: trip.reservations,
    }),
    trip: { id: trip.id, name: trip.name },
    tripPlaces: trip.tripPlaces.map((tripPlace) => ({
      id: tripPlace.id,
      name: tripPlace.place.customName,
      placeId: tripPlace.placeId,
    })),
  };
}

export async function createExpense(
  userId: string,
  tripId: string,
  input: Required<ExpenseInput>,
  clientExpenseId?: string,
) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (transaction) => {
    const trip = await findOwnedTrip(transaction, userId, tripId);
    if (clientExpenseId) {
      const existing = await transaction.expense.findFirst({
        where: { id: clientExpenseId, tripId, trip: { ownerId: userId } },
        include: expenseInclude,
      });
      if (existing) return serializeExpense(existing);
    }
    const links = await resolveExpenseLinks(transaction, tripId, input);
    const timing = dateTimeData({
      ...links,
      localDate: input.localDate,
      localTime: input.localTime,
      tripTimeZone: trip.referenceTimeZone,
    });
    const expense = await transaction.expense.create({
      data: {
        amount: input.amount,
        category: mapCategory(input.category),
        currencyCode: input.currencyCode.trim().toUpperCase(),
        ...(clientExpenseId ? { id: clientExpenseId } : {}),
        itineraryItemId: input.itineraryItemId,
        note: normalizeOptional(input.note),
        title: normalizeOptional(input.title),
        tripId,
        tripPlaceId: input.tripPlaceId,
        ...timing,
      },
      include: expenseInclude,
    });
    return serializeExpense(expense);
  });
}

export async function updateExpense(
  userId: string,
  tripId: string,
  expenseId: string,
  input: ExpenseInput,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (transaction) => {
    const existing = await getExpenseForUpdate(transaction, userId, tripId, expenseId);
    if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ExpenseConflictError();
    }
    const next = {
      itineraryItemId:
        input.itineraryItemId === undefined ? existing.itineraryItemId : input.itineraryItemId,
      localDate:
        input.localDate === undefined
          ? existing.localDate
            ? formatDateOnly(existing.localDate)
            : null
          : input.localDate,
      localTime:
        input.localTime === undefined ? formatLocalTime(existing.localTime) : input.localTime,
      tripPlaceId: input.tripPlaceId === undefined ? existing.tripPlaceId : input.tripPlaceId,
    };
    const shouldReresolve = requiresTimeZoneReresolution(input);
    const trip = shouldReresolve ? await findOwnedTrip(transaction, userId, tripId) : null;
    const links = shouldReresolve ? await resolveExpenseLinks(transaction, tripId, next) : null;
    const timing =
      shouldReresolve && trip && links
        ? dateTimeData({ ...links, ...next, tripTimeZone: trip.referenceTimeZone })
        : {};
    const updated = await transaction.expense.updateMany({
      where: {
        id: expenseId,
        ...(expectedUpdatedAt ? { updatedAt: existing.updatedAt } : {}),
      },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.category !== undefined ? { category: mapCategory(input.category) } : {}),
        ...(input.currencyCode !== undefined
          ? { currencyCode: input.currencyCode.trim().toUpperCase() }
          : {}),
        ...(input.itineraryItemId !== undefined ? { itineraryItemId: input.itineraryItemId } : {}),
        ...(input.note !== undefined ? { note: normalizeOptional(input.note) } : {}),
        ...(input.title !== undefined ? { title: normalizeOptional(input.title) } : {}),
        ...(input.tripPlaceId !== undefined ? { tripPlaceId: input.tripPlaceId } : {}),
        ...timing,
      },
    });
    if (!updated.count) throw new ExpenseConflictError();
    const expense = await transaction.expense.findUnique({
      where: { id: expenseId },
      include: expenseInclude,
    });
    if (!expense) throw new ExpenseNotFoundError('expense_not_found');
    return serializeExpense(expense);
  });
}

export async function deleteExpense(
  userId: string,
  tripId: string,
  expenseId: string,
  expectedUpdatedAt?: string,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    const existing = await getExpenseForUpdate(transaction, userId, tripId, expenseId);
    if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ExpenseConflictError();
    }
    const deleted = await transaction.expense.deleteMany({
      where: {
        id: expenseId,
        ...(expectedUpdatedAt ? { updatedAt: existing.updatedAt } : {}),
      },
    });
    if (!deleted.count) throw new ExpenseConflictError();
  });
}

export async function updateTripBudget(userId: string, tripId: string, budget: MoneyInput | null) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const trip = await transaction.trip.update({
      where: { id: tripId },
      data: budgetData(budget),
      select: { budgetAmount: true, budgetCurrencyCode: true },
    });
    return trip.budgetAmount && trip.budgetCurrencyCode
      ? { amount: trip.budgetAmount.toFixed(2), currencyCode: trip.budgetCurrencyCode.trim() }
      : null;
  });
}
