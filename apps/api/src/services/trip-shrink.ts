import { createHash } from 'node:crypto';
import type { Prisma } from '@trove/db';
import type { TripShrinkImpact } from '@trove/types';
import { formatDateOnly } from './trip-rules.js';

type PlanningDay = {
  id: string;
  date: Date;
  name: string | null;
  notes: string | null;
  dailyBaseTripPlaceId: string | null;
  dailyBaseDepartureTripPlaceId: string | null;
  updatedAt: Date;
};

export async function tripShrinkImpact(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripUpdatedAt: Date,
  days: PlanningDay[],
  targetDates: Map<string, string>,
  removedIds: string[],
  startDate: string,
  endDate: string,
): Promise<TripShrinkImpact> {
  const [items, tasks, expenses, memories, reservations, experiences] = await Promise.all([
    transaction.itineraryItem.findMany({
      where: { tripId, itineraryDayId: { in: removedIds } },
      select: { id: true, itineraryDayId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    transaction.task.findMany({
      where: { tripId },
      select: { id: true, itineraryDayId: true, itineraryItemId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    transaction.expense.findMany({
      where: { tripId },
      select: { id: true, itineraryDayId: true, itineraryItemId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    transaction.memory.findMany({
      where: { tripId },
      select: { id: true, itineraryDayId: true, itineraryItemId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    transaction.reservation.findMany({
      where: { tripId },
      select: {
        id: true,
        itineraryItemId: true,
        updatedAt: true,
        accommodationDays: { select: { itineraryDayId: true }, orderBy: { itineraryDayId: 'asc' } },
      },
      orderBy: { id: 'asc' },
    }),
    transaction.dayExperience.findMany({ where: { tripId }, orderBy: { date: 'asc' } }),
  ]);
  const sortedDays = [...days].sort((a, b) => a.date.getTime() - b.date.getTime());
  const removedDays = sortedDays
    .filter((day) => removedIds.includes(day.id))
    .map((day) => {
      const itemIds = new Set(
        items.filter((item) => item.itineraryDayId === day.id).map((item) => item.id),
      );
      const linked = (record: { itineraryDayId: string | null; itineraryItemId: string | null }) =>
        record.itineraryDayId === day.id ||
        (record.itineraryItemId !== null && itemIds.has(record.itineraryItemId));
      const experience = experiences.find(
        (entry) => formatDateOnly(entry.date) === formatDateOnly(day.date),
      );
      return {
        id: day.id,
        date: formatDateOnly(day.date),
        targetDate: targetDates.get(day.id)!,
        name: day.name,
        notes: day.notes,
        rating: experience?.rating ?? null,
        reflectionNote: experience?.note ?? null,
        bases:
          Number(Boolean(day.dailyBaseTripPlaceId)) +
          Number(Boolean(day.dailyBaseDepartureTripPlaceId)),
        items: itemIds.size,
        tasks: tasks.filter(linked).length,
        expenses: expenses.filter(linked).length,
        memories: memories.filter(linked).length,
        reservations: reservations.filter(
          (record) =>
            (record.itineraryItemId !== null && itemIds.has(record.itineraryItemId)) ||
            record.accommodationDays.some((link) => link.itineraryDayId === day.id),
        ).length,
      };
    });
  const retainedDays = sortedDays
    .filter((day) => !removedIds.includes(day.id))
    .map((day) => ({
      id: day.id,
      date: targetDates.get(day.id)!,
      name: day.name,
      notes: day.notes,
    }));
  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        tripId,
        tripUpdatedAt,
        startDate,
        endDate,
        days: sortedDays,
        items,
        tasks,
        expenses,
        memories,
        reservations,
        experiences,
      }),
    )
    .digest('hex');
  return { revision, removedDays, retainedDays };
}

export function hasShrinkContent(impact: TripShrinkImpact) {
  return impact.removedDays.some(
    (day) =>
      day.notes?.trim() ||
      day.rating !== null ||
      day.reflectionNote ||
      day.bases ||
      day.items ||
      day.tasks ||
      day.reservations ||
      day.expenses ||
      day.memories,
  );
}
