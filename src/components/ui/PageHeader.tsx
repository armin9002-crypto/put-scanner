import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
        {meta && <div className="mt-1">{meta}</div>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="min-w-0">
        <h2>{title}</h2>
        {description && <p className="mt-0.5 normal-case tracking-normal" style={{ color: 'var(--text-tertiary)', fontWeight: 450 }}>{description}</p>}
      </div>
      {actions && <div className="flex flex-none items-center gap-2 normal-case tracking-normal">{actions}</div>}
    </div>
  );
}
