import type { ReactNode } from 'react';

type PagePlaceholderProps = {
  description: string;
  eyebrow: string;
  icon: ReactNode;
  status: string;
  title: string;
};

export function PagePlaceholder({
  description,
  eyebrow,
  icon,
  status,
  title,
}: PagePlaceholderProps) {
  return (
    <section
      aria-labelledby="placeholder-heading"
      className="grid min-h-[calc(100svh-8rem)] place-items-center"
    >
      <div className="w-full max-w-2xl rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-sm sm:p-10">
        <div className="mb-8 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
          {icon}
        </div>
        <p className="mb-3 text-sm font-medium tracking-wide text-brand">{eyebrow}</p>
        <h1
          id="placeholder-heading"
          className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          {title}
        </h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
          {description}
        </p>
        <div className="mt-8 rounded-[var(--radius-lg)] border border-border bg-surface-sunken px-4 py-3 text-sm text-text-subtle">
          {status}
        </div>
      </div>
    </section>
  );
}
