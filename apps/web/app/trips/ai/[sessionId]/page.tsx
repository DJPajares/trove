import { AiPlanningReview } from '@/components/ai-planning-review';

export default async function AiPlanningReviewPage({
  params,
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  return <AiPlanningReview sessionId={sessionId} />;
}
