// Finds every piece of English screen text in the source, so that each one can be given a Hindi translation (lib/hi.js).
// Used by tests/unit/i18n-coverage.test.ts: a new button, label or message with no Hindi fails the test.
//   node scripts/extract-phrases.mjs          -> prints the phrases that have no Hindi yet
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ATTRS = new Set(['label', 'title', 'placeholder', 'emptyText', 'empty', 'subtitle', 'text', 'aria-label', 'hint', 'addLabel', 'okLabel', 'cancelLabel', 'noun', 'help', 'summary', 'formTitle', 'checkLabel', 'buttonLabel', 'sub']);
const PROPS = new Set(['label', 'title', 'empty', 'placeholder', 'hint', 'section', 'checkLabel', 'buttonLabel', 'addLabel', 'emptyText', 'text', 'sub']);
const CALLS = /^(toast(\.success|\.error)?|confirmDialog|promptDialog|tr|tx|trNow)$/;
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&#x27;': "'", '&#39;': "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#x27|#39);/g, (m) => ENT[m] ?? m);
const letters = (s) => /[A-Za-z]{2}/.test(s);

function listFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (!['api', 'node_modules', 'login'].includes(f.name)) walk(p); } else if (/\.(js|tsx)$/.test(f.name) && !/components[\\/]T\.js$/.test(p)) out.push(p);
    }
  };
  for (const r of ['app', 'components']) walk(path.join(root, r));
  out.push(path.join(root, 'lib', 'config.js'));
  return out;
}

const needsTr = (t) => !/\b(t|tx|tr|trNow|h)\(/.test(t.getText()) && [t.head.text, ...t.templateSpans.map((sp) => sp.literal.text)].some((x) => /[A-Za-z]{2}/.test(x));
/** Every plain string a label can end up showing: 'a', cond ? 'a' : 'b', x || 'a'. Templates with ${values} are collected separately. */
function exprStrings(x, out, templates) {
  if (!x) return;
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) out.push(x.text);
  else if (ts.isParenthesizedExpression(x)) exprStrings(x.expression, out, templates);
  else if (ts.isConditionalExpression(x)) { exprStrings(x.whenTrue, out, templates); exprStrings(x.whenFalse, out, templates); }
  else if (ts.isBinaryExpression(x) && ['||', '??', '&&'].includes(x.operatorToken.getText())) { exprStrings(x.left, out, templates); exprStrings(x.right, out, templates); }
  else if (ts.isTemplateExpression(x) && templates) templates.push(x);
}

// lists of words that end up in dropdowns, tabs and badges: every string in them is screen text
const WORD_LISTS = new Set(['MODELS', 'PROBLEMS', 'CATS', 'STEPS', 'MONTHS', 'LEVELS', 'UNITS', 'KINDS', 'EXP', 'REQUIRED_DOCS', 'JOBS', 'EXPENSE_HEADS', 'MACHINE_TYPES', 'CUTTING_TYPES', 'STAGES', 'STATES', 'ACTIONS', 'CAT']);
const isWord = (t) => /^[A-Za-z][A-Za-z0-9 &/+-–·().,']*$/.test(t) && !/^[a-z]+([A-Z][a-z]*)+$/.test(t) && !t.includes('_') && !/^bg-|^text-|^border-/.test(t);

/**
 * @param {string} [root]
 * @param {string[] | null} [templatesOut] filled with labels glued together from English text and values
 * @returns {Map<string, string>} phrase -> the first file it appears in
 */
export function extractPhrases(root = '.', templatesOut = null) {
  const found = new Map(); // phrase -> first file
  const add = (phrase, file) => { const t = phrase.replace(/\s+/g, ' ').trim(); if (t && letters(t) && !found.has(t)) found.set(t, file); };
  for (const file of listFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    const str = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
    (function visit(n) {
      // text that is the only content of an element: <T>Save</T>, <b>Total</b>
      if (ts.isJsxElement(n)) {
        const kids = n.children.filter((c) => !(ts.isJsxText(c) && !c.getText().trim()));
        if (kids.length === 1 && ts.isJsxText(kids[0])) add(decode(kids[0].getText()), file);
        // <T>{'text'}</T> style is not used; a string expression child counts too
        // <T>{'text'}</T> and <T>{cond ? 'a' : 'b'}</T>: every string literal inside the expression is screen text
        if (kids.length === 1 && ts.isJsxExpression(kids[0]) && kids[0].expression && n.openingElement.tagName.getText() === 'T') (function lits(x) { if (str(x)) add(str(x), file); else ts.forEachChild(x, lits); })(kids[0].expression);
      }
      if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText()) && n.initializer) {
        const lits = []; const tpls = [];
        if (ts.isStringLiteral(n.initializer)) lits.push(n.initializer.text); else if (ts.isJsxExpression(n.initializer)) exprStrings(n.initializer.expression, lits, tpls);
        lits.forEach((v) => add(v, file));
        for (const t of tpls) if (templatesOut && needsTr(t)) templatesOut.push(file.split(path.sep).join('/') + ': ' + t.getText().slice(0, 100));
      }
      if (ts.isCallExpression(n) && CALLS.test(n.expression.getText()) && n.arguments[0] && str(n.arguments[0])) add(str(n.arguments[0]), file);
      if (ts.isCallExpression(n) && n.expression.getText() === 'confirmDialog' && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) for (const p of n.arguments[1].properties) if (ts.isPropertyAssignment(p) && ['okLabel', 'cancelLabel'].includes(p.name.getText()) && str(p.initializer)) add(str(p.initializer), file);
      if (ts.isPropertyAssignment(n) && PROPS.has(n.name.getText())) { const lits = []; const tpls = []; exprStrings(n.initializer, lits, tpls); lits.forEach((v) => add(v, file)); for (const t of tpls) if (templatesOut && needsTr(t)) templatesOut.push(file.split(path.sep).join('/') + ': ' + t.getText().slice(0, 100)); }
      // option lists: options: ['Normal', 'High']
      if (ts.isPropertyAssignment(n) && n.name.getText() === 'options' && ts.isArrayLiteralExpression(n.initializer)) for (const e of n.initializer.elements) if (str(e)) add(str(e), file);
      if (ts.isVariableDeclaration(n) && n.initializer && WORD_LISTS.has(n.name.getText()) && ts.isArrayLiteralExpression(n.initializer)) {
        (function lits(x, key) { if (str(x)) { if (isWord(str(x)) && (key === undefined || ['label', 'name'].includes(key))) add(str(x), file); } else if (ts.isPropertyAssignment(x)) lits(x.initializer, x.name.getText()); else if (ts.isArrayLiteralExpression(x) && ts.isArrayLiteralExpression(x.parent) && x.elements.length > 1 && x.elements.every((e) => str(e))) lits(x.elements[x.elements.length - 1], key); else ts.forEachChild(x, (c) => lits(c, key)); })(n.initializer);
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  return found;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/extract-phrases.mjs')) {
  const { HI } = await import('../lib/hi/index.js');
  const all = extractPhrases('.');
  const missing = [...all.keys()].filter((p) => !(p in HI)).sort();
  console.log(`${all.size} phrases in the screens, ${missing.length} without Hindi`);
  const tp = []; extractPhrases('.', tp); console.log(tp.length + ' labels built from a template with values (use tr("... {n} ...", {n}) instead):'); console.log(tp.join('\n'));
  if (process.argv.includes('--json')) fs.writeFileSync('scripts/_missing.json', JSON.stringify(missing, null, 1));
  else console.log(missing.slice(0, 400).join('\n'));
}
