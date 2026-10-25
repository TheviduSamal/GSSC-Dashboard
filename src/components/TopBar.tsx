import { Calendar, Copy, Download, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import { useDashboard } from '@/hooks/useDashboardData';
import { bizDate } from '@/lib/data';
import { StatusPill, useDebounced } from './StatusPill';
import { useEffect } from 'react';

interface TopBarProps {
  onCopyImage?: () => void;
  onDownloadImage?: () => void;
  onExportExcel?: () => void;
  onExportCsv?: () => void;
  showImageExport?: boolean;
  showExcelExport?: boolean;
  showCsvExport?: boolean;
}

export function TopBar({
  onCopyImage,
  onDownloadImage,
  onExportExcel,
  onExportCsv,
  showImageExport,
  showExcelExport,
  showCsvExport,
}: TopBarProps) {
  const { active, status, search, setSearch, dateFilter, setDateFilter, reload } = useDashboard();
  const debounced = useDebounced(search, 200);
  useEffect(() => {
    if (debounced === search) return;
  }, [debounced, search]);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[#070b14]/80 px-4 py-3 backdrop-blur-xl lg:px-6">
      <div className="flex flex-col">
        <h1 className="text-lg font-bold tracking-tight text-slate-100">{active.title}</h1>
        <p className="text-xs text-[var(--muted)]">{active.desc}</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input !pl-9 !py-1.5 text-xs"
            placeholder="Search rows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search rows"
          />
        </div>

        <label className="relative flex items-center">
          <Calendar size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="date"
            className="input !pl-9 !py-1.5 text-xs"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value || bizDate())}
            title="Date filter"
          />
        </label>

        {showImageExport && (
          <>
            <button className="btn !py-1.5 text-xs" onClick={onCopyImage} title="Copy image">
              <Copy size={15} /> Copy
            </button>
            <button className="btn !py-1.5 text-xs" onClick={onDownloadImage} title="Download image">
              <Download size={15} /> PNG
            </button>
          </>
        )}
        {showExcelExport && (
          <button className="btn !py-1.5 text-xs" onClick={onExportExcel} title="Export Excel">
            <FileSpreadsheet size={15} /> Excel
          </button>
        )}
        {showCsvExport && (
          <button className="btn !py-1.5 text-xs" onClick={onExportCsv} title="Export CSV">
            <FileSpreadsheet size={15} /> CSV
          </button>
        )}

        <button className="btn btn-primary !py-1.5 text-xs" onClick={reload}>
          <RefreshCw size={15} /> Reload
        </button>

        <StatusPill text={status.text} kind={status.kind} />
      </div>
    </header>
  );
}
