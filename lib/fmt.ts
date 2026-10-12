const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const fmtInr = (n: number | string | null | undefined) => '₹' + nf.format(Math.round(Number(n) || 0));
