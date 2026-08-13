import type { ReactNode } from 'react';

export default function MobilePageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mobile-page-header">
      <div className="min-w-0">
        <h1 className="truncate text-[21px] font-bold tracking-[-0.02em]" style={{ color: 'var(--text)' }}>{title}</h1>
        {subtitle && <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </header>
  );
}
