import { journalSerif } from '@/components/memories/journal-font';
import { TravellerProfile } from '@/components/profile/traveller-profile';

/** The profile sets the traveller's name and their journeys in the journal's serif. */
export default function ProfilePage() {
  return (
    <div className={journalSerif.variable}>
      <TravellerProfile />
    </div>
  );
}
