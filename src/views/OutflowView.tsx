import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/hooks/useDashboardData';
import { TopBar } from '@/components/TopBar';
import { getProjectRegion, getProjectSupervisor } from '@/lib/staff';
import { num, prepareRowForTable, nid } from '@/lib/data';
import { OF_NUM_KEYS, OF_EXTRA, OF_FIXED } from '@/lib/constants';
import type { OfNormRow, RawRow } from '@/lib/types';

const FIREBASE_URL = 'https://sahiru-7a8a4-default-rtdb.firebaseio.com/data.json';

type FbRec = { project: string; task: string; value: number; seconds: number };
type Cell = { gssc: number; gssk: number; cur: number | null; sec: number | null };
type PRow = { key: string; name: string; cells: Record<string, Cell> };
type SortKey = 'name' | 'dur' | 'cur' | 'gssc' | 'gssk' | 'total';
type SortState = { task: string; key: SortKey; dir: 'asc' | 'desc' };

const HEADS: { k: SortKey; l: string }[] = [
  { k: 'gssc', l: 'GSSC Output' },
  { k: 'gssk', l: 'GSSK Output' },
  { k: 'total', l: 'Total Output' },
];

const nk = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ofFmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString();

const parseDuration = (s: unknown) => {
  const str = String(s ?? '');
  const h = /(\d+)\s*h/i.exec(str);
  const m = /(\d+)\s*m/i.exec(str);
  const sec = /(\d+)\s*s/i.exec(str);
  return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
};

const fmtDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d >= 7) return `${Math.floor(d / 7)}w ${d % 7}d`;
  if (d >= 1) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
};

