// ────────────────────────────────────────────────────────────────────────────
// Skeleton loading components — Tailwind `animate-pulse` pattern
// ────────────────────────────────────────────────────────────────────────────

/** Inline text placeholder */
export function SkeletonText({ width = 'w-24' }: { readonly width?: string }) {
  return (
    <span
      className={`inline-block ${width} h-4 animate-pulse rounded bg-[var(--color-border)]`}
      data-testid="skeleton-text"
    />
  );
}

/** Definition card skeleton */
export function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
      data-testid="skeleton-card"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-5 w-36 rounded bg-[var(--color-border)]" />
          <div className="h-3 w-16 rounded bg-[var(--color-border)]" />
        </div>
        <div className="flex gap-2">
          <div className="h-7 w-12 rounded bg-[var(--color-border)]" />
          <div className="h-7 w-14 rounded bg-[var(--color-border)]" />
        </div>
      </div>
      <div className="h-4 w-full rounded bg-[var(--color-border)]" />
    </div>
  );
}

/** Instance table row skeleton */
export function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--color-border)]" data-testid="skeleton-row">
      <td className="px-4 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-[var(--color-border)]" />
      </td>
      <td className="px-4 py-3">
        <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--color-border)]" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-border)]" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-border)]" />
      </td>
      <td className="px-4 py-3" />
    </tr>
  );
}

/** Header text skeleton (for instance viewer) */
export function SkeletonHeader() {
  return (
    <div
      className="flex animate-pulse flex-wrap items-center gap-3 pb-4"
      data-testid="skeleton-header"
    >
      <div className="h-6 w-48 rounded bg-[var(--color-border)]" />
      <div className="h-5 w-16 rounded-full bg-[var(--color-border)]" />
      <div className="h-4 w-64 rounded bg-[var(--color-border)]" />
    </div>
  );
}

/** Canvas / diagram skeleton */
export function SkeletonDiagram() {
  return (
    <div
      className="flex h-[500px] animate-pulse items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
      data-testid="skeleton-diagram"
    >
      <div className="text-sm text-[var(--color-text-muted)]">Loading diagram…</div>
    </div>
  );
}
