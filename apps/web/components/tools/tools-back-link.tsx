import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * The way back to the Tools shelf from a tool. Phones reach a tool from the
 * shelf rather than the tab bar, so the page carries its own way home.
 */
export function ToolsBackLink({ label }: Readonly<{ label: string }>) {
  return (
    <Link
      className="-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-full px-2 text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:ring-3 focus-visible:ring-ring/40"
      href="/tools"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}
