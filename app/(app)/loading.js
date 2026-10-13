import { Skeleton } from '@/components/ui';

// Shown by Next while a screen's first data is being prepared: the same rhythm as the real screens (header, stat cards, list rows), so nothing jumps.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-48 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      <div className="space-y-2.5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );
}
