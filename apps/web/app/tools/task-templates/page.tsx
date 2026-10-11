import { journalSerif } from '@/components/memories/journal-font';
import { TaskTemplatesManager } from '@/components/task-templates-manager';

/** Template names are set in the Memories serif, as the other library pages are. */
export default function TaskTemplatesPage() {
  return (
    <div className={journalSerif.variable}>
      <TaskTemplatesManager />
    </div>
  );
}
