'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Database, Download, FileSpreadsheet, FileText, Archive,
  FolderKanban, ListChecks, Users, ClipboardList, CalendarCheck, ShieldCheck,
  Cog, Hammer, Boxes, Wrench, Package, ShoppingCart, Receipt, Truck,
  UserCheck, Building2, MessageSquareWarning, IndianRupee, BookOpen,
  CheckCircle2, Layers, HardDrive, Search, RefreshCw, FileArchive
} from 'lucide-react';
import { useApp, useFetch, useTx } from '@/components/Providers';
import { RoleGuard, PageHeader, StatCard, Badge, SkeletonList, Empty } from '@/components/ui';
import T from '@/components/T';

const ICONS = {
  FolderKanban,
  ListChecks,
  Users,
  ClipboardList,
  CalendarCheck,
  ShieldCheck,
  Cog,
  Hammer,
  Boxes,
  Wrench,
  Package,
  ShoppingCart,
  Receipt,
  Truck,
  UserCheck,
  Building2,
  MessageSquareWarning,
  IndianRupee,
  BookOpen,
  FileText,
  Database,
  Archive,
};

const CATEGORIES = [
  { key: 'all', label: 'All Sections' },
  { key: 'People & Attendance', label: 'People & Attendance' },
  { key: 'Operations & Production', label: 'Operations & Production' },
  { key: 'Stock & Purchasing', label: 'Stock & Purchasing' },
  { key: 'Sales & Dispatch', label: 'Sales & Dispatch' },
  { key: 'Finance & Accounts', label: 'Finance & Accounts' },
];

