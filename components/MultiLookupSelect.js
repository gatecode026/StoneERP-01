'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { ChevronDown, X, Search, Check } from 'lucide-react';
import { api } from '@/lib/client';
import { toQuery } from '@/lib/usePaged';
import { cx } from '@/components/ui';

// In-memory client cache for dropdown choices: instant load, 0ms latency on repeated opens
const lookupClientCache = new Map();

/**
 * MultiLookupSelect:
 * Multi-select dropdown with checkboxes for selecting one or more records (e.g. multiple supervisors for a task).
 * Displays selected items as chips with remove buttons, live filtering, and "Select All" / "Clear All" actions.
 */
export default function MultiLookupSelect({
  id,
  kind,
  value = '',
  valueLabel = '',
  onChange,
  query = {},
  by,
  placeholder = 'Select…',
  emptyText = 'No items found',
  disabled = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);
  const searchInputRef = useRef(null);

  // Parse currently selected IDs into an array
  const selectedIds = useMemo(() => {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }, [value]);

  // Selected item cache (id -> { id, label, hint }) to preserve known labels
  const [selectedMap, setSelectedMap] = useState(() => {
    const map = new Map();
    if (valueLabel && selectedIds.length) {
      const labels = String(valueLabel).split(',').map((s) => s.trim());
      selectedIds.forEach((sid, idx) => {
        map.set(sid, { id: sid, label: labels[idx] || sid, hint: sid });
      });
    }
    return map;
  });

  // Sync valueLabel into selectedMap when props change
  useEffect(() => {
    if (valueLabel && selectedIds.length) {
      const labels = String(valueLabel).split(',').map((s) => s.trim());
      setSelectedMap((prev) => {
        let changed = false;
        const next = new Map(prev);
        selectedIds.forEach((sid, idx) => {
          if (!next.has(sid) || next.get(sid)?.label === sid) {
            next.set(sid, { id: sid, label: labels[idx] || sid, hint: sid });
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }
  }, [valueLabel, selectedIds]);

  const qkey = JSON.stringify(query);

  // Load items from /api/lookup/<kind>
  useEffect(() => {
    const queryParams = { ...JSON.parse(qkey), by };
    const cacheKey = `list:${kind}:${JSON.stringify(queryParams)}`;

    if (lookupClientCache.has(cacheKey)) {
      const cached = lookupClientCache.get(cacheKey);
      setItems(cached);
      // Populate selectedMap with any matching items
      setSelectedMap((prev) => {
        const next = new Map(prev);
        for (const it of cached) {
          if (selectedIds.includes(String(it.id))) {
            next.set(String(it.id), it);
          }
        }
        return next;
      });
      return;
    }

    let live = true;
    setBusy(true);
    api(`/api/lookup/${kind}?${toQuery(queryParams)}`)
      .then((r) => {
        const rows = r.data || [];
        if (rows.length) lookupClientCache.set(cacheKey, rows);
        if (live) {
          setItems(rows);
          setSelectedMap((prev) => {
            const next = new Map(prev);
            for (const it of rows) {
              if (selectedIds.includes(String(it.id))) {
                next.set(String(it.id), it);
              }
            }
            return next;
          });
        }
      })
      .catch(() => live && setItems([]))
      .finally(() => live && setBusy(false));

    return () => {
      live = false;
    };
  }, [kind, by, qkey, selectedIds]);

  // Resolve labels for any selected IDs that aren't yet known in selectedMap
  useEffect(() => {
    const missing = selectedIds.filter((sid) => !selectedMap.has(sid));
    if (!missing.length) return;

    let live = true;
    api(`/api/lookup/${kind}?${toQuery({ ids: missing.join(','), by })}`)
      .then((r) => {
        if (!live || !r.data) return;
        setSelectedMap((prev) => {
          const next = new Map(prev);
          for (const it of r.data) {
            next.set(String(it.id), it);
          }
          return next;
        });
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [kind, by, selectedIds, selectedMap]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtered items based on search input
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (it) =>
        it.label?.toLowerCase().includes(q) ||
        it.hint?.toLowerCase().includes(q) ||
        String(it.id).toLowerCase().includes(q)
    );
  }, [items, search]);

  const toggleItem = (it) => {
    const sid = String(it.id);
    const isChecked = selectedIds.includes(sid);
    let nextIds;
    if (isChecked) {
      nextIds = selectedIds.filter((x) => x !== sid);
    } else {
      nextIds = [...selectedIds, sid];
    }

    const nextMap = new Map(selectedMap);
    if (!isChecked) {
      nextMap.set(sid, it);
    }
    setSelectedMap(nextMap);

    const chosenItems = nextIds.map((id) => nextMap.get(id) || { id, label: id, hint: id });
    onChange?.(chosenItems);
  };

  const removeItem = (sid) => {
    const nextIds = selectedIds.filter((x) => x !== String(sid));
    const chosenItems = nextIds.map((id) => selectedMap.get(id) || { id, label: id, hint: id });
    onChange?.(chosenItems);
  };

  const handleSelectAll = () => {
    const nextMap = new Map(selectedMap);
    const allFilteredIds = filteredItems.map((it) => {
      const sid = String(it.id);
      nextMap.set(sid, it);
      return sid;
    });

    const union = [...new Set([...selectedIds, ...allFilteredIds])];
    setSelectedMap(nextMap);
    const chosenItems = union.map((id) => nextMap.get(id) || { id, label: id, hint: id });
    onChange?.(chosenItems);
  };

  const handleClearAll = () => {
    onChange?.([]);
  };

  const selectedItems = useMemo(() => {
    return selectedIds.map((id) => selectedMap.get(id) || { id, label: id, hint: id });
  }, [selectedIds, selectedMap]);

  return (
    <div ref={boxRef} className={cx('relative', className)}>
      {/* Trigger Box */}
      <div
        id={id}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (!disabled) setOpen(true);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cx(
          'min-h-[38px] px-3 py-1.5 rounded-none border border-sand-300 bg-white transition cursor-pointer flex flex-wrap items-center gap-1.5 select-none focus:outline-none focus:ring-1 focus:ring-terra focus:border-terra',
          open && 'border-terra',
          disabled && 'opacity-60 cursor-not-allowed bg-sand-50'
        )}
      >
        {selectedIds.length === 0 ? (
          <span className="text-sm text-char-400 py-1">{placeholder}</span>
        ) : (
          selectedItems.map((it) => (
            <span
              key={it.id}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-none bg-sand-100 border border-sand-300 text-char text-xs font-semibold animate-in fade-in duration-100"
            >
              <span className="truncate max-w-[200px]">{it.label}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeItem(it.id);
                  }}
                  className="p-0.5 rounded-none hover:bg-sand-200 text-char-500 hover:text-terra transition cursor-pointer"
                  aria-label="Remove"
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))
        )}

        <div className="ml-auto flex items-center gap-1 pl-1 text-char-400 shrink-0">
          {selectedIds.length > 0 && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClearAll();
              }}
              className="p-1 hover:text-char-700 rounded cursor-pointer"
              title="Clear all"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={16}
            className={cx('transition-transform duration-150', open && 'rotate-180')}
          />
        </div>
      </div>

      {/* Dropdown Menu */}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-none bg-white shadow-xl border border-sand-300 overflow-hidden animate-in fade-in duration-100">
          {/* Search Bar */}
          <div className="p-2 border-b border-sand-200 bg-sand-50/50">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-char-400"
              />
              <input
                ref={searchInputRef}
                type="text"
                className="input !h-8 !py-1 !pl-8 !pr-2 !text-xs !bg-white"
                placeholder={placeholder.startsWith('Select ') ? `Filter ${placeholder.slice(7).replace(/[….]+$/, '')}…` : 'Filter choices…'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
            </div>
          </div>

          {/* Quick Actions (Select All / Clear All) */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-sand-100/60 text-xs border-b border-sand-200">
            <span className="font-semibold text-char-600">
              {selectedIds.length} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-terra hover:underline font-semibold cursor-pointer"
                onClick={handleSelectAll}
              >
                Select all
              </button>
              <span className="text-sand-300">|</span>
              <button
                type="button"
                className="text-char-500 hover:underline cursor-pointer"
                onClick={handleClearAll}
              >
                Clear all
              </button>
            </div>
          </div>

          {/* Checkbox Options List */}
          <div className="min-h-[170px] max-h-64 overflow-y-auto divide-y divide-sand-100">
            {busy && items.length === 0 ? (
              <div className="p-4 text-xs text-char-400 text-center">Loading…</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-xs text-char-400 text-center">{emptyText}</div>
            ) : (
              filteredItems.map((it) => {
                const isSelected = selectedIds.includes(String(it.id));
                return (
                  <div
                    key={it.id}
                    onClick={() => toggleItem(it)}
                    className={cx(
                      'flex items-center gap-3 px-3.5 py-2.5 cursor-pointer transition select-none text-left',
                      isSelected
                        ? 'bg-terra-50/80 text-terra-950 font-semibold'
                        : 'hover:bg-sand-50 text-char-800'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}} // handled by parent div click
                      className="w-4 h-4 rounded-none text-terra accent-terra cursor-pointer shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{it.label}</div>
                    </div>
                    {it.hint && (
                      <span className="text-xs font-mono text-char-400 font-semibold shrink-0">
                        {it.hint}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Bar */}
          <div className="p-2 border-t border-sand-200 bg-sand-50/50 flex justify-between items-center">
            <span className="text-xs text-char-500">
              {selectedIds.length === 0
                ? 'Check items to select'
                : `${selectedIds.length} item(s) selected`}
            </span>
            <button
              type="button"
              className="btn-primary !text-xs !py-1 !px-3 font-semibold shadow-xs"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
