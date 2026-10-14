/**
 * The current translator for code that runs in event handlers (toast messages, confirm dialogs) where React hooks are not available.
 * Providers sets it whenever the language changes. Never used while rendering on the server, so it can never mix up two people's languages.
 */
type Tr = (en: string, vars?: Record<string, string | number>) => string;
let current: Tr = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k]))) : en);
export const setTrNow = (f: Tr) => { current = f; };
export const trNow: Tr = (en, vars) => current(en, vars);
