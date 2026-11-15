import { HomeExperience } from '@/components/home-experience';
import { LandingExperience } from '@/components/landing-experience';
import { journalSerif } from '@/components/memories/journal-font';
import { getAuthUserId } from '@/lib/auth/session';

export default async function HomePage() {
  const authUserId = await getAuthUserId();

  // Home sets a finished journey in the Memories journal's serif, and the
  // signed-out landing page sets its headings in it, so the font comes with both.
  return (
    <div className={journalSerif.variable}>
      {authUserId ? <HomeExperience /> : <LandingExperience />}
    </div>
  );
}
