 
import 'regenerator-runtime/runtime'; // @pdf-lib/fontkit's Indic (Devanagari) shaper needs this global
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Small server-side PDF toolkit (A4). Text is set in Noto Sans Devanagari (Latin, ₹ and Devanagari with proper conjunct shaping),
 * so English, Hindi and rupee amounts all come out right. Characters the font does not have are dropped instead of failing.
 */
const FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'assets', 'fonts');
let fontBytes: Promise<[Buffer, Buffer]> | null = null;
const loadFonts = () => (fontBytes ??= Promise.all([fs.readFile(path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf')), fs.readFile(path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf'))]));

export type Align = 'left' | 'right' | 'center';
export type Col = { head: string; w: number; align?: Align };
const W = 595.28, H = 841.89, M = 36;
const INK = rgb(0.07, 0.07, 0.07), GREY = rgb(0.4, 0.4, 0.4), LINE = rgb(0.75, 0.75, 0.75), FILL = rgb(0.94, 0.94, 0.94);

export class PdfBuilder {
  readonly contentWidth = W - 2 * M;
  y = H - M;
  private page!: PDFPage;
  private chars!: { regular: Set<number>; bold: Set<number> };
  private constructor(private pdf: PDFDocument, private regular: PDFFont, private bold: PDFFont) {}

