import { withAuth } from '@/lib/api/withAuth';
import { notFound } from '@/lib/errors';
import { createResource, listResource } from '@/lib/api/resource';
import { defFor } from '@/lib/resources';
import type { Resource } from '@/lib/perm/resources';

export const dynamic = 'force-dynamic';

const def = (params: Record<string, string>) => {
  const d = defFor(params.resource);
  if (!d) throw notFound();
  return d;
};
// the resource is resolved BEFORE the permission check, from the URL; an unknown name is a 404, a known one is checked
export const GET = withAuth((c) => def(c.params).key as Resource, 'view', (auth) => listResource(auth, def(auth.params)));
export const POST = withAuth((c) => def(c.params).key as Resource, 'create', (auth) => createResource(auth, def(auth.params)));