function ofNorm(r: RawRow, regionMap: Record<string, string>, supMap: Record<string, string>, staff: Record<string, import('@/lib/types').StaffInfo>): OfNormRow {
  const g = (...ks: string[]) => { for (const k of ks) { if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return r[k]; } return ''; };
  const project = String(g('project_name', 'project', 'Project')).trim() || '(no project)';
  const task = String(g('task_name', 'task', 'Task')).trim() || '(no task)';
  let center = String(g('center', 'center_name', 'centre', 'Center')).trim().toUpperCase();
  if (!center) {
    const sid = String(g('staff_id', 'qat_id', 'gid')).toUpperCase();
    center = sid.startsWith('G') ? 'GSSC' : sid.startsWith('K') ? 'GSSK' : 'OTHER';
  }
  let val: number | null = null;
  for (const k of OF_NUM_KEYS) { if (r[k] !== undefined && r[k] !== '' && r[k] !== null && !isNaN(num(r[k]))) { val = num(r[k]); break; } }
  const pr = getProjectRegion(project, regionMap);
  const region = pr !== 'Unknown' ? pr : (String(g('region', 'Region')).trim().toUpperCase() || 'Unknown');
  let sup = getProjectSupervisor(project, supMap);
  if (!sup) { for (const k of Object.keys(r)) { if (/supervisor/i.test(k) && String(r[k] ?? '').trim()) { sup = String(r[k]).trim(); break; } } }
  if (!sup) { const sid = g('staff_id', 'qat_id', 'gid'); const info = sid ? staff[nid(sid)] : null; if (info && info.tl) sup = info.tl; }
  const sups = [...new Set(String(sup || '').split(/\s*(?:\/|,|&|;|\+|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean))];
  return { project, task, center, region, sup: sup || 'Unassigned', sups: sups.length ? sups : ['Unassigned'], val: val === null ? 1 : val };
}

const saveBlob = (content: string, type: string, filename: string) => {
  const blob = new Blob(['\ufeff' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const matrixToCsv = (m: string[][]) => m.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
const matrixToTsv = (m: string[][]) => m.map((r) => r.map((v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
const esc = (v: string) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const matrixToXls = (m: string[][]) =>
  '<html><head><meta charset="utf-8"></head><body><table border="1">' +
  m.map((r) => '<tr>' + r.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') +
  '</table></body></html>';

export function OutflowView() {
  const { rows, search, regionMaps, staff, fetchLiveData, active } = useDashboard();
  const [ofRegion, setOfRegion] = useState('ALL');
  const [selTaskKeys, setSelTaskKeys] = useState<string[]>([]);
  const [selSup, setSelSup] = useState('ALL');
  const [sort, setSort] = useState<SortState>({ task: '', key: 'gssc', dir: 'desc' });
  const [fbList, setFbList] = useState<FbRec[]>([]);
  const [copied, setCopied] = useState(false);

  const loadFirebase = useCallback(async () => {
    try {
      const res = await fetch(FIREBASE_URL, { cache: 'no-store' });
      const json = await res.json();
      const list: any[] = Array.isArray(json) ? json : json && typeof json === 'object' ? Object.values(json) : [];
      const out: FbRec[] = [];
      list.forEach((e) => {
        if (!e || typeof e !== 'object' || !e.project || !e.task) return;
        const value = Number(e.value);
        const seconds = e.durationRaw !== undefined && e.durationRaw !== null && !isNaN(Number(e.durationRaw)) ? Number(e.durationRaw) : parseDuration(e.duration);
        out.push({ project: String(e.project), task: String(e.task), value: isNaN(value) ? 0 : value, seconds });
      });
      setFbList(out);
    } catch {
      setFbList([]);
    }
  }, []);

  useEffect(() => { loadFirebase(); }, [loadFirebase]);

  const refreshAll = () => { fetchLiveData(); loadFirebase(); };

  const all = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.map((r) => ofNorm(r, regionMaps.region, regionMaps.sup, staff)).filter((x) => !q || (x.project + ' ' + x.task + ' ' + x.center + ' ' + x.region + ' ' + x.sup).toLowerCase().includes(q));
  }, [rows, search, regionMaps, staff]);

  const R = useMemo(() => {
    const map: Record<string, { total: number; n: number }> = {};
    all.forEach((x) => { const o = map[x.region] || (map[x.region] = { total: 0, n: 0 }); o.total += x.val; o.n++; });
    return map;
  }, [all]);
  const regions = Object.keys(R).sort((a, b) => (a === 'Unknown' ? 1 : 0) - (b === 'Unknown' ? 1 : 0) || R[b].total - R[a].total);
  const safeRegion = ofRegion !== 'ALL' && !R[ofRegion] ? 'ALL' : ofRegion;
  const allTotal = all.reduce((n, x) => n + x.val, 0);

  const model = useMemo(() => {
    const q = search.toLowerCase().trim();
    const tnames = new Map<string, string>();
    const tweight: Record<string, number> = {};
    const pmap = new Map<string, PRow>();
    const regionOf = new Map<string, string>();
    const supOf = new Map<string, Set<string>>();
    const getRow = (project: string) => {
      const k = nk(project);
      let r = pmap.get(k);
      if (!r) { r = { key: k, name: project, cells: {} }; pmap.set(k, r); }
      return r;
    };
    const getCell = (r: PRow, tk: string) => r.cells[tk] || (r.cells[tk] = { gssc: 0, gssk: 0, cur: null, sec: null });

    all.forEach((x) => {
      regionOf.set(nk(x.project), x.region);
      const sk = nk(x.project);
      const ss = supOf.get(sk) || new Set<string>();
      x.sups.forEach((u) => ss.add(u));
      supOf.set(sk, ss);
      if (safeRegion !== 'ALL' && x.region !== safeRegion) return;
      const tk = nk(x.task);
      if (!tnames.has(tk)) tnames.set(tk, x.task);
      const c = getCell(getRow(x.project), tk);
      if (x.center === 'GSSC') c.gssc += x.val;
      else if (x.center === 'GSSK') c.gssk += x.val;
      tweight[tk] = (tweight[tk] || 0) + x.val;
    });

    fbList.forEach((e) => {
      const pk = nk(e.project);
      const tk = nk(e.task);
      if (!pk || !tk) return;
      const reg = regionOf.get(pk) ?? getProjectRegion(e.project, regionMaps.region);
      if (safeRegion !== 'ALL' && reg !== safeRegion) return;
      if (q && !(e.project + ' ' + e.task).toLowerCase().includes(q)) return;
      if (!tnames.has(tk)) tnames.set(tk, e.task);
      const c = getCell(getRow(e.project), tk);
      c.cur = (c.cur || 0) + e.value;
      c.sec = (c.sec || 0) + e.seconds;
      tweight[tk] = (tweight[tk] || 0) + e.value;
    });

    pmap.forEach((r, k) => {
      if (supOf.has(k)) return;
      const parts = [...new Set(String(getProjectSupervisor(r.name, regionMaps.sup) || '').split(/\s*(?:\/|,|&|;|\+|\band\b)\s*/i).map((u) => u.trim()).filter(Boolean))];
      supOf.set(k, new Set(parts.length ? parts : ['Unassigned']));
    });

    const taskList = [...tnames.keys()].sort((a, b) => (tweight[b] || 0) - (tweight[a] || 0));
    return { tnames, taskList, pmap, supOf };
  }, [all, fbList, safeRegion, search, regionMaps]);

  const effTasks = (() => {
    const s = selTaskKeys.filter((k) => model.tnames.has(k));
    return s.length ? s.slice(0, 1) : model.taskList.slice(0, 1);
  })();
  const tcol = (t: string) => OF_FIXED[t] || OF_EXTRA[Math.max(0, model.taskList.indexOf(t)) % OF_EXTRA.length];
  const tname = (t: string) => model.tnames.get(t) || t;

  const available = [...model.pmap.values()].filter((r) => effTasks.some((t) => r.cells[t])).sort((a, b) => a.name.localeCompare(b.name));
  const isEmea = safeRegion === 'EMEA';
  const supList = [...new Set(available.flatMap((r) => [...(model.supOf.get(r.key) || [])]))].sort((a, b) => (a === 'Unassigned' ? 1 : 0) - (b === 'Unassigned' ? 1 : 0) || a.localeCompare(b));
  const safeSup = isEmea && supList.includes(selSup) ? selSup : 'ALL';
  const sortTask = effTasks.includes(sort.task) ? sort.task : effTasks[0];

  const sortVal = (r: PRow, k: SortKey): number | string => {
    if (k === 'name') return r.name.toLowerCase();
    const c = r.cells[sortTask];
    if (!c) return -1;
    if (k === 'dur') return c.sec ?? -1;
    if (k === 'cur') return c.cur ?? -1;
    if (k === 'total') return c.gssc + c.gssk;
    return k === 'gssc' ? c.gssc : c.gssk;
  };

  const list = (safeSup === 'ALL' ? available : available.filter((r) => model.supOf.get(r.key)?.has(safeSup))).slice().sort((a, b) => {
    const x = sortVal(a, sort.key);
    const y = sortVal(b, sort.key);
    const d = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
    return sort.dir === 'asc' ? d : -d;
  });

  const toggleSort = (t: string, k: SortKey) => {
    setSort((s) => (sortTask === t && s.key === k ? { task: t, key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { task: t, key: k, dir: 'desc' }));
  };

  const toggleTask = (t: string) => {
    setSelTaskKeys([t]);
  };

  const buildMatrix = (rowsX: PRow[], tkeys: string[]): string[][] => {
    const h1 = ['Project'];
    const h2 = [''];
    tkeys.forEach((t) => { h1.push(tname(t), '', ''); h2.push('GSSC Output', 'GSSK Output', 'Total Output'); });
    const body = rowsX.map((r) => [
      r.name,
      ...tkeys.flatMap((t) => {
        const c = r.cells[t];
        const g = c ? c.gssc : 0;
        const k = c ? c.gssk : 0;
        return [String(g), String(k), String(g + k)];
      }),
    ]);
    const totals = [
      'TOTAL',
      ...tkeys.flatMap((t) => {
        const sumG = rowsX.reduce((a, r) => a + (r.cells[t]?.gssc ?? 0), 0);
        const sumK = rowsX.reduce((a, r) => a + (r.cells[t]?.gssk ?? 0), 0);
        return [String(sumG), String(sumK), String(sumG + sumK)];
      }),
    ];
    return [h1, h2, ...body, totals];
  };

  const onDownloadCsv = () => saveBlob(matrixToCsv(buildMatrix(list, effTasks)), 'text/csv;charset=utf-8;', 'outflow-task-wise.csv');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(matrixToTsv(buildMatrix(list, effTasks)));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Copy failed');
    }
  };
  const onExportExcel = () => saveBlob(matrixToXls(buildMatrix(list, effTasks)), 'application/vnd.ms-excel', 'outflow-task-wise.xls');
  const onExportAll = () => {
    const rowsAll = [...model.pmap.values()].sort((a, b) => a.name.localeCompare(b.name));
    saveBlob(matrixToXls(buildMatrix(rowsAll, model.taskList)), 'application/vnd.ms-excel', 'outflow-all-tasks.xls');
  };

  const noData = all.length === 0 && fbList.length === 0;

  return (
    <div className="flex h-full flex-col">
      <TopBar showCsvExport onExportCsv={() => exportCsv(rows)} />

      {active.fetchUrl && (
        <div className="flex items-center gap-2 px-4 py-2 lg:px-6">
          <button className="btn btn-primary !py-1.5 text-xs" onClick={refreshAll}>↻ Refresh Outflow</button>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pb-6 lg:px-6">
        {noData ? (
          <div className="card px-6 py-12 text-center text-[var(--muted)]">No outflow data found.<br /><span className="text-xs">Press “Refresh Outflow”.</span></div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button className={`btn !py-1.5 text-xs ${safeRegion === 'ALL' ? 'btn-primary' : ''}`} onClick={() => setOfRegion('ALL')}>All regions <small className="ml-1 opacity-70">{ofFmt(allTotal)}</small></button>
              {regions.map((r) => (
                <button key={r} className={`btn !py-1.5 text-xs ${safeRegion === r ? 'btn-primary' : ''}`} onClick={() => setOfRegion(r)}>{r} <small className="ml-1 opacity-70">{ofFmt(R[r].total)}</small></button>
              ))}
            </div>

            <div className="card mb-3 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Filter by task</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {model.taskList.map((t) => {
                  const on = effTasks.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => toggleTask(t)}
                      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${on ? 'bg-indigo-500/25 text-white' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
                      style={{ borderColor: on ? tcol(t) : 'rgba(255,255,255,0.12)' }}
                    >
                      {on ? '✓ ' : ''}{tname(t)}
                    </button>
                  );
                })}
              </div>
            </div>

            {isEmea && (
              <div className="card mb-3 p-4">
                <div className="mb-3">
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Filter by supervisor</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelSup('ALL')}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${safeSup === 'ALL' ? 'border-teal-400 bg-teal-500/20 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
                  >
                    {safeSup === 'ALL' ? '✓ ' : ''}All supervisors
                  </button>
                  {supList.map((u) => {
                    const on = safeSup === u;
                    return (
                      <button
                        key={u}
                        onClick={() => setSelSup(u)}
                        className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${on ? 'border-teal-400 bg-teal-500/20 text-white' : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'}`}
                      >
                        {on ? '✓ ' : ''}{u}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button className="btn !px-3 !py-2 text-xs" title="Download CSV" onClick={onDownloadCsv}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
              </button>
              <button className="btn !px-3 !py-2 text-xs" title="Copy table" onClick={onCopy}>
                {copied ? '✓' : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
                )}
              </button>
              <button className="btn !py-2 text-xs" onClick={onExportExcel}>🟩 Export Excel</button>
              <button className="btn !py-2 text-xs" onClick={onExportAll}>📦 Export All</button>
            </div>

            <div className="card max-h-[70vh] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      className="sticky left-0 top-0 z-30 min-w-[150px] cursor-pointer border-b border-r border-[var(--line)] bg-[#0d1530] px-4 py-3 text-left text-sm font-bold text-cyan-300"
                      onClick={() => setSort((s) => ({ task: sortTask, key: 'name', dir: s.key === 'name' && s.dir === 'asc' ? 'desc' : 'asc' }))}
                    >
                      Project {sort.key === 'name' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    {effTasks.map((t) => (
                      <th key={t} colSpan={3} className="sticky top-0 z-20 h-[38px] whitespace-nowrap border-b border-l border-[var(--line)] bg-[#0d1530] px-3 py-2 text-center text-xs font-bold" style={{ color: tcol(t) }}>
                        {tname(t)}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {effTasks.flatMap((t) =>
                      HEADS.map((h, i) => {
                        const act = sortTask === t && sort.key === h.k;
                        return (
                          <th
                            key={t + '-' + h.k}
                            onClick={() => toggleSort(t, h.k)}
                            style={{ top: 38 }}
                            className={`sticky z-20 cursor-pointer whitespace-nowrap border-b border-[var(--line)] bg-[#0d1530] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide ${i === 0 ? 'border-l' : ''} ${act ? 'text-indigo-300' : 'text-[var(--muted)]'}`}
                          >
                            {h.l} {act ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}
                          </th>
                        );
                      })
                    )}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.key} className="hover:bg-white/[0.03]">
                      <td className="sticky left-0 z-10 border-b border-r border-white/[0.05] bg-[#0b1226] px-4 py-2.5 text-left font-semibold text-slate-100">{r.name}</td>
                      {effTasks.flatMap((t) => {
                        const c = r.cells[t];
                        const g = c ? c.gssc : 0;
                        const k = c ? c.gssk : 0;
                        return [
                          <td key={t + '-g'} className="border-b border-l border-white/[0.05] px-3 py-2.5 text-right tabular-nums text-slate-200">{ofFmt(g)}</td>,
                          <td key={t + '-k'} className="border-b border-white/[0.05] px-3 py-2.5 text-right tabular-nums text-slate-200">{ofFmt(k)}</td>,
                          <td key={t + '-t'} className="border-b border-white/[0.05] px-3 py-2.5 text-right font-bold tabular-nums text-indigo-300">{ofFmt(g + k)}</td>,
                        ];
                      })}
                    </tr>
                  ))}
                  <tr className="bg-white/[0.04]">
                    <td className="sticky left-0 z-10 border-t-2 border-r border-white/10 bg-[#0b1226] px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-teal-300">Total</td>
                    {effTasks.flatMap((t) => {
                      const sumG = list.reduce((a, r) => a + (r.cells[t]?.gssc ?? 0), 0);
                      const sumK = list.reduce((a, r) => a + (r.cells[t]?.gssk ?? 0), 0);
                      return [
                        <td key={t + '-g'} className="border-t-2 border-l border-white/10 px-3 py-3 text-right font-bold tabular-nums text-teal-300">{ofFmt(sumG)}</td>,
                        <td key={t + '-k'} className="border-t-2 border-white/10 px-3 py-3 text-right font-bold tabular-nums text-teal-300">{ofFmt(sumK)}</td>,
                        <td key={t + '-t'} className="border-t-2 border-white/10 px-3 py-3 text-right font-bold tabular-nums text-indigo-300">{ofFmt(sumG + sumK)}</td>,
                      ];
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">{list.length.toLocaleString()} projects · {effTasks.length.toLocaleString()} tasks</div>
          </>
        )}
      </div>
    </div>
  );
}

function exportCsv(rows: RawRow[]) {
  const a = rows.map(prepareRowForTable);
  if (!a.length) { alert('No rows to export'); return; }
  const cols = [...new Set(a.flatMap((x) => Object.keys(x)))];
  const csv = [cols, ...a.map((r) => cols.map((c) => r[c]))].map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement('a');
  a2.href = url;
  a2.download = 'outflow-export.csv';
  a2.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default OutflowView;