  static async create(title: string) {
    const [r, b] = await loadFonts();
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.setTitle(title);
    pdf.setProducer('Vipul Stone Suppliers ERP');
    const doc = new PdfBuilder(pdf, await pdf.embedFont(r, { subset: true }), await pdf.embedFont(b, { subset: true }));
    doc.chars = { regular: new Set(doc.regular.getCharacterSet()), bold: new Set(doc.bold.getCharacterSet()) };
    doc.newPage();
    return doc;
  }

  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.y = H - M;
  }
  ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }

  private clean(s: unknown, bold: boolean) {
    const set = bold ? this.chars.bold : this.chars.regular;
    let out = '';
    for (const ch of String(s ?? '').replace(/\s+/g, ' ')) if (ch === ' ' || set.has(ch.codePointAt(0)!)) out += ch;
    return out;
  }
  measure(s: string, size: number, bold = false) {
    const t = this.clean(s, bold);
    return t ? (bold ? this.bold : this.regular).widthOfTextAtSize(t, size) : 0;
  }
  /** Break into lines no wider than maxW (words; a single word wider than the line is cut by characters). */
  wrap(s: unknown, size: number, maxW: number, bold = false): string[] {
    const text = this.clean(s, bold).trim();
    if (!text) return [''];
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const tryLine = cur ? `${cur} ${word}` : word;
      if (this.measure(tryLine, size, bold) <= maxW) { cur = tryLine; continue; }
      if (cur) lines.push(cur);
      cur = '';
      let piece = '';
      for (const ch of word) {
        if (this.measure(piece + ch, size, bold) > maxW && piece) { lines.push(piece); piece = ''; }
        piece += ch;
      }
      cur = piece;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** Draw one line at an absolute position. */
  private put(s: string, x: number, y: number, size: number, bold: boolean, align: Align, boxW: number, color = INK) {
    const t = this.clean(s, bold);
    if (!t) return;
    const w = this.measure(t, size, bold);
    const px = align === 'right' ? x + boxW - w : align === 'center' ? x + (boxW - w) / 2 : x;
    this.page.drawText(t, { x: px, y, size, font: bold ? this.bold : this.regular, color });
  }

  /** A wrapped paragraph at the cursor; moves the cursor down. Returns its height. */
  para(s: unknown, o: { x?: number; w?: number; size?: number; bold?: boolean; align?: Align; color?: 'grey' | 'ink'; gap?: number } = {}) {
    const size = o.size ?? 9, x = o.x ?? M, w = o.w ?? this.contentWidth, lead = size * 1.35;
    const lines = this.wrap(s, size, w, !!o.bold);
    for (const line of lines) {
      this.ensure(lead);
      this.y -= lead;
      this.put(line, x, this.y + size * 0.25, size, !!o.bold, o.align ?? 'left', w, o.color === 'grey' ? GREY : INK);
    }
    this.y -= o.gap ?? 0;
    return lines.length * lead + (o.gap ?? 0);
  }
  space(h: number) { this.y -= h; }
  rule(thick = 0.8) {
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: thick, color: INK });
    this.y -= 6;
  }

  /** Two blocks side by side (left text lines, right text lines), the cursor ends below the taller one. */
  twoColumns(left: { text: string; bold?: boolean; size?: number; color?: 'grey' }[], right: { text: string; bold?: boolean; size?: number; color?: 'grey' }[], leftW = this.contentWidth * 0.55) {
    const start = this.y;
    const rightW = this.contentWidth - leftW - 12;
    for (const l of left) this.para(l.text, { w: leftW, size: l.size, bold: l.bold, color: l.color });
    const afterLeft = this.y;
    this.y = start;
    for (const r of right) this.para(r.text, { x: M + leftW + 12, w: rightW, size: r.size, bold: r.bold, align: 'right', color: r.color });
    this.y = Math.min(afterLeft, this.y);
  }

  /** Label : value rows in two columns. */
  keyValues(pairs: [string, unknown][], o: { labelW?: number; size?: number } = {}) {
    const size = o.size ?? 9, half = this.contentWidth / 2, labelW = o.labelW ?? 78;
    for (let i = 0; i < pairs.length; i += 2) {
      const row = pairs.slice(i, i + 2).map(([k, v], j) => {
        const x = M + j * half;
        return { x, k, lines: this.wrap(String(v ?? '') || '—', size, half - labelW - 8, true) };
      });
      const lines = Math.max(...row.map((r) => r.lines.length));
      const lead = size * 1.4;
      this.ensure(lines * lead + 2);
      for (const r of row) {
        r.lines.forEach((ln, n) => {
          if (n === 0) this.put(r.k, r.x, this.y - lead + size * 0.25, size, false, 'left', labelW, GREY);
          this.put(ln, r.x + labelW, this.y - (n + 1) * lead + size * 0.25, size, true, 'left', half - labelW - 8);
        });
      }
      this.y -= lines * lead + 2;
    }
  }

  /** Bordered table with a shaded header that repeats on every page. */
  table(cols: Col[], rows: (string | number)[][], o: { size?: number; boldLast?: boolean } = {}) {
    const size = o.size ?? 8.5, pad = 3, lead = size * 1.3;
    const total = cols.reduce((n, c) => n + c.w, 0);
    const scale = this.contentWidth / total;
    const widths = cols.map((c) => c.w * scale);
    const draw = (cells: string[], head: boolean, last: boolean) => {
      const wrapped = cells.map((c, i) => this.wrap(c, size, widths[i] - 2 * pad, head || (last && !!o.boldLast)));
      const h = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * pad;
      this.ensure(h);
      let x = M;
      const top = this.y;
      cols.forEach((c, i) => {
        this.page.drawRectangle({ x, y: top - h, width: widths[i], height: h, borderColor: LINE, borderWidth: 0.6, ...(head ? { color: FILL } : {}) });
        wrapped[i].forEach((ln, n) => this.put(ln, x + pad, top - pad - (n + 1) * lead + size * 0.3, size, head || (last && !!o.boldLast), c.align ?? 'left', widths[i] - 2 * pad));
        x += widths[i];
      });
      this.y -= h;
    };
    const drawHead = () => draw(cols.map((c) => c.head), true, false);
    drawHead();
    rows.forEach((r, k) => {
      const before = this.page;
      const need = Math.max(...r.map((c, i) => this.wrap(c, size, widths[i] - 2 * pad).length)) * lead + 2 * pad;
      if (this.y - need < M) { this.newPage(); drawHead(); }
      void before;
      draw(r.map((c) => String(c ?? '')), false, k === rows.length - 1);
    });
  }

  /** Right-aligned label / amount lines (totals). */
  totals(rows: [string, string, boolean?][], o: { w?: number } = {}) {
    const w = o.w ?? 220, x = W - M - w;
    for (const [k, v, strong] of rows) {
      const size = strong ? 10.5 : 9, lead = size * 1.5;
      this.ensure(lead + 2);
      if (strong) this.page.drawLine({ start: { x, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.8, color: INK });
      this.y -= lead;
      this.put(k, x, this.y + size * 0.3, size, !!strong, 'left', w);
      this.put(v, x, this.y + size * 0.3, size, !!strong, 'right', w);
    }
  }

  /** Signature lines across the page. */
  signatures(labels: string[]) {
    this.ensure(60);
    this.y -= 40;
    const gap = 16, w = (this.contentWidth - gap * (labels.length - 1)) / labels.length;
    labels.forEach((l, i) => {
      const x = M + i * (w + gap);
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w, y: this.y }, thickness: 0.6, color: INK });
      this.put(l, x, this.y - 11, 8, false, 'center', w, GREY);
    });
    this.y -= 18;
  }

  async bytes() {
    return this.pdf.save();
  }
}

/** Standard response for a generated PDF. */
export function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
