import { BackLink } from '@/components/back-link';

/** The way back to the Tools shelf from a tool. */
export function ToolsBackLink({ label }: Readonly<{ label: string }>) {
  return <BackLink href="/tools" label={label} />;
}
