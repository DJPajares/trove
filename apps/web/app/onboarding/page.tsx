import { OnboardingFlow } from '@/components/onboarding-flow';

export default async function OnboardingPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string }>;
}>) {
  const { next } = await searchParams;
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="grid min-h-[calc(100dvh-10rem)] place-items-center"
    >
      <OnboardingFlow next={next} />
    </section>
  );
}
