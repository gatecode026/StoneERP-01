import { api } from '@/lib/client';
import { confirmDialog } from '@/components/Dialogs';

/**
 * Call the server; when it answers "are you sure?" (a warning the person may accept: not enough stock, no e-way bill, an unknown
 * bill number …) show the question and, on yes, send the same request again with `_confirmed`. A "no" throws a cancelled error that screens ignore.
 */
export async function apiAsk(path, { method = 'POST', body = {} } = {}) {
  try {
    return await api(path, { method, body });
  } catch (e) {
    if (e.status === 409 && e.data?.confirmable) {
      if (await confirmDialog(e.message)) return api(path, { method, body: { ...body, _confirmed: true } });
      const err = new Error('Cancelled');
      err.data = { cancelled: true };
      throw err;
    }
    throw e;
  }
}
