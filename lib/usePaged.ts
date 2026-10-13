'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Build "?a=1&b=2" from an object, skipping empty values. */
export function toQuery(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  return p.toString();
}

export type PagedList = {
  rows: any[];
  total: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: any;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
  /** everything else the first page of the endpoint returned (e.g. exact counts for a sheet) */
  meta: Record<string, any>;
};

/**
 * One page at a time from a standard list endpoint ({data, nextCursor, total?}). The server does the searching, filtering and
 * sorting; the browser only appends the next page when asked. Changing `params` starts again from page one, and a slow answer
 * for old params can never overwrite a newer one.
 */
export function usePagedList(path: string | null, params: Record<string, unknown> = {}, opts: { limit?: number; count?: boolean } = {}): PagedList {
  const { limit = 25, count = true } = opts;
  const qs = toQuery({ ...params, limit });
  const key = `${path}?${qs}`;
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<any>(null);
  const [meta, setMeta] = useState<Record<string, any>>({});
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) { setRows([]); setCursor(null); setTotal(null); setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await api(`${path}?${qs}${count ? '&count=1' : ''}`);
      if (mine !== seq.current) return;
      setRows(r.data ?? []); setCursor(r.nextCursor ?? null); setTotal(r.total ?? null); setError(null); { const { data: _d, nextCursor: _n, ...rest } = r; void _d; void _n; setMeta(rest); }
    } catch (e) {
      if (mine === seq.current) setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path, qs, count]);

  useEffect(() => { void load(); }, [load, key]);

  const loadMore = useCallback(async () => {
    if (!path || !cursor || loadingMore) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const r = await api(`${path}?${qs}&cursor=${encodeURIComponent(cursor)}`);
      if (mine !== seq.current) return;
      setRows((x) => [...x, ...(r.data ?? [])]); setCursor(r.nextCursor ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  }, [path, qs, cursor, loadingMore]);

  return { rows, total, loading, loadingMore, error, hasMore: !!cursor, loadMore, reload: load, meta };
}

/** A list shown as numbered pages (Prev / 1 2 3 / Next): the server returns page N and the exact total; changing the search or filters goes back to page 1. */
export function useNumberedList(path: string | null, params: Record<string, unknown> = {}, opts: { size?: number } = {}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(opts.size ?? 25);
  const narrowing = JSON.stringify([path, params]);
  useEffect(() => { setPage(1); }, [narrowing, size]);
  const list = usePagedList(path, { ...params, page }, { limit: size });
  return { ...list, page, setPage, size, setSize };
}
