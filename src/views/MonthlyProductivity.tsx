import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Download, Activity } from 'lucide-react';

const SHEET_URL = () =>
  `https://docs.google.com/spreadsheets/d/e/2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd/pub?gid=1204079954&output=csv&_=${Date.now()}`;

/* ───────────────────────── CSV Parser ───────────────────────── */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch === '\r') {
        // skip
      } else {
        cell += ch;
      }
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

type ColumnDef = {
  key: string;
  sourceIndex: number;
};

/* ── Sticky config: first 8 columns frozen ── */
const STICKY_COL_COUNT = 8;
const STICKY_WIDTHS: number[] = [60, 160, 80, 80, 80, 80, 80, 80];

/* Header rows — each can display up to 3 lines */
const HEADER_ROW1_HEIGHT = 62;
const HEADER_ROW2_HEIGHT = 62;

const clamp3Style: React.CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  lineHeight: '1.25',
  maxHeight: '3.75em',
};

/* ───────────────────────── Component ───────────────────────── */
export function MonthlyProductivity() {
  const [headerRow1, setHeaderRow1] = useState<string[]>([]);
  const [headerRow2, setHeaderRow2] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(SHEET_URL(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      const parsed = parseCSV(text);

      const nonEmptyRows = parsed.filter((r) =>
        r.some((c) => (c ?? '').trim() !== ''),
      );
      if (nonEmptyRows.length === 0) throw new Error('Sheet is empty');

      const row1 = (nonEmptyRows[0] ?? []).map((c) => (c ?? '').trim());
      const row2 = (nonEmptyRows[1] ?? []).map((c) => (c ?? '').trim());
      const body = nonEmptyRows.slice(2);

      const colCount = Math.max(
        row1.length,
        row2.length,
        ...body.map((r) => r.length),
        0,
      );

      const pad = (arr: string[]) => {
        const out = [...arr];
        while (out.length < colCount) out.push('');
        return out;
      };
      const h1 = pad(row1);
      const h2 = pad(row2);

      const kept: ColumnDef[] = [];
      for (let i = 0; i < colCount; i++) {
        const hasHeader = (h1[i] ?? '') !== '' || (h2[i] ?? '') !== '';
        const hasData = body.some((r) => (r[i] ?? '').trim() !== '');
        if (!hasHeader && !hasData) continue;
        kept.push({ key: `col-${i}`, sourceIndex: i });
      }

      setHeaderRow1(h1);
      setHeaderRow2(h2);
      setDataRows(body);
      setColumns(kept);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return dataRows;
    const q = search.toLowerCase();
    return dataRows.filter((r) =>
      columns.some((c) => (r[c.sourceIndex] ?? '').toLowerCase().includes(q)),
    );
  }, [dataRows, columns, search]);

  const stickyLefts = useMemo(() => {
    const lefts: number[] = [];
    let acc = 0;
    for (let i = 0; i < STICKY_COL_COUNT; i++) {
      lefts.push(acc);
      acc += STICKY_WIDTHS[i] ?? 80;
    }
    return lefts;
  }, []);

  const exportCSV = () => {
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const headerLine1 = columns
      .map((c) => esc(headerRow1[c.sourceIndex] ?? ''))
      .join(',');
    const headerLine2 = columns
      .map((c) => esc(headerRow2[c.sourceIndex] ?? ''))
      .join(',');
    const body = filtered
      .map((r) => columns.map((c) => esc(r[c.sourceIndex] ?? '')).join(','))
      .join('\n');

    const blob = new Blob(
      [headerLine1 + '\n' + headerLine2 + '\n' + body],
      { type: 'text/csv;charset=utf-8;' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monthly-productivity-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* Sticky style for a given column index (only cols 0–7 are frozen) */
  const stickyStyle = (colIdx: number): React.CSSProperties => {
    if (colIdx >= STICKY_COL_COUNT) return {};
    return {
      position: 'sticky',
      left: stickyLefts[colIdx],
      width: STICKY_WIDTHS[colIdx] ?? 80,
      minWidth: STICKY_WIDTHS[colIdx] ?? 80,
      maxWidth: STICKY_WIDTHS[colIdx] ?? 80,
      zIndex: 30,
    };
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-4 lg:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500/30 to-cyan-500/10 text-teal-300">
            <Activity size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-100">
              Monthly Productivity
            </h1>
            <p className="text-[11px] text-slate-500">
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString()}`
                : 'Loading…'}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-48 rounded-lg border border-[var(--line)] bg-[#0f1a2e] py-1.5 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-teal-500/50 focus:outline-none"
            />
          </div>

          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[#0f1a2e] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            <Download size={14} />
            Export
          </button>

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-[#0a1020]">
        {loading && dataRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-teal-400">
            <div className="animate-pulse text-sm">
              Loading Monthly Productivity…
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-rose-400">
            <p className="text-sm font-semibold">Failed to load data</p>
            <p className="text-xs text-slate-500">{error}</p>
            <button
              onClick={fetchData}
              className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 || columns.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No data found
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table
              className="w-full border-separate border-spacing-0 text-xs"
              style={{ minWidth: '100%' }}
            >
              <thead>
                {/* ── Header Row 1 (sticky top, up to 3 lines) ── */}
                <tr>
                  {columns.map((c, i) => {
                    const isSticky = i < STICKY_COL_COUNT;
                    const style = stickyStyle(i);
                    return (
                      <th
                        key={`h1-${c.key}`}
                        className="sticky top-0 border-b border-[var(--line)] bg-[#0f1a2e] px-2 py-1.5 text-left align-top font-semibold text-teal-300"
                        style={{
                          ...style,
                          height: HEADER_ROW1_HEIGHT,
                          minHeight: HEADER_ROW1_HEIGHT,
                          maxHeight: HEADER_ROW1_HEIGHT,
                          top: 0,
                          zIndex: isSticky ? 40 : 20,
                          boxShadow: isSticky
                            ? '1px 0 0 0 rgba(255,255,255,0.06)'
                            : undefined,
                        }}
                      >
                        <div
                          style={clamp3Style}
                          title={headerRow1[c.sourceIndex] ?? ''}
                        >
                          {headerRow1[c.sourceIndex] || '\u00A0'}
                        </div>
                      </th>
                    );
                  })}
                </tr>

                {/* ── Header Row 2 (sticky under row 1, up to 3 lines) ── */}
                <tr>
                  {columns.map((c, i) => {
                    const isSticky = i < STICKY_COL_COUNT;
                    const style = stickyStyle(i);
                    return (
                      <th
                        key={`h2-${c.key}`}
                        className="sticky border-b border-[var(--line)] bg-[#0f1a2e] px-2 py-1.5 text-left align-top font-semibold text-cyan-300/90"
                        style={{
                          ...style,
                          height: HEADER_ROW2_HEIGHT,
                          minHeight: HEADER_ROW2_HEIGHT,
                          maxHeight: HEADER_ROW2_HEIGHT,
                          top: HEADER_ROW1_HEIGHT,
                          zIndex: isSticky ? 40 : 20,
                          boxShadow: isSticky
                            ? '1px 0 0 0 rgba(255,255,255,0.06)'
                            : undefined,
                        }}
                      >
                        <div
                          style={clamp3Style}
                          title={headerRow2[c.sourceIndex] ?? ''}
                        >
                          {headerRow2[c.sourceIndex] || '\u00A0'}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, ri) => {
                  const rowBg = ri % 2 === 0 ? '#0a1020' : '#0b1425';
                  return (
                    <tr key={ri} className="hover:bg-teal-500/5">
                      {columns.map((c, i) => {
                        const isSticky = i < STICKY_COL_COUNT;
                        const style = stickyStyle(i);
                        return (
                          <td
                            key={c.key}
                            className={`border-b border-[var(--line)]/50 px-2 py-2 ${
                              i === 0
                                ? 'font-medium text-teal-200'
                                : 'text-slate-300'
                            }`}
                            style={{
                              ...style,
                              background: isSticky ? rowBg : undefined,
                              boxShadow: isSticky
                                ? '1px 0 0 0 rgba(255,255,255,0.05)'
                                : undefined,
                              wordBreak: 'break-word',
                            }}
                            title={r[c.sourceIndex] ?? ''}
                          >
                            {r[c.sourceIndex] || (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      {!loading && !error && filtered.length > 0 && columns.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            Showing {filtered.length}
            {search && ` of ${dataRows.length}`} rows · {columns.length} columns
          </span>
          <span>Source: Google Sheets</span>
        </div>
      )}
    </div>
  );
}

export default MonthlyProductivity;