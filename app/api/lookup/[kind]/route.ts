import { withAuth } from '@/lib/api/withAuth';
import { jsonWithEtag } from '@/lib/api/http';
import { lookupKind, runLookup } from '@/lib/services/typeahead';
import { getEffectivePerm } from '@/lib/perm/engine';

export const dynamic = 'force-dynamic';

/** Dropdown / typeahead source: /api/lookup/{employees|machines|items|customers|suppliers|vehicles|blocks|sales}?q=…  →  { data: [{ id, label, hint? }] }, max 20. */
export const GET = withAuth(
  async (c) => {
    const k = c.params.kind;
    if (k === 'machines' && c.user) {
      const perm = await getEffectivePerm(c.user);
      if (
        perm.can('dailyreports', 'create') ||
        perm.can('dailyreports', 'view') ||
        perm.can('machineentries', 'create') ||
        perm.can('machineentries', 'view')
      ) {
        return 'dailyreports';
      }
    }
    return lookupKind(k).resource;
  },
  'view',
  async (auth) => {
    const kind = lookupKind(auth.params.kind);
    // For machines dropdown, show all active factory machines so operators/workers can pick them
    const filter = auth.params.kind === 'machines' ? {} : await auth.filter('view');
    const out = await runLookup(kind, auth.query, filter);
    return jsonWithEtag(auth.req, out, { maxAge: 15 });
  }
);
