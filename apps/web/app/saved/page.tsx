import { journalSerif } from '@/components/memories/journal-font';
import { SavedPlacesManager } from '@/components/saved-places-manager';

export default function SavedPage() {
  return (
    <div className={journalSerif.variable}>
      <SavedPlacesManager />
    </div>
  );
}
