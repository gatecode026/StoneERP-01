import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { lookupKind, runLookup } from '@/lib/services/typeahead';
import { getEffectivePerm } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';

/** Dropdown / typeahead source: /api/lookup/{employees|machines|items|customers|suppliers|vehicles|blocks|sales}?q=…  →  { data: [{ id, label, hint? }] }, max 20. */
export const GET = withAuth(
  async (c) => {
    const k = c.params.kind;
    const res = lookupKind(k).resource;
    if (c.user) {
      const perm = await getEffectivePerm(c.user);
      if (perm.can(res, 'view')) return res;
      if (['machines', 'employees'].includes(k)) {
        if (
          perm.can('projects', 'view') ||
          perm.can('projects', 'create') ||
          perm.can('projects', 'edit') ||
          perm.can('dailyreports', 'create') ||
          perm.can('dailyreports', 'view') ||
          perm.can('machineentries', 'create') ||
          perm.can('machineentries', 'view') ||
          perm.can('tasks', 'view') ||
          perm.can('tasks', 'create') ||
          perm.can('attendance', 'view') ||
          perm.can('attendance', 'create')
        ) {
          return 'dashboard';
        }
      }
    }
    return res;
  },
  'view',
  async (auth) => {
    const kind = lookupKind(auth.params.kind);
    const hasJobOrRole = auth.query.has('job') || auth.query.has('loginRole') || auth.query.get('all') === '1';
    const filter = ['machines', 'items', 'vehicles', 'suppliers', 'customers'].includes(auth.params.kind) ||
      (auth.params.kind === 'employees' && hasJobOrRole)
      ? {}
      : await auth.filter('view');
    const out = await runLookup(kind, auth.query, filter);
    return jsonWithEtag(auth.req, out, { maxAge: 15 });
  }
);
