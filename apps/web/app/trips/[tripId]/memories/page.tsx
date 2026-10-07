import { MemoriesJournal } from '@/components/memories/memories-journal';

export default async function TripMemoriesPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <MemoriesJournal tripId={tripId} />;
}
