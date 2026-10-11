import { journalSerif } from '@/components/memories/journal-font';
import { ToolsLauncher } from '@/components/tools-launcher';

export default function ToolsPage() {
  return (
    <div className={journalSerif.variable}>
      <ToolsLauncher />
    </div>
  );
}
