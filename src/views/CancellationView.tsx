import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from '@/hooks/useDashboardData';
import { TopBar } from '@/components/TopBar';
import { prepareRowForTable, getRowTL, getRowStaffId, nid } from '@/lib/data';
import { useRoleScope, matchesScope, nameMatches } from '@/lib/roleScope';
import type { RawRow } from '@/lib/types';

// Pull the row objects out of whatever shape the API returns:
// [..rows], { data: [...] }, { rows: [...] }, [{ rows: [...] }, ...], { tlA: { rows: [...] }, ... }
function extractRows(d: any): any[] {
  if (!d) return [];
  if (Array.isArray(d)) {
    return d
      .flatMap((x) => {
        if (x && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x.rows)) return x.error ? [] : x.rows;
        return [x];
      })
      .filter((x) => x && typeof x === 'object');
  }
  if (typeof d === 'object') {
    if (Array.isArray(d.rows)) return d.error ? [] : d.rows;
    if (d.data !== undefined) return extractRows(d.data);
    const vals = Object.values(d);
    if (vals.some((v) => v === null || typeof v !== 'object')) return [d]; // a single row-like object
    return vals.flatMap(extractRows);
  }
  return [];
}

const PALETTE = ['#10b981', '#38bdf8', '#f59e0b', '#a78bfa', '#f87171', '#2dd4bf', '#fb923c', '#60a5fa', '#e879f9', '#facc15'];

// Reasons are grouped into these categories. Whatever text comes before / after the keyword
// (e.g. "Technical issue - camera blur", "Rotated probe (left)") is ignored.
const REASON_CATEGORIES: { label: string; test: RegExp }[] = [
  { label: 'SMART-Auto-Generated', test: /smart[\s_-]*auto/i },
  { label: 'Technical issue', test: /technical/i },
  { label: 'Rotated probe', test: /rotat/i },
  { label: 'Incorrect stitching', test: /stitch/i },
  { label: 'Other', test: /\bother\b/i },
];

function categorizeReason(text: string): string {
  let best = '';
  let bestIdx = Infinity;
  for (const c of REASON_CATEGORIES) {
    const m = text.match(c.test);
    // the category whose keyword appears first in the text wins; list order breaks ties
    if (m && m.index !== undefined && m.index < bestIdx) { best = c.label; bestIdx = m.index; }
  }
  return best || 'Other'; // anything unrecognised is counted under Other
}

function reasonFrom(p: any, key: string, group = true): string {
  if (!key) return '(blank)';
  const v = p?.[key];
  const s = (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim();
  if (!s) return '(blank)';
  return group ? categorizeReason(s) : s;
}

const countDesc = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);

type CTab = 'summary' | 'details';

