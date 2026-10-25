import { useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '@/hooks/useDashboardData';
import {
  cap,
  getRowStaffId,
  getRowTL,
  gidAggregate,
  gk,
  isEmea,
  niceCeil,
  nid,
  num,
  slotLabel,
} from '@/lib/data';
import { getProjectRegion } from '@/lib/staff';
import { gidExcel } from '@/lib/export';
import type { GidAgg, GidCur } from '@/lib/types';
import { Modal } from './Modal';
import { Copy, Download, FileSpreadsheet, Maximize2, Minimize2 } from 'lucide-react';

type OpenGidDetail = string | { gid: string; rows?: any[] };

export function GidModal() {
  const { staff, regionMaps, rowsD, ptLive, active } = useDashboard();
  const [gidCur, setGidCur] = useState<GidCur | null>(null);
  const [metric, setMetric] = useState<'deno' | 'count'>('deno');
  const [big, setBig] = useState(false);
  const capRef = useRef<HTMLDivElement>(null);

  // Listen for row clicks dispatched by table views
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenGidDetail>).detail;
      const gid = typeof detail === 'string' ? detail : detail?.gid;
      const provided = typeof detail === 'string' ? undefined : detail?.rows;
      if (!gid) return;

      // Prefer rows passed by the caller (e.g. HourlyView's leader-fetched rows),
      // otherwise fall back to the global dashboard data.
      const src: any[] = provided ?? (active.hourly ? rowsD : ptLive || []);
      const rs = src.filter((r) => nid(r.staff_id) === nid(gid));
      setGidCur({ gid, rs, info: staff[nid(gid)] || ({ id: '', name: '', primary: '', tl: '', doj: '' } as any) });
      setMetric('deno');
      setBig(false);
    };
    window.addEventListener('qat:openGid', handler as EventListener);
    return () => window.removeEventListener('qat:openGid', handler as EventListener);
  }, [active.hourly, rowsD, ptLive, staff]);

  const regionMap = regionMaps.region;
  const rows = useMemo<GidAgg[]>(() => (gidCur ? gidAggregate(gidCur.rs, (n) => getProjectRegion(n, regionMap)) : []), [gidCur, regionMap]);
  if (!gidCur) return null;

  const { gid, info } = gidCur;
  const name = info.name || gid;
  const ini = name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const M = metric;
  const mv = (x: { count: number; earned: number } | undefined) => (x ? (M === 'deno' ? x.earned : x.count) : 0);
  const fm = (n: number) => (M === 'deno' ? n.toFixed(2) : String(Math.round(n)));
  const tc = rows.reduce((n, r) => n + r.count, 0);
  const te = rows.reduce((n, r) => n + r.earned, 0);
  const emC = rows.filter((r) => isEmea(r.region)).reduce((n, r) => n + r.count, 0);
  const emE = rows.filter((r) => isEmea(r.region)).reduce((n, r) => n + r.earned, 0);
  const hours = [...new Set(rows.flatMap((r) => Object.keys(r.hours).map(Number)))].sort((a, b) => a - b);
  const hs = hours.map((h) => rows.filter((r) => isEmea(r.region)).reduce((n, r) => n + mv(r.hours[h]), 0));
  const hp = hours.map((h) => rows.filter((r) => !isEmea(r.region)).reduce((n, r) => n + mv(r.hours[h]), 0));
  const ht = hours.map((_, i) => hs[i] + hp[i]);
  const grand = ht.reduce((a, b) => a + b, 0);
  const yMax = niceCeil(Math.max(0, ...ht));
  const ticks = [4, 3, 2, 1, 0].map((i) => (yMax / 4) * i);
  const chH = big ? 360 : 240;

  const kpi = (l: string, v: string, c: string) => (
    <div className="rounded-xl border border-[var(--line)] bg-white/[0.03] p-3" style={{ borderLeft: `4px solid ${c}` }}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{l}</div>
      <div className="mt-1 text-xl font-bold tabular-nums" style={{ color: c }}>{v}</div>
    </div>
  );

  return (
    <Modal
      open
      onClose={() => setGidCur(null)}
      wide={big}
      title={
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-cyan-500 font-bold text-cyan-300">
            {ini}
          </div>
          <div>
            <div className="text-base font-bold">{name}</div>
            <div className="text-xs font-normal text-cyan-400/80">
              {cap(String(info.id || gid))}{info.tl ? ` · TL: ${info.tl}` : ''}{info.primary && info.primary !== '—' ? ` · ${info.primary}` : ''}
            </div>
          </div>
        </div>
      }
      actions={
        <>
          <button className="btn !py-1 text-xs" onClick={() => copyImg(capRef)}><Copy size={14} /> Copy</button>
          <button className="btn !py-1 text-xs" onClick={() => dlImg(capRef, gid, name)}><Download size={14} /> PNG</button>
          <button className="btn !py-1 text-xs" onClick={() => gidExcel(rows, hours, gid, name, info)}><FileSpreadsheet size={14} /> Excel</button>
          <button className="btn !py-1 text-xs" onClick={() => setBig((b) => !b)}>{big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </>
      }
    >
      <div ref={capRef} className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kpi('Total W/O Output', String(Math.round(tc)), '#10b981')}
          {kpi('Total With Deno', te.toFixed(2), '#f59e0b')}
          {kpi(`EMEA (${M === 'deno' ? 'Deno' : 'Count'})`, M === 'deno' ? emE.toFixed(2) : String(Math.round(emC)), '#3b82f6')}
          {kpi(`Other (${M === 'deno' ? 'Deno' : 'Count'})`, M === 'deno' ? (te - emE).toFixed(2) : String(Math.round(tc - emC)), '#ef4444')}
        </div>

        {/* Projects table */}
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] bg-white/[0.04] text-[var(--muted)]">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Task</th>
                <th className="px-3 py-2 text-center">Region</th>
                <th className="px-3 py-2 text-right">Count</th>
                <th className="px-3 py-2 text-right">Deno</th>
                <th className="px-3 py-2 text-right">With Deno</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--muted)]">No output for this GID</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-[var(--muted)]">{i + 1}</td>
                    <td className="px-3 py-2 text-cyan-300">{r.project}</td>
                    <td className="px-3 py-2">{r.task}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${isEmea(r.region) ? 'bg-blue-500/15 text-blue-300' : 'bg-rose-500/15 text-rose-300'}`}>{r.region}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-blue-300">{Math.round(r.count)}</td>
                    <td className="px-3 py-2 text-right text-[var(--muted)]">{r.count > 0 ? (r.earned / r.count).toFixed(2) : '0.00'}</td>
                    <td className="px-3 py-2 text-right font-bold text-amber-300">{r.earned.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t border-[var(--line)] bg-white/[0.03] font-bold">
                  <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right text-emerald-300">{Math.round(tc)}</td>
                  <td className="px-3 py-2 text-right text-[var(--muted)]">—</td>
                  <td className="px-3 py-2 text-right text-amber-300">{te.toFixed(2)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Hourly chart + metric toggle */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
            <span className="text-sm font-semibold">QAT-wise Hourly Chart <span className="text-cyan-400">— {M === 'deno' ? 'With Deno' : 'Output Count'}</span></span>
            <select className="input !py-1 !text-xs" value={metric} onChange={(e) => setMetric(e.target.value as 'deno' | 'count')}>
              <option value="deno">With Deno</option>
              <option value="count">Output Count</option>
            </select>
          </div>
          {hours.length === 0 ? (
            <div className="px-4 py-10 text-center text-[var(--muted)]">No hourly data</div>
          ) : (
            <>
              <div className="flex px-4 pt-4">
                <div className="relative mr-2" style={{ width: 44, height: chH }}>
                  {ticks.map((t, i) => (
                    <span key={i} className="absolute right-1 -translate-y-1/2 text-[10px] text-[var(--muted)]" style={{ top: `${(i / 4) * 100}%` }}>
                      {M === 'deno' ? Math.round(t * 100) / 100 : Math.round(t)}
                    </span>
                  ))}
                </div>
                <div className="relative flex-1" style={{ height: chH }}>
                  {ticks.map((_, i) => (
                    <div key={i} className="absolute left-0 right-0 border-t border-white/[0.07]" style={{ top: `${(i / 4) * 100}%` }} />
                  ))}
                  <div className="absolute inset-0 flex">
                    {hours.map((h, i) => (
                      <div key={h} className="flex flex-1 flex-col items-center justify-end border-l border-white/[0.04]" title={`${slotLabel(h)} — ${fm(ht[i])}`}>
                        {ht[i] > 0 && <div className="mb-1 text-[10px] text-slate-300">{fm(ht[i])}</div>}
                        <div className="relative flex w-[70%] max-w-[56px] flex-col justify-end" style={{ height: yMax ? `${(ht[i] / yMax) * 100}%` : 0 }}>
                          {hp[i] > 0 && <i className="block w-full bg-rose-500" style={{ height: `${(hp[i] / ht[i]) * 100}%`, minHeight: 2 }} />}
                          {hs[i] > 0 && <i className="block w-full bg-blue-500" style={{ height: `${(hs[i] / ht[i]) * 100}%`, minHeight: 2 }} />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ml-14 mr-4 flex">
                {hours.map((h) => <span key={h} className="flex-1 text-center text-[11px] text-slate-300">{slotLabel(h)}</span>)}
              </div>
              <div className="flex justify-center gap-4 py-2 text-xs">
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-blue-500" /> EMEA</span>
                <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Other</span>
              </div>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-cyan-300/80">
                      <th className="px-2 py-1 text-left">Project</th>
                      <th className="px-2 py-1 text-left">Task</th>
                      {hours.map((h) => <th key={h} className="px-2 py-1 text-center">{slotLabel(h)}</th>)}
                      <th className="px-2 py-1 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-white/[0.04]">
                        <td className="px-2 py-1">{r.project}</td>
                        <td className="px-2 py-1 text-violet-300/80">{r.task}</td>
                        {hours.map((h) => {
                          const v = mv(r.hours[h]);
                          return <td key={h} className="px-2 py-1 text-center tabular-nums">{v > 0 ? fm(v) : <span className="text-slate-600">—</span>}</td>;
                        })}
                        <td className="px-2 py-1 text-center font-bold text-emerald-300">{fm(hours.reduce((n, h) => n + mv(r.hours[h]), 0))}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[var(--line)] font-bold">
                      <td colSpan={2} className="px-2 py-1">Hourly Total</td>
                      {ht.map((t, i) => <td key={i} className="px-2 py-1 text-center text-emerald-300">{fm(t)}</td>)}
                      <td className="px-2 py-1 text-center text-emerald-300">{fm(grand)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

async function copyImg(ref: React.RefObject<HTMLDivElement>) {
  if (!ref.current || !window.html2canvas) return;
  try {
    const canvas = await window.html2canvas(ref.current, { backgroundColor: '#0f172a', scale: 2 });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) { console.warn(e); alert('Copy failed'); }
}

async function dlImg(ref: React.RefObject<HTMLDivElement>, gid: string, name: string) {
  if (!ref.current || !window.html2canvas) return;
  try {
    const canvas = await window.html2canvas(ref.current, { backgroundColor: '#0f172a', scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || gid}-details.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  } catch (e) { console.warn(e); alert('Download failed'); }
}

/**
 * Dispatch a global event to open the GID modal (used by table rows).
 * Pass `rows` when the caller already has the raw rows for this view
 * (e.g. leader-fetched rows in HourlyView); otherwise the modal falls back
 * to the global dashboard data.
 */
export function openGid(gid: string, rows?: any[]) {
  window.dispatchEvent(new CustomEvent('qat:openGid', { detail: { gid, rows } }));
}

export { getRowStaffId, getRowTL, gk };