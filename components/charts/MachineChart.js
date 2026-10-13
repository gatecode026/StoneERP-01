'use client';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Section } from '@/components/ui';
import { num } from '@/lib/format';

export default function MachineChart({ byMachine }) {
  return (
          <Section title="Output by machine (sq ft)" className="mb-4">
            <div style={{ height: Math.max(260, byMachine.length * 34) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMachine} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#EADFCF" />
                  <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [n === 'sqft' ? `${num(v)} sq ft` : `${v} h`, n === 'sqft' ? 'Output' : n === 'stopped' ? 'Idle hours' : 'Breakdown hours']} />
                  <Legend formatter={(v) => (v === 'sqft' ? 'Output (sq ft)' : v === 'stopped' ? 'Idle hours' : 'Breakdown hours')} />
                  <Bar dataKey="sqft" fill="#B5651D" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
  );
}
