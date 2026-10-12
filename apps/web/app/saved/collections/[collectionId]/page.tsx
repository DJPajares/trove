import { journalSerif } from '@/components/memories/journal-font';
import { SavedPlacesManager } from '@/components/saved-places-manager';

/** One collection of Saved, opened as its own page. */
export default async function SavedCollectionPage({
  params,
}: Readonly<{ params: Promise<{ collectionId: string }> }>) {
  const { collectionId } = await params;
  return (
    <div className={journalSerif.variable}>
      <SavedPlacesManager collectionId={collectionId} />
    </div>
  );
}