function BackupsScreen() {
  const tx = useTx();
  const { data, loading, error, reload } = useFetch('/api/backups/sections');
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [downloadingZip, setDownloadingZip] = useState(false);

  const sections = data?.sections || [];
  const totalRecords = data?.totalRecords ?? 0;

  const filteredSections = useMemo(() => {
    return sections.filter((sec) => {
      const matchesCat = selectedCat === 'all' || sec.group === selectedCat;
      if (!matchesCat) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        sec.name.toLowerCase().includes(q) ||
        sec.id.toLowerCase().includes(q) ||
        (sec.description && sec.description.toLowerCase().includes(q)) ||
        (sec.group && sec.group.toLowerCase().includes(q))
      );
    });
  }, [sections, selectedCat, search]);

  const categoryCounts = useMemo(() => {
    const map = { all: sections.length };
    for (const sec of sections) {
      map[sec.group] = (map[sec.group] || 0) + 1;
    }
    return map;
  }, [sections]);

  const handleZipDownload = (format) => {
    setDownloadingZip(true);
    setTimeout(() => setDownloadingZip(false), 2500);
  };

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Backups & Data Export"
        subtitle="Export individual ERP sections in Excel, CSV, or PDF, or download all section files in a complete ZIP archive."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={reload}
              className="btn-outline btn-sm"
              title="Refresh counts"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <T>Refresh</T>
            </button>
            <a
              href="/api/backups/download-all?format=all"
              download
              onClick={() => handleZipDownload('all')}
              className="btn-primary btn-sm flex items-center gap-1.5"
            >
              <Archive size={15} />
              <span><T>Download All (ZIP)</T></span>
            </a>
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Layers}
          tone="terra"
          label="Total Sections"
          value={sections.length || '…'}
          sub="Configured modules"
        />
        <StatCard
          icon={Database}
          tone="green"
          label="Total Records"
          value={totalRecords.toLocaleString()}
          sub="Live database records"
        />
        <StatCard
          icon={FileSpreadsheet}
          tone="default"
          label="Supported Formats"
          value="Excel · CSV · PDF"
          sub="Plus Master ZIP bundle"
        />
        <StatCard
          icon={CheckCircle2}
          tone="amber"
          label="Import Format"
          value="100% Compatible"
          sub="Matches bulk import specs"
        />
      </div>

      {/* Master ZIP Download Banner */}
      <div className="card p-5 bg-gradient-to-r from-sand-50 via-white to-sand-50 border-sand-300">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-terra-100 text-terra rounded-none">
                <FileArchive size={20} />
              </span>
              <h2 className="text-base font-bold text-char">
                <T>Download Complete ERP Archive (ZIP)</T>
              </h2>
              <Badge tone="green"><T>Recommended</T></Badge>
            </div>
            <p className="text-xs text-char-600 leading-relaxed">
              <T>Download every section file in a single compressed ZIP archive. Formats exactly mirror StoneERP bulk import specifications so you can inspect, analyze in Excel, or restore data anytime.</T>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href="/api/backups/download-all?format=all"
              download
              onClick={() => handleZipDownload('all')}
              className="btn-primary text-xs py-2 px-3.5 flex items-center gap-2 shadow-sm"
            >
              <Archive size={15} />
              <span><T>All Formats ZIP</T></span>
            </a>
            <a
              href="/api/backups/download-all?format=xlsx"
              download
              onClick={() => handleZipDownload('xlsx')}
              className="btn-outline text-xs py-2 px-3 flex items-center gap-1.5 bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50"
            >
              <FileSpreadsheet size={15} className="text-emerald-700" />
              <span><T>Excel ZIP (.xlsx)</T></span>
            </a>
            <a
              href="/api/backups/download-all?format=csv"
              download
              onClick={() => handleZipDownload('csv')}
              className="btn-outline text-xs py-2 px-3 flex items-center gap-1.5 bg-white text-blue-800 border-blue-300 hover:bg-blue-50"
            >
              <FileText size={15} className="text-blue-700" />
              <span><T>CSV ZIP (.csv)</T></span>
            </a>
            <a
              href="/api/backups/download-all?format=pdf"
              download
              onClick={() => handleZipDownload('pdf')}
              className="btn-outline text-xs py-2 px-3 flex items-center gap-1.5 bg-white text-rose-800 border-rose-300 hover:bg-rose-50"
            >
              <Download size={15} className="text-rose-700" />
              <span><T>PDF ZIP (.pdf)</T></span>
            </a>
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-char-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sections by name or description…"
              className="input pl-9 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-char-400 hover:text-char"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-xs text-char-500 self-center">
            <span className="font-bold text-char">{filteredSections.length}</span> / {sections.length} <T>Sections</T>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.key] ?? 0;
            const active = selectedCat === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setSelectedCat(cat.key)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-none border transition-all duration-100 font-semibold flex items-center gap-1.5 ${
                  active
                    ? 'bg-terra text-white border-terra-600 shadow-none'
                    : 'bg-white text-char-700 border-sand-300 hover:border-terra hover:bg-sand-50'
                }`}
              >
                <span><T>{cat.label}</T></span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-sand-200 text-char-600'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sections List */}
      {loading && !sections.length ? (
        <SkeletonList n={6} className="h-24" />
      ) : error ? (
        <div className="card p-6 text-center text-sm text-red-700 border-red-200 bg-red-50">
          <p><T>Failed to load backup sections.</T></p>
          <p className="text-xs mt-1 text-red-600">{error.message}</p>
          <button onClick={reload} className="btn-outline btn-sm mt-3"><T>Try Again</T></button>
        </div>
      ) : filteredSections.length === 0 ? (
        <Empty text="No backup sections match your search">
          <button onClick={() => { setSearch(''); setSelectedCat('all'); }} className="btn-outline btn-sm">
            <T>Reset Filters</T>
          </button>
        </Empty>
      ) : (
        <div className="space-y-3">
          {filteredSections.map((sec) => {
            const IconComponent = ICONS[sec.icon] || Database;
            return (
              <div
                key={sec.id}
                className="card p-4 hover:border-terra/70 transition-all duration-150 bg-white"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Left: Icon and Details */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-none bg-sand-100 border border-sand-300 text-char-700 flex items-center justify-center shrink-0 mt-0.5">
                      <IconComponent size={20} className="text-terra" />
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-sm text-char leading-snug">
                          <T>{sec.name}</T>
                        </h3>
                        <Badge tone={sec.count > 0 ? 'green' : 'gray'} className="text-[10px]">
                          {sec.count.toLocaleString()} <T>records</T>
                        </Badge>
                        <span className="text-[10px] text-char-400 border border-sand-200 px-1.5 py-0.5 bg-sand-50">
                          {sec.columnsCount} <T>columns</T>
                        </span>
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5">
                          ✓ <T>Import ready</T>
                        </span>
                      </div>

                      <p className="text-xs text-char-500 line-clamp-2 leading-relaxed">
                        <T>{sec.description}</T>
                      </p>

                      {sec.importFormatNote && (
                        <p className="text-[11px] text-char-400 italic">
                          ℹ <T>{sec.importFormatNote}</T>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Download Actions */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-sand-200">
                    <a
                      href={`/api/backups/download?section=${sec.id}&format=xlsx`}
                      download
                      className="btn-outline btn-sm text-emerald-800 bg-emerald-50/60 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400 flex items-center gap-1 px-2.5 py-1.5"
                    >
                      <FileSpreadsheet size={14} className="text-emerald-700" />
                      <span className="font-semibold text-xs"><T>Excel</T></span>
                    </a>

                    <a
                      href={`/api/backups/download?section=${sec.id}&format=csv`}
                      download
                      className="btn-outline btn-sm text-blue-800 bg-blue-50/60 border-blue-300 hover:bg-blue-100 hover:border-blue-400 flex items-center gap-1 px-2.5 py-1.5"
                    >
                      <FileText size={14} className="text-blue-700" />
                      <span className="font-semibold text-xs"><T>CSV</T></span>
                    </a>

                    <a
                      href={`/api/backups/download?section=${sec.id}&format=pdf`}
                      download
                      className="btn-outline btn-sm text-rose-800 bg-rose-50/60 border-rose-300 hover:bg-rose-100 hover:border-rose-400 flex items-center gap-1 px-2.5 py-1.5"
                    >
                      <Download size={14} className="text-rose-700" />
                      <span className="font-semibold text-xs"><T>PDF</T></span>
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Database Raw Dump / Disaster Recovery Notice */}
      <div className="card p-4 bg-sand-50 border-sand-300 mt-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <HardDrive size={16} className="text-char-700" />
              <h4 className="text-xs font-bold text-char uppercase tracking-wider">
                <T>Raw Database Disaster Recovery Dump</T>
              </h4>
            </div>
            <p className="text-xs text-char-600 max-w-2xl">
              <T>In addition to spreadsheet exports, StoneERP automatically saves encrypted full database backups nightly (retained for 14 days). You can download an immediate raw JSON dump (.ndjson.gz) for direct MongoDB restore.</T>
            </p>
          </div>

          <a
            href="/api/backup"
            download
            className="btn-outline btn-sm bg-white shrink-0 flex items-center gap-1.5"
          >
            <Download size={14} />
            <span><T>Download Raw DB Snapshot</T></span>
          </a>
        </div>
      </div>
    </div>
  );
}

export default function BackupsPage() {
  return (
    <RoleGuard perm={['backups', 'settings']}>
      <BackupsScreen />
    </RoleGuard>
  );
}
