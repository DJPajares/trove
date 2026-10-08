import { JournalSkeleton } from '@/components/memories/journal-skeleton';

/**
 * The journal's own frame, so the way in never shows a different screen's
 * skeleton first. The page draws the same frame while its data loads.
 */
export default function TripMemoriesLoading() {
  return <JournalSkeleton />;
}
