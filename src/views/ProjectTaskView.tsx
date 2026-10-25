import { useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '@/hooks/useDashboardData';
import { TopBar } from '@/components/TopBar';
import { openGid } from '@/components/GidModal';
import { cap, formatPTCaptionDate, getRowCategory, gk, nid, num, slotLabel, bizDate, sanitizeName } from '@/lib/data';
import { getProjectRegion } from '@/lib/staff';
import { copyCanvas, downloadCanvas, exportPTExcel } from '@/lib/export';
import type { PTHourlyModel, RawRow } from '@/lib/types';
import { Search } from 'lucide-react';

const TASK_OPTIONS = [
  'validation', 'validation_edit', 'offline_validation', 'masking', 'masking_price_labels',
  'masking_menu_items', 'voting', 'offline_voting', 'pricing_voting', 'offline_pricing',
  'scene_recognition', 'scene_recognition_edit', 'category_expert', 'stitching',
  'voting_engine', 'masking_engine', 'offline_posm', 'special_masking', 'Posm_masking',
  'posm_voting', 'stitching_edit',
];

const W_GID = 80;
const W_NAME = 160;
const W_PRIMARY = 120;
const W_TL = 150;
const W_TOTAL = 80;
const L_GID = 0;
const L_NAME = W_GID;
const L_PRIMARY = L_NAME + W_NAME;
const L_TL = L_PRIMARY + W_PRIMARY;
const L_TOTAL = L_TL + W_TL;

const BG_GSSC = '#132844';
const BG_GSSK = '#231a4a';
const BG_COMBINED = '#0d2c3a';

const fixW = (w: number) => ({ width: w, minWidth: w, maxWidth: w });

function parseTasks(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Multi-select task picker.
 * - Type to filter the dropdown list
 * - Each option has a checkbox, click to toggle (multiple selection)
 * - Selected tasks show as chips; value is kept as a comma-separated string
 * - Enter: toggles the highlighted match (or adds typed text as custom task);
 *   Enter with empty input triggers onEnter (fetch)
 */
function TaskMultiSelect({
  value,
  onChange,
  options,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onEnter?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => parseTasks(value), [value]);
  const selectedLower = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);

  // all options + any custom selected values that aren't in the base list
  const allOptions = useMemo(() => {
    const base = [...options];
    const baseLower = new Set(base.map((o) => o.toLowerCase()));
    selected.forEach((s) => { if (!baseLower.has(s.toLowerCase())) base.unshift(s); });
    return base;
  }, [options, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.toLowerCase().includes(q));
  }, [allOptions, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const commit = (list: string[]) => onChange(list.join(', '));

  const toggle = (item: string) => {
    const low = item.toLowerCase();
    if (selectedLower.has(low)) commit(selected.filter((s) => s.toLowerCase() !== low));
    else commit([...selected, item]);
  };

  const remove = (item: string) => commit(selected.filter((s) => s !== item));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = query.trim();
      if (q) {
        const exact = allOptions.find((o) => o.toLowerCase() === q.toLowerCase());
        if (exact) toggle(exact);
        else if (filtered.length > 0 && open) toggle(filtered[Math.min(active, filtered.length - 1)]);
        else toggle(q);
        setQuery('');
      } else {
        setOpen(false);
        onEnter?.();
      }
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      commit(selected.slice(0, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === ',') {
      const q = query.trim();
      if (q) {
        e.preventDefault();
        const exact = allOptions.find((o) => o.toLowerCase() === q.toLowerCase());
        if (!selectedLower.has((exact || q).toLowerCase())) commit([...selected, exact || q]);
        setQuery('');
      }
    }
  };

  return (
    <div ref={wrapRef} className="relative" style={{ minWidth: 260, maxWidth: 520 }}>
      <div
        className="input !py-1 flex min-h-[32px] flex-wrap items-center gap-1 text-xs"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/15 px-1.5 py-0.5 text-[11px] text-teal-200">
            {s}
            <button
              type="button"
              className="leading-none text-teal-300/70 hover:text-white"
              onClick={(e) => { e.stopPropagation(); remove(s); }}
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-[90px] flex-1 border-0 bg-transparent p-0 text-xs outline-none"
          placeholder={selected.length ? '' : 'Task name (select multiple)'}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        {selected.length > 0 && (
          <button
            type="button"
            className="ml-auto text-[11px] text-[var(--muted)] hover:text-white"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--line)] bg-[#0d1118] py-1 shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--muted)]">
              {query.trim() ? <>Press <b className="text-teal-300">Enter</b> to add “{query.trim()}”</> : 'No tasks'}
            </div>
          ) : (
            filtered.map((o, i) => {
              const checked = selectedLower.has(o.toLowerCase());
              return (
                <label
                  key={o}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.06] ${i === active ? 'bg-white/[0.05]' : ''}`}
                  onMouseEnter={() => setActive(i)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o)}
                  />
                  <span className={checked ? 'text-teal-300' : 'text-slate-300'}>{o}</span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select team leader picker (array based).
 * - Button shows "All team leaders" / the single name / "N team leaders"
 * - Dropdown has search, Select all (respects search filter), Clear
 * - Empty selection = all team leaders
 */
function TLMultiSelect({
  selected,
  onChange,
  options,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (item: string) =>
    onChange(selected.includes(item) ? selected.filter((s) => s !== item) : [...selected, item]);

  const label =
    selected.length === 0
      ? 'All team leaders'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} team leaders`;

  return (
    <div ref={wrapRef} className="relative" style={{ minWidth: 180 }}>
      <button
        type="button"
        className="input !py-1.5 flex w-full items-center justify-between gap-2 text-left text-xs"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{label}</span>
        <span className="text-[10px] text-[var(--muted)]">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--line)] bg-[#0d1118] shadow-xl">
          <div className="border-b border-[var(--line)] p-2">
            <input
              autoFocus
              className="input !py-1 w-full text-xs"
              placeholder="Search team leader…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
            />
            <div className="mt-1.5 flex justify-between text-[11px]">
              <button
                type="button"
                className="text-teal-300 hover:text-white"
                onClick={() => onChange([...new Set([...selected, ...filtered])])}
              >
                Select all{query.trim() ? ' (filtered)' : ''}
              </button>
              <button
                type="button"
                className="text-[var(--muted)] hover:text-white"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--muted)]">No team leaders</div>
            ) : (
              filtered.map((o) => {
                const checked = selected.includes(o);
                return (
                  <label
                    key={o}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.06]"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(o)} />
                    <span className={checked ? 'text-teal-300' : 'text-slate-300'}>{o}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function toHourSlot(ts: unknown): number {
  if (ts == null) return -1;
  let d: Date;
  if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === 'number') {
    if (ts > 1e12) d = new Date(ts);
    else if (ts > 1e9) d = new Date(ts * 1000);
    else if (ts > 25000 && ts < 80000) d = new Date(Math.round((ts - 25569) * 86400000));
    else d = new Date(ts);
  } else {
    const s = String(ts).trim();
    const n = Number(s);
    if (s !== '' && !isNaN(n)) return toHourSlot(n);
    d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return -1;
  const mins = d.getHours() * 60 + d.getMinutes();
  return Math.floor((((mins - 330) % 1440) + 1440) % 1440 / 60);
}

function computeHourRange(hourTotals: Record<number, number>): { firstHour: number; lastHour: number } {
  let firstHour = 24;
  let lastHour = -1;
  for (let k = 0; k < 24; k++) {
    if ((hourTotals[k] || 0) > 0) {
      if (k < firstHour) firstHour = k;
      if (k > lastHour) lastHour = k;
    }
  }
  if (firstHour === 24 || lastHour < 0) return { firstHour: 0, lastHour: 23 };
  return { firstHour, lastHour };
}

function buildPTHourlyModel(
  ptLive: RawRow[],
  ptCenter: string,
  selCats: string[],
  applyCatFilter: boolean,
  tlFilter: string[],
  staff: Record<string, import('@/lib/types').StaffInfo>,
): PTHourlyModel | null {
  if (!ptLive || ptLive.length === 0) return null;
  const filteredRows = ptLive.filter((r) => {
    const gid = String(r.staff_id || '').toUpperCase();
    const center = gid.startsWith('G') ? 'GSSC' : gid.startsWith('K') ? 'GSSK' : 'Other';
    if (center === 'Other') return false;
    if (ptCenter !== 'both' && center !== ptCenter) return false;
    if (applyCatFilter) {
      const cat = r.category || getRowCategory(r.project_name, r.task_name, r.template_name);
      if (!selCats.includes(cat)) return false;
    }
    if (tlFilter.length > 0) {
      const info = staff[nid(gid)];
      if (!info || !tlFilter.includes(info.tl)) return false;
    }
    return true;
  });
  const hourlyMap: PTHourlyModel['hourlyMap'] = {};
  filteredRows.forEach((r) => {
    const gid = String(r.staff_id || '').toUpperCase();
    if (!gid) return;
    const center = gid.startsWith('G') ? 'GSSC' : 'GSSK';
    if (!hourlyMap[gid]) hourlyMap[gid] = { total: 0, center, h: {} };
    const v = num(r.value) || 0;
    const k = toHourSlot(r.timestamp);
    if (k >= 0 && k < 24) hourlyMap[gid].h[k] = (hourlyMap[gid].h[k] || 0) + v;
    hourlyMap[gid].total += v;
  });
  const gids = Object.keys(hourlyMap).filter((g) => hourlyMap[g].total > 0).sort((a, b) => hourlyMap[b].total - hourlyMap[a].total);
  const centerTotals = { GSSC: 0, GSSK: 0 };
  const centerHourTotals = { GSSC: {} as Record<number, number>, GSSK: {} as Record<number, number> };
  const hourTotals = {} as Record<number, number>;
  for (let i = 0; i < 24; i++) { centerHourTotals.GSSC[i] = 0; centerHourTotals.GSSK[i] = 0; hourTotals[i] = 0; }
  gids.forEach((gid) => {
    const c = hourlyMap[gid].center;
    if (c === 'GSSC') centerTotals.GSSC += hourlyMap[gid].total;
    else if (c === 'GSSK') centerTotals.GSSK += hourlyMap[gid].total;
    for (let i = 0; i < 24; i++) {
      const v = hourlyMap[gid].h[i] || 0;
      hourTotals[i] += v;
      if (c === 'GSSC') centerHourTotals.GSSC[i] += v;
      else if (c === 'GSSK') centerHourTotals.GSSK[i] += v;
    }
  });
  return {
    gids, hourlyMap, centerTotals, centerHourTotals, hourTotals,
    combinedTotal: centerTotals.GSSC + centerTotals.GSSK,
    showGSSC: ptCenter === 'both' || ptCenter === 'GSSC',
    showGSSK: ptCenter === 'both' || ptCenter === 'GSSK',
    filteredRows,
  };
}

async function renderPTImageToCanvas(
  model: PTHourlyModel,
  p: string,
  t: string,
  dateLabel: string,
  staff: Record<string, import('@/lib/types').StaffInfo>,
): Promise<HTMLCanvasElement> {
  try { await (document as any).fonts?.ready; } catch { /* ignore */ }

  const FONT_TITLE = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_SUB = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_HEAD = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_BODY = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_BODY_BOLD = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_HOUR = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_HOUR_BOLD = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_SUM_LABEL = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_SUM_VALUE = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const FONT_SUM_TITLE = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  const { firstHour, lastHour } = computeHourRange(model.hourTotals);
  const HOURS = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);

  const PAD = 24;
  const CX_GID = 90, CX_NAME = 170, CX_PRIMARY = 130, CX_TL = 160, CX_TOTAL = 90, CX_HOUR = 54;
  const COLS = [CX_GID, CX_NAME, CX_PRIMARY, CX_TL, CX_TOTAL, ...HOURS.map(() => CX_HOUR)];
  const TOTAL_W = COLS.reduce((a, b) => a + b, 0);
  const ROW_H = 28;
  const HEAD_H = 40;
  const TITLE_H = 48;
  const SUM_H = 52;
  const GAP = 16;

  const bodyRows = model.gids.length;
  const footRows = (model.showGSSC && model.centerTotals.GSSC > 0 ? 1 : 0)
                 + (model.showGSSK && model.centerTotals.GSSK > 0 ? 1 : 0) + 1;
  const tableH = HEAD_H + (bodyRows + footRows) * ROW_H;

  const W = TOTAL_W + PAD * 2;
  const H = PAD + TITLE_H + GAP + SUM_H + GAP + tableH + PAD;

  let SCALE = 2;
  if (H * SCALE > 15000 || W * SCALE > 15000) SCALE = 1;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  };
  const fillRect = (x: number, y: number, w: number, h: number, fill: string, r = 0) => {
    if (r > 0) { roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }
    else { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  };
  const text = (s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'left', maxW?: number) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (maxW !== undefined) ctx.fillText(s, x, y, maxW);
    else ctx.fillText(s, x, y);
  };

  fillRect(0, 0, W, H, '#0a0d12');

  text(`Hourly Report — ${p || '(all)'} / ${t || '(all)'}`, PAD, PAD + 12, FONT_TITLE, '#67e8f9');
  text(dateLabel, PAD, PAD + 34, FONT_SUB, '#94a3b8');

  const sumY = PAD + TITLE_H;
  fillRect(PAD, sumY, TOTAL_W, SUM_H, '#0d2c3a', 12);
  ctx.strokeStyle = 'rgba(6,182,212,0.25)';
  ctx.lineWidth = 1;
  roundRect(PAD + 0.5, sumY + 0.5, TOTAL_W - 1, SUM_H - 1, 12);
  ctx.stroke();

  const sumCY = sumY + SUM_H / 2;
  const summaryText = (p || t ? [p, t].filter(Boolean).join(' ') : 'Center-wise Total Output') + ' Output (' + dateLabel + ')';
  text(summaryText, PAD + 16, sumCY, FONT_SUM_TITLE, '#67e8f9');

  const items = [
    { label: 'GSSC', val: model.centerTotals.GSSC, color: '#60a5fa', dot: '#60a5fa' },
    { label: 'GSSK', val: model.centerTotals.GSSK, color: '#a78bfa', dot: '#a78bfa' },
    { label: 'Combined', val: model.combinedTotal, color: '#67e8f9', dot: '#22d3ee' },
  ];
  let rx = PAD + TOTAL_W - 16;
  for (let i = items.length - 1; i >= 0; i--) {
    const valStr = items[i].val.toLocaleString();
    ctx.font = FONT_SUM_VALUE;
    const vw = ctx.measureText(valStr).width;
    rx -= vw;
    text(valStr, rx, sumCY, FONT_SUM_VALUE, items[i].color);
    rx -= 8;
    ctx.font = FONT_SUM_LABEL;
    const lw = ctx.measureText(items[i].label).width;
    rx -= lw;
    text(items[i].label, rx, sumCY, FONT_SUM_LABEL, '#94a3b8');
    rx -= 10;
    rx -= 6;
    ctx.fillStyle = items[i].dot;
    ctx.beginPath();
    ctx.arc(rx + 3, sumCY, 3, 0, Math.PI * 2);
    ctx.fill();
    rx -= 20;
  }

  const tableX = PAD;
  const tableY = sumY + SUM_H + GAP;

  fillRect(tableX, tableY, TOTAL_W, HEAD_H, '#17233b');
  const headLabels = ['GID', 'Name', 'Primary', 'Team Leader', 'Total'];
  let cx = tableX;
  headLabels.forEach((label, i) => {
    text(label, cx + 8, tableY + HEAD_H / 2, FONT_HEAD, '#7dd3fc', 'left', COLS[i] - 16);
    cx += COLS[i];
  });
  for (const k of HOURS) {
    text(slotLabel(k), cx + CX_HOUR / 2, tableY + HEAD_H / 2, FONT_HEAD, '#7dd3fc', 'center');
    cx += CX_HOUR;
  }

  let y = tableY + HEAD_H;
  model.gids.forEach((gid, idx) => {
    const gd = model.hourlyMap[gid];
    const isG = gd.center === 'GSSC';
    const info = staff[nid(gid)] || ({ name: '—', primary: '—', tl: '—' } as any);
    const rowBg = idx % 2 === 0 ? '#11161f' : '#0d1118';
    fillRect(tableX, y, TOTAL_W, ROW_H, rowBg);

    let x = tableX;
    text(gid, x + 8, y + ROW_H / 2, FONT_BODY_BOLD, isG ? '#60a5fa' : '#a78bfa', 'left', CX_GID - 16);
    x += CX_GID;
    text(info.name || '—', x + 8, y + ROW_H / 2, FONT_BODY, '#cbd5e1', 'left', CX_NAME - 16);
    x += CX_NAME;
    text(info.primary || '—', x + 8, y + ROW_H / 2, FONT_BODY, '#e2e8f0', 'left', CX_PRIMARY - 16);
    x += CX_PRIMARY;
    text(info.tl || '—', x + 8, y + ROW_H / 2, FONT_BODY, '#94a3b8', 'left', CX_TL - 16);
    x += CX_TL;
    text(gd.total.toLocaleString(), x + CX_TOTAL / 2, y + ROW_H / 2, FONT_BODY_BOLD, isG ? '#60a5fa' : '#a78bfa', 'center');
    x += CX_TOTAL;

    for (const k of HOURS) {
      const v = gd.h[k] || 0;
      if (v > 0) {
        const val = v.toLocaleString();
        ctx.font = FONT_HOUR_BOLD;
        const tw = ctx.measureText(val).width;
        const bw = Math.min(tw + 10, CX_HOUR - 4);
        const bh = ROW_H - 10;
        fillRect(x + (CX_HOUR - bw) / 2, y + 5, bw, bh, isG ? 'rgba(59,130,246,0.22)' : 'rgba(139,92,246,0.22)', 4);
        text(val, x + CX_HOUR / 2, y + ROW_H / 2, FONT_HOUR_BOLD, isG ? '#bfdbfe' : '#ddd6fe', 'center');
      } else {
        text('—', x + CX_HOUR / 2, y + ROW_H / 2, FONT_HOUR, '#334155', 'center');
      }
      x += CX_HOUR;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tableX, y + ROW_H);
    ctx.lineTo(tableX + TOTAL_W, y + ROW_H);
    ctx.stroke();

    y += ROW_H;
  });

  const drawFooterRow = (label: string, total: number, hours: Record<number, number>, bg: string, fg: string, dim: string) => {
    fillRect(tableX, y, TOTAL_W, ROW_H, bg);
    let x = tableX;
    text(label, x + 8, y + ROW_H / 2, FONT_BODY_BOLD, fg);
    x += CX_GID + CX_NAME + CX_PRIMARY + CX_TL;
    text(total.toLocaleString(), x + CX_TOTAL / 2, y + ROW_H / 2, FONT_BODY_BOLD, fg, 'center');
    x += CX_TOTAL;
    for (const k of HOURS) {
      const v = hours[k] || 0;
      if (v > 0) text(v.toLocaleString(), x + CX_HOUR / 2, y + ROW_H / 2, FONT_HOUR_BOLD, fg, 'center');
      else text('—', x + CX_HOUR / 2, y + ROW_H / 2, FONT_HOUR, dim, 'center');
      x += CX_HOUR;
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(tableX, y + ROW_H);
    ctx.lineTo(tableX + TOTAL_W, y + ROW_H);
    ctx.stroke();
    y += ROW_H;
  };

  if (model.showGSSC && model.centerTotals.GSSC > 0) {
    drawFooterRow('GSSC', model.centerTotals.GSSC, model.centerHourTotals.GSSC, BG_GSSC, '#93c5fd', '#1e3a8a');
  }
  if (model.showGSSK && model.centerTotals.GSSK > 0) {
    drawFooterRow('GSSK', model.centerTotals.GSSK, model.centerHourTotals.GSSK, BG_GSSK, '#c4b5fd', '#4c1d95');
  }
  drawFooterRow('Combined', model.combinedTotal, model.hourTotals, BG_COMBINED, '#67e8f9', '#164e63');

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  let sepX = tableX;
  for (let i = 0; i < COLS.length - 1; i++) {
    sepX += COLS[i];
    ctx.beginPath();
    ctx.moveTo(sepX, tableY);
    ctx.lineTo(sepX, y);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.2)';
  ctx.strokeRect(tableX + 0.5, tableY + 0.5, TOTAL_W - 1, y - tableY - 1);

  return canvas;
}

export function ProjectTaskView() {
  const {
    ptProject, setPtProject, ptTask, setPtTask, ptCenter, setPtCenter,
    ptLive, doFetchPT, staff, tlList, setLeaderFilter,
    dateFilter, regionMaps, ptProjectList, ptProjectsLoaded, loadProjectSuggestions, search,
  } = useDashboard();
  const [selCats, setSelCats] = useState<string[]>([]);
  // Local multi-select TL filter (the shared single `leaderFilter` is left untouched for other tabs)
  const [selTLs, setSelTLs] = useState<string[]>([]);

  // Reset the shared single-TL filter when this view opens, so it can't interfere
  // (leaderFilter is shared state, so it may hold a TL picked in another tab)
  useEffect(() => {
    setLeaderFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cats = useMemo(() => {
    if (!ptLive) return [];
    return [...new Set(ptLive.map((r) => String(r.category || getRowCategory(r.project_name, r.task_name, r.template_name)).trim()).filter(Boolean))].sort();
  }, [ptLive]);

  const tlOptions = useMemo(() => {
    if (tlList.length) return tlList;
    return [...new Set(
      (ptLive || []).map((r) => r.team_leader || r.tl_name).filter(Boolean),
    )].sort() as string[];
  }, [tlList, ptLive]);

  const model = useMemo(
    () => buildPTHourlyModel(ptLive || [], ptCenter, selCats, cats.length > 0, selTLs, staff),
    [ptLive, ptCenter, selCats, cats.length, selTLs, staff],
  );

  const date = dateFilter || bizDate();
  const dateLabel = formatPTCaptionDate(date);
  const p = ptProject.trim();
  const t = ptTask.trim();
  const catLabel = cats.length > 0 ? selCats.join(', ') : '';

  const doImage = async (mode: 'copy' | 'download') => {
    if (!model) return;
    try {
      const title = `Hourly Report — ${p || '(all)'} / ${t || '(all)'} — ${date}`;
      const canvas = await renderPTImageToCanvas(model, p, t, dateLabel, staff);
      const fn = sanitizeName('Hourly-Report-' + (p || 'all') + '-' + (t || 'all') + '-' + date) + '.png';
      if (mode === 'copy') { const ok = await copyCanvas(canvas, title); if (!ok) downloadCanvas(canvas, fn); }
      else downloadCanvas(canvas, fn);
    } catch (e) { console.error(e); alert('Image export failed'); }
  };

  const doExcel = () => {
    if (!model) return;
    void exportPTExcel(model, p || '(all)', t || '(all)', date, dateLabel, catLabel, staff, regionMaps.region);
  };

  const ks = useMemo(() => {
    if (!model) return Array.from({ length: 24 }, (_, i) => i);
    const { firstHour, lastHour } = computeHourRange(model.hourTotals);
    return Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  }, [model]);

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onCopyImage={() => doImage('copy')}
        onDownloadImage={() => doImage('download')}
        onExportExcel={doExcel}
        showImageExport={!!ptLive}
        showExcelExport={!!ptLive}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 lg:px-6">
        <input
          className="input !py-1.5 text-xs"
          list="ptProjects"
          placeholder="Project name"
          value={ptProject}
          onFocus={() => !ptProjectsLoaded && loadProjectSuggestions()}
          onChange={(e) => setPtProject(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doFetchPT()}
        />
        <datalist id="ptProjects">{ptProjectList.map((x) => <option key={x} value={x} />)}</datalist>
        <TaskMultiSelect
          value={ptTask}
          onChange={setPtTask}
          options={TASK_OPTIONS}
          onEnter={doFetchPT}
        />
        <select className="input !py-1.5 text-xs" value={ptCenter} onChange={(e) => setPtCenter(e.target.value)}>
          <option value="both">Both Centers</option>
          <option value="GSSC">GSSC</option>
          <option value="GSSK">GSSK</option>
        </select>
        <TLMultiSelect selected={selTLs} onChange={setSelTLs} options={tlOptions} />
        <button className="btn btn-primary !py-1.5 text-xs" onClick={doFetchPT}>Fetch data</button>
      </div>

      {cats.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 lg:px-6">
          <span className="text-xs text-[var(--muted)]">Categories:</span>
          {cats.map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel2)] px-2.5 py-1 text-xs hover:border-teal-500/50">
              <input type="checkbox" checked={selCats.includes(c)} onChange={() => setSelCats((s) => s.includes(c) ? s.filter((x) => x !== c) : [...s, c])} />
              {c}
            </label>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto px-4 pb-6 lg:px-6">
        {!ptLive ? (
          <div className="card px-6 py-12 text-center text-[var(--muted)]">
            Enter a project name and select task(s), then click <b className="text-teal-300">Fetch data</b>.
            <div className="mt-2 text-xs">Tip: you can tick multiple tasks (e.g. <code className="text-cyan-300">voting, masking</code>) or type to filter the list.</div>
          </div>
        ) : !model || model.gids.length === 0 ? (
          <div className="card px-6 py-12 text-center text-[var(--muted)]">No data matches the selected filters.</div>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                {(p || t ? [p, t].filter(Boolean).join(' ') : 'Center-wise Total Output') + ' Output (' + dateLabel + ')'}
              </div>
              <div className="ml-auto flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-blue-400" /> GSSC <b className="text-blue-300 tabular-nums">{model.centerTotals.GSSC.toLocaleString()}</b></span>
                <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-violet-400" /> GSSK <b className="text-violet-300 tabular-nums">{model.centerTotals.GSSK.toLocaleString()}</b></span>
                <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-cyan-400" /> Combined <b className="text-cyan-300 tabular-nums">{model.combinedTotal.toLocaleString()}</b></span>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="card max-w-full overflow-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
                <table className="hrt w-auto table-auto border-separate border-spacing-0 text-[13px]" style={{ width: 'auto' }}>
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-cyan-300/80">
                      <th className="sticky z-10 bg-[#0a0d12] px-2 py-2 text-left" style={{ left: L_GID, ...fixW(W_GID) }}>GID</th>
                      <th className="sticky z-10 bg-[#0a0d12] px-2 py-2 text-left" style={{ left: L_NAME, ...fixW(W_NAME) }}>Name</th>
                      <th className="sticky z-10 bg-[#0a0d12] px-2 py-2 text-left" style={{ left: L_PRIMARY, ...fixW(W_PRIMARY) }}>Primary</th>
                      <th className="sticky z-10 bg-[#0a0d12] px-2 py-2 text-left" style={{ left: L_TL, ...fixW(W_TL) }}>Team Leader</th>
                      <th className="sticky z-10 bg-[#0a0d12] px-2 py-2 text-center" style={{ left: L_TOTAL, ...fixW(W_TOTAL) }}>Total</th>
                      {ks.map((k) => <th key={k} className="px-1.5 py-2 text-center">{slotLabel(k)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {model.gids.map((gid, idx) => {
                      const gd = model.hourlyMap[gid];
                      const isG = gd.center === 'GSSC';
                      const info = staff[nid(gid)] || ({ id: '', name: '—', primary: '—', tl: '—', doj: '' } as any);
                      const rowBg = idx % 2 === 0 ? 'bg-white/[0.015]' : '';
                      return (
                        <tr
                          key={gid}
                          data-gid={gid}
                          onClick={() => openGid(gid, model.filteredRows)}
                          className={`cursor-pointer hover:bg-white/[0.03] border-b border-white/[0.04] ${rowBg}`}
                        >
                          <td className="sticky z-[1] bg-[#0d1118] px-2 py-1.5 text-left font-bold" style={{ left: L_GID, ...fixW(W_GID), color: isG ? '#60a5fa' : '#a78bfa' }}>
                            <div className="truncate" style={{ maxWidth: W_GID - 16 }}>{gid}</div>
                          </td>
                          <td className="sticky z-[1] bg-[#0d1118] px-2 py-1.5 text-left text-slate-300" style={{ left: L_NAME, ...fixW(W_NAME) }}>
                            <div className="truncate" style={{ maxWidth: W_NAME - 16 }}>{info.name || '—'}</div>
                          </td>
                          <td className="sticky z-[1] bg-[#0d1118] px-2 py-1.5 text-left" style={{ left: L_PRIMARY, ...fixW(W_PRIMARY) }}>
                            <div className="truncate" style={{ maxWidth: W_PRIMARY - 16 }}>{info.primary || '—'}</div>
                          </td>
                          <td className="sticky z-[1] bg-[#0d1118] px-2 py-1.5 text-left text-[var(--muted)]" style={{ left: L_TL, ...fixW(W_TL) }}>
                            <div className="truncate" style={{ maxWidth: W_TL - 16 }}>{info.tl || '—'}</div>
                          </td>
                          <td className="sticky z-[1] bg-[#0d1118] px-2 py-1.5 text-center font-bold tabular-nums" style={{ left: L_TOTAL, ...fixW(W_TOTAL), color: isG ? '#60a5fa' : '#a78bfa' }}>{gd.total.toLocaleString()}</td>
                          {ks.map((k) => {
                            const v = gd.h[k] || 0;
                            return v > 0 ? (
                              <td key={k} className="px-1 py-1.5 text-center">
                                <span className={`inline-block rounded px-1 py-0.5 font-semibold tabular-nums ${isG ? 'bg-blue-500/15 text-blue-300' : 'bg-violet-500/15 text-violet-300'}`}>{v.toLocaleString()}</span>
                              </td>
                            ) : <td key={k} className="px-1 py-1.5 text-center text-slate-700">—</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {model.showGSSC && model.centerTotals.GSSC > 0 && (
                      <tr className="font-bold">
                        <td className="sticky z-[1] px-2 py-2 text-blue-300" style={{ left: L_GID, ...fixW(W_GID), backgroundColor: BG_GSSC }}>GSSC</td>
                        <td colSpan={3} className="sticky z-[1]" style={{ left: L_NAME, backgroundColor: BG_GSSC }} />
                        <td className="sticky z-[1] px-2 py-2 text-center text-blue-300 tabular-nums" style={{ left: L_TOTAL, ...fixW(W_TOTAL), backgroundColor: BG_GSSC }}>{model.centerTotals.GSSC.toLocaleString()}</td>
                        {ks.map((k) => { const v = model.centerHourTotals.GSSC[k] || 0; return <td key={k} className="px-1 py-2 text-center text-blue-300 tabular-nums" style={{ backgroundColor: BG_GSSC }}>{v > 0 ? v.toLocaleString() : <span className="text-blue-900">—</span>}</td>; })}
                      </tr>
                    )}
                    {model.showGSSK && model.centerTotals.GSSK > 0 && (
                      <tr className="font-bold">
                        <td className="sticky z-[1] px-2 py-2 text-violet-300" style={{ left: L_GID, ...fixW(W_GID), backgroundColor: BG_GSSK }}>GSSK</td>
                        <td colSpan={3} className="sticky z-[1]" style={{ left: L_NAME, backgroundColor: BG_GSSK }} />
                        <td className="sticky z-[1] px-2 py-2 text-center text-violet-300 tabular-nums" style={{ left: L_TOTAL, ...fixW(W_TOTAL), backgroundColor: BG_GSSK }}>{model.centerTotals.GSSK.toLocaleString()}</td>
                        {ks.map((k) => { const v = model.centerHourTotals.GSSK[k] || 0; return <td key={k} className="px-1 py-2 text-center text-violet-300 tabular-nums" style={{ backgroundColor: BG_GSSK }}>{v > 0 ? v.toLocaleString() : <span className="text-violet-900">—</span>}</td>; })}
                      </tr>
                    )}
                    <tr className="font-bold">
                      <td className="sticky z-[1] px-2 py-2 text-cyan-300" style={{ left: L_GID, ...fixW(W_GID), backgroundColor: BG_COMBINED }}>Combined</td>
                      <td colSpan={3} className="sticky z-[1]" style={{ left: L_NAME, backgroundColor: BG_COMBINED }} />
                      <td className="sticky z-[1] px-2 py-2 text-center text-cyan-300 tabular-nums" style={{ left: L_TOTAL, ...fixW(W_TOTAL), backgroundColor: BG_COMBINED }}>{model.combinedTotal.toLocaleString()}</td>
                      {ks.map((k) => { const v = model.hourTotals[k] || 0; return <td key={k} className="px-1 py-2 text-center text-cyan-300 tabular-nums" style={{ backgroundColor: BG_COMBINED }}>{v > 0 ? v.toLocaleString() : <span className="text-cyan-900">—</span>}</td>; })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            <div className="mt-2 text-xs text-[var(--muted)]">{model.gids.length.toLocaleString()} staff</div>
          </div>
        )}
      </div>
    </div>
  );
}