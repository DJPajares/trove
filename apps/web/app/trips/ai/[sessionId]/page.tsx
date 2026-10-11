import { isPlanScoreEnabled } from '@/lib/plan-score/config.server';
import { AiPlanningReview } from '@/components/ai-planning-review';
import { journalSerif } from '@/components/memories/journal-font';

export default async function AiPlanningReviewPage({
  params,
}: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const { sessionId } = await params;
  return (
    <div className={journalSerif.variable}>
      <AiPlanningReview planScoreEnabled={isPlanScoreEnabled()} sessionId={sessionId} />
    </div>
  );
}
