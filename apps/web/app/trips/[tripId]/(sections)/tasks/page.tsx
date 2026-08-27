import { TasksManager } from '@/components/tasks-manager';

export default async function TripTasksPage({
  params,
}: Readonly<{ params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  return <TasksManager tripId={tripId} />;
}
