type SavedPlaceRemovalModel = {
  deleteMany(input: { where: { id: string; ownerId: string } }): Promise<{ count: number }>;
};

export async function removeOwnedSavedPlace(
  model: SavedPlaceRemovalModel,
  ownerId: string,
  savedPlaceId: string,
) {
  const result = await model.deleteMany({
    where: { id: savedPlaceId, ownerId },
  });

  return result.count > 0;
}
