'use client';
// The Accountant's receivables chart (drawn by components/charts/Lite.js).
import { XYChart } from '@/components/charts/Lite';
import { inr } from '@/lib/format';

export function AgeingChart({ data }) {
  return (
    <XYChart
      height={190} label="Receivables by age" data={data} left={46} legend={false} xLabel={(r) => r.label}
      yFormat={(v) => (v >= 100000 ? `${v / 100000}L` : v)}
      bars={[{ key: 'amount', color: '#B5651D', name: 'Owed', colors: ['#9CA3AF', '#D9A066', '#B5651D', '#DC2626'] }]}
      tip={(r) => [{ name: 'Owed', value: inr(r.amount) }]}
    />
  );
}