export function CancellationView() {
  const { rows, search, leaderFilter, setLeaderFilter, tlList, active, dateFilter, staff } = useDashboard();
  const {
    roleReady, userName, isTeamLeader, isShiftSup, isOther,
    adminMode, setAdminMode, adminSS, setAdminSS,
    ssMode, ssName, shiftSupList, ssTLNames, ssTLFilter, setSsTLFilter,
    effectiveTeamLeader, activeLeader, scope, fetchScope,
  } = useRoleScope();

  const hasApi = !!active.fetchUrl;

  // What to load: nothing until a Team Leader / Shift Sup is chosen
  const scopeKey = !roleReady ? '' : ssMode ? (ssName ? `ss|${ssName}` : '') : activeLeader ? `tl|${activeLeader}` : '';

  const [fetched, setFetched] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setFetched([]);
    // wait until a TL / Shift Sup is chosen AND the roster has resolved their staff
    const ready = !!scopeKey && (fetchScope.ids.size > 0 || fetchScope.tls.length > 0);
    if (!hasApi || !ready) {
      setLoading(false);
      setFetchErr('');
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setFetchErr('');

    const kind = scopeKey.slice(0, 2);
    const value = scopeKey.slice(3);
    const u = new URL(String(active.fetchUrl), window.location.href);
    if (kind === 'ss') u.searchParams.set('shift_sup', value);
    else u.searchParams.set('team_leader', value);
    if (dateFilter) u.searchParams.set('date', dateFilter);

    // POST so a long staff-id list never hits URL length limits; the server returns only these staff's rows
    fetch(u.toString(), {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scoped: true,
        shift_sup: kind === 'ss' ? value : '',
        team_leader: kind === 'tl' ? value : '',
        staff_ids: [...fetchScope.ids],
        team_leaders: fetchScope.tls,
        date: dateFilter || '',
      }),
    })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => { setFetched(extractRows(d)); setLoading(false); })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setFetchErr(e.message || 'Fetch failed');
        setLoading(false);
      });
    return () => ctl.abort();
  }, [scopeKey, fetchScope, dateFilter, tick, hasApi, active.fetchUrl]);

  // Live API -> only the rows fetched for this selection. Static dataset -> filter the loaded rows.
  const source = hasApi ? fetched : rows;

  // Safety net: keep only rows that belong to this scope's staff ids / team leaders
  const scopedRows = useMemo(() => source.filter((r) => matchesScope(r, scope)), [source, scope]);

  const [tab, setTab] = useState<CTab>('summary');

  // prepared rows (same order as scopedRows)
  const prepAll = useMemo(() => scopedRows.map(prepareRowForTable), [scopedRows]);
  const allCols = useMemo(() => [...new Set(prepAll.flatMap((x) => Object.keys(x)))], [prepAll]);

  // Reason column: auto-detected (a column with "reason" in its name); can be changed from the dropdown
  const autoReasonKey = useMemo(() => {
    const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
    const pri = ['canceltype', 'cancellationtype', 'cancelationtype', 'cancelreasontype', 'reasontype', 'cancelreasontype', 'cancellationreasontype', 'cancelreason', 'cancellationreason', 'cancelationreason', 'reason'];
    for (const p of pri) {
      const k = allCols.find((c) => norm(c) === p);
      if (k) return k;
    }
    return allCols.find((c) => norm(c).includes('reason')) || allCols.find((c) => /cancel.*type|^type$/.test(norm(c))) || '';
  }, [allCols]);
  const reasonKey = autoReasonKey;

  const grp = true; // cancel type is always grouped into the fixed categories
  const [reasonSel, setReasonSel] = useState<string[]>([]);
  useEffect(() => { setReasonSel([]); }, [reasonKey, scopeKey, grp]);
  const toggleReason = (r: string) => setReasonSel((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  // 1) search box
  const searchIdx = useMemo(() => {
    const q = search.toLowerCase().trim();
    const out: number[] = [];
    for (let i = 0; i < scopedRows.length; i++) {
      if (!q || JSON.stringify(scopedRows[i]).toLowerCase().includes(q)) out.push(i);
    }
    return out;
  }, [scopedRows, search]);

  // reason chips: counts after search, before the reason filter
  const reasonCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of searchIdx) {
      const r = reasonFrom(prepAll[i], reasonKey, grp);
      m.set(r, (m.get(r) || 0) + 1);
    }
    return [...m.entries()].sort(countDesc);
  }, [searchIdx, prepAll, reasonKey, grp]);

  // fixed chips: the 5 cancel types (+ blank if present), always in the same order
  const chipList = useMemo(() => {
    const m = new Map(reasonCounts);
    const base: [string, number][] = REASON_CATEGORIES.map((c) => [c.label, m.get(c.label) || 0]);
    const blank = m.get('(blank)');
    if (blank) base.push(['(blank)', blank]);
    return base;
  }, [reasonCounts]);

  // 2) cancel type filter
  const finalIdx = useMemo(() => {
    if (!reasonSel.length) return searchIdx;
    const sel = new Set(reasonSel);
    return searchIdx.filter((i) => sel.has(reasonFrom(prepAll[i], reasonKey, grp)));
  }, [searchIdx, reasonSel, prepAll, reasonKey, grp]);

  const list = useMemo(() => finalIdx.map((i) => prepAll[i]), [finalIdx, prepAll]);
  const finalRaw = useMemo(() => finalIdx.map((i) => scopedRows[i]), [finalIdx, scopedRows]);
  const cols = allCols.slice(0, 35);

  // Summary numbers (follow search + reason filter)
  const summary = useMemo(() => {
    const total = finalIdx.length;
    const byReason = new Map<string, number>();
    const byStaff = new Map<string, { count: number; reasons: Map<string, number> }>();
    const byTL = new Map<string, number>();
    for (const i of finalIdx) {
      const raw = scopedRows[i];
      const r = reasonFrom(prepAll[i], reasonKey, grp);
      byReason.set(r, (byReason.get(r) || 0) + 1);

      const sid = String(getRowStaffId(raw) || '') || '(unknown)';
      let st = byStaff.get(sid);
      if (!st) { st = { count: 0, reasons: new Map() }; byStaff.set(sid, st); }
      st.count += 1;
      st.reasons.set(r, (st.reasons.get(r) || 0) + 1);

      const tl = String(getRowTL(raw) || '') || '(unknown)';
      byTL.set(tl, (byTL.get(tl) || 0) + 1);
    }
    const reasons = [...byReason.entries()].sort(countDesc);
    const staffRows = [...byStaff.entries()]
      .map(([sid, v]) => {
        const top = [...v.reasons.entries()].sort(countDesc)[0];
        return { sid, count: v.count, topReason: top ? top[0] : '', topCount: top ? top[1] : 0 };
      })
      .sort((a, b) => b.count - a.count || a.sid.localeCompare(b.sid));
    const tlRows = [...byTL.entries()].sort(countDesc);
    return { total, reasons, staffRows, tlRows };
  }, [finalIdx, scopedRows, prepAll, reasonKey, grp]);

  const staffName = (sid: string) => {
    const st: any = (staff as any)?.[nid(sid)] ?? (staff as any)?.[sid];
    return st?.name || '';
  };

  const leaders = tlList.length ? tlList : [...new Set(rows.map((r) => getRowTL(r)).filter(Boolean))].sort();

  const needsSelection = roleReady && !scopeKey && !isTeamLeader;

  const scopeLabel = ssMode
    ? ssTLFilter ? `TL: ${ssTLFilter}` : ssName ? `SS: ${ssName}` : 'Select Shift Sup'
    : isTeamLeader
      ? effectiveTeamLeader || userName || '—'
      : leaderFilter || 'Select TL';

  const matchedStaff = scope.kind === 'all' || scope.kind === 'none' ? '—' : scope.ids.size.toLocaleString();

  const modeBtn = (m: 'tl' | 'ss', label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => { setAdminMode(m); setSsTLFilter(''); }}
      className={`rounded-md px-3 py-1 text-xs font-semibold ${adminMode === m ? 'bg-white/10 text-white' : 'text-[var(--muted)] hover:text-white'}`}
    >
      {label}
    </button>
  );

  const emptyMsg = !roleReady || loading
    ? 'Loading…'
    : needsSelection
      ? ssMode
        ? 'Select a Shift Sup to load cancellation data.'
        : 'Select a Team Leader or Shift Sup to load cancellation data.'
      : scope.kind === 'none'
        ? 'No team leader found for your account.'
        : ssMode
          ? ssTLFilter
            ? `No cancellation records found for Team Leader "${ssTLFilter}".`
            : `No cancellation records found under Shift Sup "${ssName}".`
          : `No cancellation records found for staff under team leader "${isTeamLeader ? effectiveTeamLeader : leaderFilter}".`;

  return (
    <div className="flex h-full flex-col">
      <TopBar showCsvExport onExportCsv={() => exportCsv(finalRaw)} />

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        {isShiftSup ? (
          <div className="rounded bg-white/5 px-2 py-1.5 text-xs text-[var(--muted)]">Shift Sup: {userName || ''}</div>
        ) : isTeamLeader ? (
          <div className="rounded bg-white/5 px-2 py-1.5 text-xs text-[var(--muted)]">Team: {effectiveTeamLeader || userName || ''}</div>
        ) : (
          <>
            <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
              {modeBtn('tl', 'Team Leader')}
              {modeBtn('ss', 'Shift Sup')}
            </div>
            {adminMode === 'tl' ? (
              <select className="input !py-1.5 text-xs" value={leaderFilter} onChange={(e) => setLeaderFilter(e.target.value)}>
                <option value="">Select Team Leader</option>
                {leaders.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            ) : (
              <select
                className="input !py-1.5 text-xs"
                value={adminSS}
                onChange={(e) => { setAdminSS(e.target.value); setSsTLFilter(''); }}
              >
                <option value="">{shiftSupList.length ? 'Select Shift Sup' : 'No Shift Sup found in roster'}</option>
                {shiftSupList.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
          </>
        )}
        {hasApi && (
          <button className="btn btn-primary !py-1.5 text-xs" disabled={!scopeKey || loading} onClick={() => setTick((t) => t + 1)}>
            ↻ Refresh Cancellation
          </button>
        )}
        <span className="text-xs text-[var(--muted)]">{list.length.toLocaleString()} rows</span>
        {loading && <span className="text-xs text-sky-300">Loading…</span>}
        {fetchErr && <span className="text-xs text-rose-300">{fetchErr}</span>}
      </div>

      {ssMode && ssTLNames.length > 0 && (
        <div className="border-b border-white/[0.06] px-4 py-2.5 lg:px-6">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <span>Team Leaders under {ssName}</span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/70">{ssTLNames.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSsTLFilter('')}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                !ssTLFilter
                  ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                  : 'border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
              }`}
            >
              All
            </button>
            {ssTLNames.map((tl) => {
              const on = !!ssTLFilter && nameMatches(tl, ssTLFilter);
              return (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setSsTLFilter(tl)}
                  title={`Show only ${tl}'s team`}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    on
                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                      : 'border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tl}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pb-6 pt-4 lg:px-6">
        {/* tabs */}
        <div className="mb-4 flex gap-1 border-b border-white/[0.06]">
          {(['summary', 'details'] as CTab[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? 'border-sky-400 text-white' : 'border-transparent text-[var(--muted)] hover:text-white'}`}
            >
              {k === 'summary' ? 'Summary' : 'Details'}
            </button>
          ))}
        </div>

        {/* reason type filter (applies to Summary + Details + CSV export) */}
        {scopedRows.length > 0 && (
          <div className="card mb-4 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold">Cancel type</span>
              {!reasonKey && <span className="text-[11px] text-amber-300">No cancel type column found in the data.</span>}
              {reasonSel.length > 0 && (
                <button type="button" className="text-xs font-semibold text-sky-300 hover:underline" onClick={() => setReasonSel([])}>
                  Clear ({reasonSel.length})
                </button>
              )}
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-auto">
              <button
                type="button"
                onClick={() => setReasonSel([])}
                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  reasonSel.length === 0
                    ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                    : 'border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
                }`}
              >
                All <span className="ml-1 text-[10px] opacity-70">({searchIdx.length})</span>
              </button>
              {chipList.map(([r, n]) => {
                const on = reasonSel.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleReason(r)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${n === 0 && !on ? 'opacity-40 ' : ''}${
                      on
                        ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                        : 'border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {r} <span className="ml-1 text-[10px] opacity-70">({n})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'summary' ? (
          list.length === 0 ? (
            <div className="card px-6 py-12 text-center text-[var(--muted)]">{emptyMsg}</div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* KPI cards */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['Total cancellations', summary.total.toLocaleString(), '#f87171', ''],
                  ['Cancel types', summary.reasons.length.toLocaleString(), '#a78bfa', ''],
                  [
                    'Top cancel type',
                    summary.reasons[0] ? summary.reasons[0][0] : '—',
                    '#f59e0b',
                    summary.reasons[0] ? `${summary.reasons[0][1]} (${((summary.reasons[0][1] / summary.total) * 100).toFixed(0)}%)` : '',
                  ],
                  ['Staff affected', summary.staffRows.length.toLocaleString(), '#38bdf8', ''],
                ].map(([l, v, c, sub]) => (
                  <div key={l} className="rounded-lg border border-white/[0.06] bg-[#0f1726] px-4 py-3" style={{ borderLeft: `3px solid ${c}` }}>
                    <div className="text-[11px] font-semibold text-[var(--muted)]">{l}</div>
                    <div className="truncate text-2xl font-extrabold" style={{ color: c }} title={String(v)}>{v}</div>
                    {sub && <div className="truncate text-[11px] text-[var(--muted)]">{sub}</div>}
                  </div>
                ))}
              </div>

              {/* reason bars (click a bar to filter) */}
              <div className="card p-4">
                <div className="mb-3 text-sm font-bold">Cancellations by cancel type</div>
                <div className="flex max-h-[360px] flex-col gap-1.5 overflow-auto pr-2">
                  {summary.reasons.map(([r, n], i) => {
                    const max = summary.reasons[0][1] || 1;
                    const on = reasonSel.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleReason(r)}
                        className={`flex items-center gap-3 rounded text-left text-xs ${on ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
                        title="Click to filter by this cancel type"
                      >
                        <div className="w-52 shrink-0 truncate text-right text-[var(--muted)]">{r}</div>
                        <div className="relative h-4 flex-1 rounded-sm bg-white/[0.03]">
                          <div className="h-full rounded-sm" style={{ width: `${(n / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                        <div className="w-24 shrink-0 text-right font-semibold">
                          {n} <span className="font-normal text-[var(--muted)]">({((n / summary.total) * 100).toFixed(0)}%)</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`grid gap-4 ${summary.tlRows.length > 1 ? 'lg:grid-cols-[1fr_320px]' : ''}`}>
                {/* by staff */}
                <div className="card overflow-hidden">
                  <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-bold">By staff</div>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-[13px]">
                      <thead>
                        <tr>
                          {['#', 'Staff ID', 'Name', 'Cancellations', 'Top cancel type'].map((h, i) => (
                            <th key={h} className={`sticky top-0 z-10 bg-[#17233b] px-3 py-2 ${i === 3 ? 'text-center' : 'text-left'}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summary.staffRows.map((s, i) => (
                          <tr key={s.sid} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                            <td className="px-3 py-2 text-[var(--muted)]">{i + 1}</td>
                            <td className="px-3 py-2 font-bold text-teal-300">{s.sid}</td>
                            <td className="px-3 py-2">{staffName(s.sid) || '—'}</td>
                            <td className="px-3 py-2 text-center font-bold text-rose-300">{s.count}</td>
                            <td className="px-3 py-2">
                              {s.topReason} <span className="text-[var(--muted)]">({s.topCount})</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* by team leader (only when more than one) */}
                {summary.tlRows.length > 1 && (
                  <div className="card overflow-hidden">
                    <div className="border-b border-white/[0.06] px-4 py-3 text-sm font-bold">By team leader</div>
                    <div className="max-h-[420px] overflow-auto">
                      <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-[13px]">
                        <thead>
                          <tr>
                            <th className="sticky top-0 z-10 bg-[#17233b] px-3 py-2 text-left">Team Leader</th>
                            <th className="sticky top-0 z-10 bg-[#17233b] px-3 py-2 text-center">Cancellations</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.tlRows.map(([tl, n]) => (
                            <tr key={tl} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                              <td className="px-3 py-2">{tl}</td>
                              <td className="px-3 py-2 text-center font-bold text-rose-300">{n}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Visible rows', list.length.toLocaleString(), '#2dd4bf'],
                ['Dataset', active.label, '#22d3ee'],
                [ssMode ? 'Shift sup' : 'Team leader', scopeLabel, '#60a5fa'],
                ['Matched staff', matchedStaff, '#a78bfa'],
              ].map(([l, v, c]) => (
                <div key={l} className="stat-card" style={{ ['--glow' as any]: c }}>
                  <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{l}</div>
                  <div className="mt-1 truncate text-2xl font-bold tabular-nums" style={{ color: c }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="card overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
              {list.length === 0 ? (
                <div className="px-6 py-12 text-center text-[var(--muted)]">{emptyMsg}</div>
              ) : (
                <table className="w-full whitespace-nowrap text-[13px]">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-[#17233b] text-slate-300">
                      {cols.map((c) => <th key={c} className="px-3 py-2 text-left">{c.replace(/_/g, ' ')}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => (
                      <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                        {cols.map((c) => <td key={c} className="px-3 py-2">{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
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
  const el = document.createElement('a');
  el.href = url;
  el.download = 'cancellation-export.csv';
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}