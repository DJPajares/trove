import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

/**
 * The way back to the page a screen was opened from, above its heading. Phones
 * reach these screens from inside another page rather than the tab bar, so the
 * screen carries its own way home.
 */
export function BackLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return (
    <Link
      className="-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-full px-2 text-sm font-semibold text-brand outline-none hover:text-brand-strong focus-visible:ring-3 focus-visible:ring-ring/40"
      href={href}
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}
