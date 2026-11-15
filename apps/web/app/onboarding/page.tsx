import { journalSerif } from '@/components/memories/journal-font';
import { OnboardingFlow } from '@/components/onboarding-flow';

export default async function OnboardingPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string; replay?: string }>;
}>) {
  const { next, replay } = await searchParams;
  // The tour sets its headings in the journal's serif, so the font comes with it.
  return (
    <div className={journalSerif.variable}>
      <OnboardingFlow next={next} replay={replay === '1'} />
    </div>
  );
}
