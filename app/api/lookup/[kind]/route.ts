import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { lookupKind, runLookup } from '@/lib/services/typeahead';
import { getEffectivePerm } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';

/** Dropdown / typeahead source: /api/lookup/{employees|machines|items|customers|suppliers|vehicles|blocks|sales}?q=…  →  { data: [{ id, label, hint? }] }, max 20. */
export const GET = withAuth(
  async (c) => {
    const k = c.params.kind;
    if (['machines', 'employees'].includes(k) && c.user) {
      const perm = await getEffectivePerm(c.user);
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
        perm.can('attendance', 'create') ||
        perm.can('dashboard', 'view')
      ) {
        return 'dashboard';
      }
    }
    return lookupKind(k).resource;
  },
  'view',
  async (auth) => {
    const kind = lookupKind(auth.params.kind);
    // For dropdown pickers (machines, employees, items, vehicles, etc.), show all active master records across the plant
    // so any authorized user can assign/pick supervisors, operators, drivers, machines, etc.
    const filter = ['machines', 'employees', 'items', 'vehicles', 'suppliers', 'customers'].includes(auth.params.kind)
      ? {}
      : await auth.filter('view');
    const out = await runLookup(kind, auth.query, filter);
    return jsonWithEtag(auth.req, out, { maxAge: 15 });
  }
);
