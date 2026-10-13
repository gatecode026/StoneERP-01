import { withAuth } from '@/lib/api/withAuth';
import { notFound } from '@/lib/errors';
import { getResource, updateResource, voidResource } from '@/lib/api/resource';
import { defFor } from '@/lib/resources';
import type { Resource } from '@/lib/perm/resources';

export const dynamic = 'force-dynamic';

const def = (params: Record<string, string>) => {
  const d = defFor(params.resource);
  if (!d) throw notFound();
  return d;
};
export const GET = withAuth((c) => def(c.params).key as Resource, 'view', (a) => getResource(a, def(a.params), a.params.id));
export const PATCH = withAuth((c) => def(c.params).key as Resource, 'edit', (a) => updateResource(a, def(a.params), a.params.id));
export const DELETE = withAuth((c) => def(c.params).key as Resource, 'void', (a) => voidResource(a, def(a.params), a.params.id));
