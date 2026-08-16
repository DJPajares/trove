import { HomeExperience } from '@/components/home-experience';
import { LandingExperience } from '@/components/landing-experience';
import { getAuthUserId } from '@/lib/auth/session';

export default async function HomePage() {
  const authUserId = await getAuthUserId();

  return authUserId ? <HomeExperience /> : <LandingExperience />;
}
