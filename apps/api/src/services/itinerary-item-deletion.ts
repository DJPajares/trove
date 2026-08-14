type ItineraryItemReferenceModel = {
  updateMany(input: {
    data: { itineraryItemId: null };
    where: { itineraryItemId: string; tripId: string };
  }): Promise<unknown>;
};

export type ItineraryItemReferenceTransaction = {
  expense: ItineraryItemReferenceModel;
  memory: ItineraryItemReferenceModel;
  reservation: ItineraryItemReferenceModel;
  task: ItineraryItemReferenceModel;
};

export async function unlinkItineraryItemReferences(
  transaction: ItineraryItemReferenceTransaction,
  tripId: string,
  itemId: string,
) {
  const input = {
    data: { itineraryItemId: null },
    where: { itineraryItemId: itemId, tripId },
  } as const;

  await Promise.all([
    transaction.task.updateMany(input),
    transaction.reservation.updateMany(input),
    transaction.expense.updateMany(input),
    transaction.memory.updateMany(input),
  ]);
}
