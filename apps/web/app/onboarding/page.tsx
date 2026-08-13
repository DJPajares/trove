import { OnboardingFlow } from '@/components/onboarding-flow';

export default function OnboardingPage() {
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="grid min-h-[calc(100dvh-10rem)] place-items-center"
    >
      <OnboardingFlow />
    </section>
  );
}
