import { HomeExperience } from '@/components/home-experience';
import { LandingExperience } from '@/components/landing-experience';
import { journalSerif } from '@/components/memories/journal-font';
import { getAuthUserId } from '@/lib/auth/session';

export default async function HomePage() {
  const authUserId = await getAuthUserId();

  // Home sets a finished journey in the Memories journal's serif, so the font
  // comes with it; the signed-out landing page never asks for it.
  return authUserId ? (
    <div className={journalSerif.variable}>
      <HomeExperience />
    </div>
  ) : (
    <LandingExperience />
  );
}
