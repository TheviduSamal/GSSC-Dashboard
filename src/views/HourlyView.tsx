import { Dispatch, Fragment, SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDashboard } from '@/hooks/useDashboardData';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { ref, onValue } from 'firebase/database';
import { TopBar } from '@/components/TopBar';
import { openGid } from '@/components/GidModal';
import { cap, hourlyRows, nid, num, slotLabel, bizDate, sanitizeName } from '@/lib/data';
import { tlStaff } from '@/lib/staff';
import { captureTableImage, copyCanvas, downloadCanvas, exportHourlyExcel } from '@/lib/export';
import { HOURLY_FREEZE } from '@/lib/constants';
import type { HourlyStaff } from '@/lib/types';

const COL_ID = 90;
const COL_NAME = 140;
const COL_TL = 140;
const COL_PRIMARY = 120;
const COL_SS = 130;
const COL_REGION = 110;
const COL_WD = 72;

const L_NAME = COL_ID;
const L_TL = L_NAME + COL_NAME;
const L_PRIMARY = L_TL + COL_TL;
const L_SS = L_PRIMARY + COL_PRIMARY;
const L_REGION = L_SS + COL_SS;
const L_WD = L_REGION + COL_REGION;

const HEAD_ROW_H = 36;
const TARGET = 370;

const S_NUM = 56;
const S_ID = 110;
const S_NAME = 170;
const S_PRIMARY = 140;
const SL_ID = S_NUM;
const SL_NAME = SL_ID + S_ID;
const SL_PRIMARY = SL_NAME + S_NAME;
const S_WD = 110;
const S_TGT = 130;
const S_TL = 150;
const SL_TL = SL_PRIMARY + S_PRIMARY;
const SL_WD = SL_TL + S_TL;
const SL_TGT = SL_WD + S_WD;

const fixW = (w: number) => ({ width: w, minWidth: w, maxWidth: w });

const byWdDesc = (a: HourlyStaff, b: HourlyStaff) => b.wd - a.wd;

type StaffMeta = { ss: string; region: string; tl: string };

// ── Column filter helpers ───────────────────────────────────────────
type Filters = Record<string, string[]>;

function applyFilters<T>(rows: T[], filters: Filters, getVal: (row: T, key: string) => string): T[] {
  const active = Object.entries(filters).filter(([, v]) => v && v.length > 0);
  if (active.length === 0) return rows;
  return rows.filter((r) => active.every(([k, v]) => v.includes(getVal(r, k))));
}

function sortedUnique(vals: string[]): string[] {
  return Array.from(new Set(vals)).sort((a, b) => {
    if (a === '—') return 1;
    if (b === '—') return -1;
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

const countActive = (f: Filters) => Object.values(f).filter((v) => v && v.length > 0).length;

const joinLabel = (list: string[], noun: string) => (list.length <= 2 ? list.join(', ') : `${list.length} ${noun}`);

// ── Searchable multi-select dropdown (Team Leader / Shift Sup / Region) ──
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 240 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openMenu = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - 268)),
      minWidth: Math.max(r.width, 240),
    });
    setSearch('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const shown = useMemo(
    () => (search ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase())) : options),
    [options, search]
  );

  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  const allShownSelected = shown.length > 0 && shown.every((o) => selected.includes(o));
  const toggleAllShown = () =>
    onChange(
      allShownSelected
        ? selected.filter((x) => !shown.includes(x))
        : Array.from(new Set([...selected, ...shown]))
    );

  const text =
    selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${label}: ${selected.length} selected`;
  const active = selected.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={active ? selected.join(', ') : placeholder}
        className={`input !py-1.5 flex max-w-[260px] items-center gap-2 text-xs ${active ? 'border-sky-400/50 text-sky-200' : ''}`}
      >
        <span className="truncate">{text}</span>
        {selected.length > 1 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500/80 px-1 text-[9px] font-bold text-white">
            {selected.length}
          </span>
        )}
        <svg className="h-3 w-3 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 99999 }}
            className="overflow-hidden rounded-xl border border-white/10 bg-[#17233b] text-left text-[13px] font-normal shadow-2xl"
          >
            <div className="border-b border-white/10 p-2">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label}...`}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-sky-400/40 focus:outline-none"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {shown.length > 0 && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); toggleAllShown(); }}
                  className="w-full border-b border-white/5 px-4 py-2 text-left text-sm text-white/60 hover:bg-white/5"
                >
                  {allShownSelected ? 'Deselect All' : search ? 'Select All (filtered)' : 'Select All'}
                </button>
              )}
              {shown.length === 0 ? (
                <div className="px-4 py-2 text-sm text-white/30">No results found</div>
              ) : (
                shown.map((o) => {
                  const on = selected.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-white/5 ${on ? 'bg-sky-500/20 text-sky-200' : 'text-white/80'}`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-sky-500 bg-sky-500' : 'border-white/30'}`}>
                        {on && (
                          <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{o}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2">
              <span className="pl-1 text-[11px] text-white/40">{selected.length} selected</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!active}
                  onMouseDown={(e) => { e.preventDefault(); onChange([]); }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10 disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-400"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

// Header cell: click the text to open a checkbox filter dropdown (no icon).
function FilterTh({
  label,
  filterKey,
  filters,
  setFilters,
  getOptions,
  className = '',
  style,
  rowSpan,
  colSpan,
}: {
  label: string;
  filterKey: string;
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  getOptions: () => string[];
  className?: string;
  style?: React.CSSProperties;
  rowSpan?: number;
  colSpan?: number;
}) {
  const selected = filters[filterKey] || [];
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 200 });
  const thRef = useRef<HTMLTableCellElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openMenu = () => {
    const el = thRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - 248)),
      minWidth: Math.max(r.width, 200),
    });
    setOpts(getOptions());
    setDraft(selected);
    setSearch('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (thRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const shown = useMemo(
    () => (search ? opts.filter((o) => o.toLowerCase().includes(search.toLowerCase())) : opts),
    [opts, search]
  );

  const toggle = (o: string) => setDraft((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const allSelected = opts.length > 0 && draft.length === opts.length;
  const apply = () => {
    setFilters((prev) => ({ ...prev, [filterKey]: draft }));
    setOpen(false);
  };

  const active = selected.length > 0;

  return (
    <>
      <th
        ref={thRef}
        rowSpan={rowSpan}
        colSpan={colSpan}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`${className} cursor-pointer select-none hover:text-white ${active ? 'text-sky-300' : ''}`}
        style={style}
        title="Click to filter"
      >
        {label}
        {active && (
          <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-500/80 px-1 text-[9px] font-bold text-white">
            {selected.length}
          </span>
        )}
      </th>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 99999 }}
            className="overflow-hidden rounded-xl border border-white/10 bg-[#17233b] text-left text-[13px] font-normal shadow-2xl"
          >
            <div className="border-b border-white/10 p-2">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label}...`}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white focus:border-sky-400/40 focus:outline-none"
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setDraft(allSelected ? [] : [...opts]); }}
                className="w-full border-b border-white/5 px-4 py-2 text-left text-sm text-white/60 hover:bg-white/5"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
              {shown.length === 0 ? (
                <div className="px-4 py-2 text-sm text-white/30">No results found</div>
              ) : (
                shown.map((o) => {
                  const on = draft.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-white/5 ${on ? 'bg-sky-500/20 text-sky-200' : 'text-white/80'}`}
                    >
                      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-sky-500 bg-sky-500' : 'border-white/30'}`}>
                        {on && (
                          <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <span className="truncate">{o}</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-white/10 p-2">
              <span className="pl-1 text-[11px] text-white/40">{draft.length} selected</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); apply(); }}
                  className="rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-400"
                >
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

const SS_FIELDS = [
  'shift_sup', 'shiftSup', 'shift_supervisor', 'shiftSupervisor',
  'shift_sup_name', 'shiftSupName', 'shiftsup', 'shift_sup_id',
  'shift', 'supervisor', 'supervisor_name', 'supervisorName',
  'ss', 'shift_lead', 'shiftLead', 'shift_head', 'shiftHead',
  'reports_to', 'reportsTo', 'manager', 'manager_name',
];

const TL_FIELDS = [
  'team_leader', 'teamLead', 'team_lead', 'teamleader', 'tl', 'tl_name', 'tlName',
];

// Region comes from the REGION column of the staff sheet
const REGION_FIELDS = ['region', 'Region', 'REGION'];

const upRegion = (s: string) => String(s || '').toUpperCase().trim();

// users/{uid}/regions may come back as an array or an index-keyed object
function toRegionList(v: any): string[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [];
  return Array.from(new Set(list.map((x) => upRegion(String(x))).filter(Boolean)));
}

function extractName(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    return String(
      v.name || v.displayName || v.display_name || v.fullName ||
      v.full_name || v.email || v.id || v.value || ''
    );
  }
  return String(v);
}

function normalizeName(s: any): string {
  return extractName(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripOtl(s: string): string {
  return s.replace(/-?otl\b/gi, '').replace(/\s+/g, ' ').trim();
}

function nameMatches(a: any, b: any, loose = false): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (stripOtl(na) === stripOtl(nb)) return true;
  if (loose && (na.includes(nb) || nb.includes(na))) return true;
  if (loose && (stripOtl(na).includes(stripOtl(nb)) || stripOtl(nb).includes(stripOtl(na)))) return true;
  return false;
}

function toStaffArray(staff: any): any[] {
  if (!staff) return [];
  if (Array.isArray(staff)) return staff;
  if (typeof staff === 'object') {
    return Object.entries(staff).map(([key, val]: [string, any]) => {
      if (val && typeof val === 'object') {
        return {
          ...val,
          id: val.id ?? val.gid ?? val.staff_id ?? val.staffId ?? key,
        };
      }
      return { id: key, name: String(val) };
    });
  }
  return [];
}

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const SS_KEYS = new Set(SS_FIELDS.map(normKey));
const TL_KEYS = new Set(TL_FIELDS.map(normKey));

function getFieldValue(obj: any, fields: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null) continue;
    const s = extractName(v);
    if (s) return s;
  }
  const wanted = fields === SS_FIELDS ? SS_KEYS : fields === TL_FIELDS ? TL_KEYS : new Set(fields.map(normKey));
  const byKey = new Map<string, any>();
  for (const k of Object.keys(obj)) {
    const nk = normKey(k);
    if (wanted.has(nk) && !byKey.has(nk)) byKey.set(nk, obj[k]);
  }
  for (const f of fields) {
    const v = byKey.get(normKey(f));
    if (v === undefined || v === null) continue;
    const s = extractName(v);
    if (s) return s;
  }
  return '';
}

function rowTLName(r: any): string {
  return getFieldValue(r, TL_FIELDS);
}

function findTLsForShiftSup(staffList: any[], shiftSup: string): string[] {
  if (!staffList.length || !shiftSup) return [];
  const byNorm = new Map<string, string>();
  const addTL = (s: any) => {
    const tl = getFieldValue(s, TL_FIELDS);
    if (!tl) return;
    const n = normalizeName(tl);
    if (!n) return;
    if (!byNorm.has(n)) byNorm.set(n, tl.trim());
  };
  for (const s of staffList) {
    if (!s || typeof s !== 'object') continue;
    const ss = getFieldValue(s, SS_FIELDS);
    if (!ss) continue;
    if (nameMatches(ss, shiftSup)) addTL(s);
  }
  if (byNorm.size === 0) {
    for (const s of staffList) {
      if (!s || typeof s !== 'object') continue;
      const ss = getFieldValue(s, SS_FIELDS);
      if (!ss) continue;
      if (nameMatches(ss, shiftSup, true)) addTL(s);
    }
  }
  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
}

function listShiftSups(staffList: any[]): string[] {
  const byNorm = new Map<string, string>();
  for (const s of staffList) {
    if (!s || typeof s !== 'object') continue;
    const ss = getFieldValue(s, SS_FIELDS);
    const n = normalizeName(ss);
    if (n && !byNorm.has(n)) byNorm.set(n, ss.trim());
  }
  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeApiList(d: any): any[] {
  if (!d) return [];
  const data = d.data ?? d;
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    if (data.rows || data.tl_name || data.team_leader || data.teamLead || data.tl) {
      return [data];
    }
    return Object.values(data);
  }
  return [];
}

function parseFetchAll(d: any): any[] {
  const list = normalizeApiList(d);
  const out: any[] = [];
  for (const t of list as any[]) {
    if (!t) continue;
    if (t.error) continue;
    const rs = t.rows ?? (Array.isArray(t) ? t : []);
    const tlName = t.tl_name || t.team_leader || t.teamLead || t.tl || t.name || '';
    (rs || []).forEach((r: any) => {
      out.push({
        ...r,
        team_leader: r.team_leader || r.teamLead || r.tl || r.tl_name || tlName || '',
      });
    });
  }
  return out;
}

// Scope rows to one or many team leaders
function scopeToLeaders(base: any[], leaders: string[], staffList: any[]): any[] {
  const wanted = leaders.filter(Boolean);
  if (!wanted.length) return [];
  const ids = new Set<string>();
  for (const l of wanted) for (const s of tlStaff(l, staffList as any)) ids.add(nid(s.id));
  if (ids.size) return base.filter((r) => ids.has(nid(r.staff_id)));
  return base.filter((r) => wanted.some((l) => nameMatches(rowTLName(r), l)));
}

type MetFilter = 'all' | 'met' | 'not';
type DenoMode = 'without' | 'with';

const TASK_COLS = [
  { key: 'validation', label: 'Validation' },
  { key: 'offline_val', label: 'Offline Val' },
  { key: 'voting', label: 'Voting' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'pricing_vote', label: 'Pricing Vote' },
  { key: 'ev', label: 'EV' },
  { key: 'posm', label: 'POSM' },
  { key: 'sr', label: 'S/R' },
  { key: 'masking', label: 'Masking' },
] as const;
type TaskKey = (typeof TASK_COLS)[number]['key'] | 'stitching';
type TaskCounts = Record<TaskKey, number>;

const emptyCounts = (): TaskCounts => ({
  validation: 0, offline_val: 0, voting: 0, pricing: 0, pricing_vote: 0, ev: 0, posm: 0, sr: 0, masking: 0, stitching: 0,
});

const TASK_FIELDS = ['task', 'task_name', 'task_type', 'type', 'category', 'project'];

const OUTPUT_FIELDS = ['output', 'wo', 'w_o', 'work_output', 'workOutput', 'total_output', 'totalOutput', 'count', 'qty'];
const DENO_FIELDS = ['deno_output', 'denoOutput', 'deno', 'denominator', 'denominator_output', 'denominatorOutput', 'deno_wo'];

const TASK_MAP: Record<string, TaskKey> = {
  validation: 'validation',
  total_validation: 'validation',
  offline_validation: 'offline_val',
  offline_voting: 'offline_val',
  voting: 'voting',
  vote: 'voting',
  offline_pricing: 'pricing',
  pricing_voting: 'pricing_vote',
  voting_engine: 'ev',
  ev: 'ev',
  offline_posm: 'posm',
  posm_voting: 'posm',
  scene_recognition: 'sr',
  sr: 'sr',
  masking: 'masking',
  masking_price_labels: 'masking',
  masking_menu_items: 'masking',
  masking_engine: 'masking',
  special_masking: 'masking',
  posm_masking: 'masking',
  stitching: 'stitching',
};

function taskOf(r: any): TaskKey | null {
  let raw = '';
  for (const f of TASK_FIELDS) {
    if (r?.[f]) { raw = String(r[f]); break; }
  }
  const t = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (!t) return null;
  if (TASK_MAP[t]) return TASK_MAP[t];
  if (t.includes('stitch')) return 'stitching';
  if (t.includes('mask')) return 'masking';
  if (t.includes('offline') && t.includes('val')) return 'offline_val';
  if (t.includes('offline') && t.includes('vot')) return 'offline_val';
  if (t.includes('offline') && t.includes('posm')) return 'posm';
  if (t.includes('posm')) return 'posm';
  if (t.includes('pric') && t.includes('vot')) return 'pricing_vote';
  if (t.includes('voting_engine')) return 'ev';
  if (t.includes('offline') && t.includes('pric')) return 'pricing';
  if (t.includes('scene')) return 'sr';
  if (t.includes('valid')) return 'validation';
  return null;
}

function readNum(r: any, fields: string[]): number | null {
  for (const f of fields) {
    const v = r?.[f];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function outputOf(r: any, mode: DenoMode): number {
  const base = readNum(r, OUTPUT_FIELDS);
  const deno = mode === 'with' ? readNum(r, DENO_FIELDS) : null;
  if (base === null && deno === null) return 1;
  return (base ?? 0) + (deno ?? 0);
}

const fmtOut = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#0f1726] px-4 py-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="text-[11px] font-semibold text-[var(--muted)]">{label}</div>
      <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

const CHART_H = 200;
const LABEL_H = 96;

function UserBarChart({ rows: src }: { rows: HourlyStaff[] }) {
  const rows = [...src].sort(byWdDesc);
  const top = Math.max(TARGET, ...rows.map((s) => s.wd), 100);
  const axisMax = Math.ceil(top / 100) * 100;
  const ticks: number[] = [];
  for (let v = 0; v <= axisMax; v += 100) ticks.push(v);
  const y = (v: number) => CHART_H - (v / axisMax) * CHART_H;

  return (
    <div className="overflow-x-auto">
      <div className="flex" style={{ minWidth: Math.max(rows.length * 46 + 48, 480) }}>
        <div className="relative shrink-0" style={{ width: 44, height: CHART_H }}>
          {ticks.map((v) => (
            <div key={v} className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--muted)]" style={{ top: y(v) }}>
              {v}
            </div>
          ))}
        </div>

        <div className="relative flex-1">
          <div className="relative" style={{ height: CHART_H }}>
            {ticks.map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-white/[0.07]" style={{ top: y(v) }} />
            ))}
            <div className="absolute inset-x-0 border-t border-dashed border-amber-300/70" style={{ top: y(TARGET) }} />
            <div className="absolute right-0 -translate-y-full pr-1 text-[10px] text-amber-300/90" style={{ top: y(TARGET) }}>
              Target {TARGET}
            </div>
            <div className="absolute inset-0 flex">
              {rows.map((s) => {
                const ok = s.wd >= TARGET;
                const h = Math.max((s.wd / axisMax) * CHART_H, s.wd > 0 ? 4 : 2);
                return (
                  <div key={s.id} className="relative flex-1" title={`${s.name}: ${s.wd.toFixed(2)} WD`}>
                    <div
                      className={`absolute bottom-0 left-1/2 w-3 -translate-x-1/2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500/85'}`}
                      style={{ height: h }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex" style={{ height: LABEL_H }}>
            {rows.map((s) => (
              <div key={s.id} className="relative flex-1">
                <span
                  className="absolute left-1/2 top-2 whitespace-nowrap text-[11px] text-[var(--muted)]"
                  style={{ transform: 'translateX(-100%) rotate(-35deg)', transformOrigin: '100% 0' }}
                >
                  {s.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryView({ rows, rawRows, role, leader }: { rows: HourlyStaff[]; rawRows: any[]; role: string | null; leader: string }) {
  const [flt, setFlt] = useState<MetFilter>('all');
  const [denoMode, setDenoMode] = useState<DenoMode>('without');
  const [colF, setColF] = useState<Filters>({});

  const counts = useMemo(() => {
    const m = new Map<string, TaskCounts>();
    for (const r of rawRows) {
      const k = taskOf(r);
      if (!k) continue;
      const id = nid(r.staff_id);
      let c = m.get(id);
      if (!c) { c = emptyCounts(); m.set(id, c); }
      c[k] += outputOf(r, denoMode);
    }
    return m;
  }, [rawRows, denoMode]);

  const getC = (id: string) => counts.get(nid(id)) || emptyCounts();

  const rowVal = (s: HourlyStaff, key: string): string => {
    switch (key) {
      case 'id': return cap(s.id);
      case 'name': return s.name;
      case 'primary': return s.primary;
      case 'tl': return s.tl || '—';
      case 'wd': return s.wd.toFixed(2);
      case 'status': return s.wd >= TARGET ? 'Met' : 'Not Met';
      default: {
        const n = getC(s.id)[key as TaskKey] ?? 0;
        return n > 0 ? fmtOut(n) : '—';
      }
    }
  };

  const sorted = useMemo(() => [...rows].sort(byWdDesc), [rows]);
  const total = sorted.length;
  const met = sorted.filter((s) => s.wd >= TARGET).length;
  const notMet = total - met;
  const active = sorted.filter((s) => s.wo > 0 || s.wd > 0).length;
  const pct = total ? (met / total) * 100 : 0;

  const pillList = flt === 'met' ? sorted.filter((s) => s.wd >= TARGET) : flt === 'not' ? sorted.filter((s) => s.wd < TARGET) : sorted;
  const list = applyFilters(pillList, colF, rowVal);
  const activeCols = countActive(colF);

  const optionsFor = (key: string) => () => sortedUnique(sorted.map((s) => rowVal(s, key)));

  const pill = (k: MetFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFlt(k)}
      className={`rounded-md px-3 py-1 text-xs font-semibold ${flt === k ? 'bg-white/10 text-white' : 'text-[var(--muted)] hover:text-white'}`}
    >
      {label}
    </button>
  );

  const cell = (n: number) => (n > 0 ? <span className="font-semibold text-emerald-300">{fmtOut(n)}</span> : <span className="text-slate-700">—</span>);
  const th = 'sticky top-0 z-10 bg-[#17233b] px-4 py-3 text-[13px]';
  const thF = 'sticky top-0 z-30 bg-[#17233b] px-4 py-3 text-[13px]';
  const tdF = 'sticky z-[1] bg-[#0f1726] px-4 py-2.5 group-hover:bg-[#162033]';
  const edge = { boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)' };

  const fth = (key: string, label: string, cls: string, style?: React.CSSProperties) => (
    <FilterTh
      key={key}
      label={label}
      filterKey={key}
      filters={colF}
      setFilters={setColF}
      getOptions={optionsFor(key)}
      className={cls}
      style={style}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Active staff" value={`${active}`} sub={`of ${total} staff`} color="#10b981" />
        <Kpi label="Idle" value={`${total - active}`} sub="no output" color="#f59e0b" />
        <Kpi label="Role" value={role || '—'} sub={leader || 'All team leaders'} color="#a78bfa" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card flex flex-col items-center gap-4 p-4">
          <div className="self-start text-sm font-bold">Met / Not Met %</div>
          <div
            className="relative h-44 w-44 rounded-full"
            style={{ background: total ? `conic-gradient(#10b981 0 ${pct}%, #ef4444 ${pct}% 100%)` : '#1e293b' }}
          >
            <div className="absolute inset-[22px] flex flex-col items-center justify-center rounded-full bg-[#0b1220]">
              <div className="text-2xl font-extrabold">{pct.toFixed(0)}%</div>
              <div className="text-[11px] text-[var(--muted)]">met</div>
            </div>
          </div>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Met ({met})</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />Not Met ({notMet})</span>
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-sm font-bold">User-wise WD vs Target ({TARGET})</div>
          <UserBarChart rows={sorted} />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="text-base font-bold">Summary</div>
          <span className="text-xs text-[var(--muted)]">{list.length} of {total} members</span>
          <select
            className="input !py-1.5 text-xs"
            value={denoMode}
            onChange={(e) => setDenoMode(e.target.value as DenoMode)}
          >
            <option value="without">Without Deno Output</option>
            <option value="with">With Deno Output</option>
          </select>
          {activeCols > 0 && (
            <button
              type="button"
              onClick={() => setColF({})}
              className="rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
            >
              Clear filters ({activeCols})
            </button>
          )}
          <div className="ml-auto flex gap-1 rounded-lg bg-white/[0.04] p-1">
            {pill('all', `All (${total})`)}
            {pill('met', `Met (${met})`)}
            {pill('not', `Not Met (${notMet})`)}
          </div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 120px)', minHeight: 480 }}>
          <table className="w-full border-separate border-spacing-0 whitespace-nowrap text-center text-[15px]">
            <thead>
              <tr>
                <th className={thF} style={{ left: 0, ...fixW(S_NUM) }}>#</th>
                {fth('id', 'Staff ID', `${thF} text-left`, { left: SL_ID, ...fixW(S_ID) })}
                {fth('name', 'Name', `${thF} text-left`, { left: SL_NAME, ...fixW(S_NAME) })}
                {fth('primary', 'Primary', `${thF} text-left`, { left: SL_PRIMARY, ...fixW(S_PRIMARY) })}
                {fth('tl', 'Team Leader', `${thF} text-left`, { left: SL_TL, ...fixW(S_TL) })}
                {fth('wd', 'Total WD', thF, { left: SL_WD, ...fixW(S_WD) })}
                {fth('status', `Target (${TARGET})`, thF, { left: SL_TGT, ...fixW(S_TGT), ...edge })}
                {TASK_COLS.map((c) => fth(c.key, c.label, th))}
                {fth('stitching', 'Per Probe', th)}
              </tr>
            </thead>
            <tbody>
              {list.map((s, i) => {
                const ok = s.wd >= TARGET;
                const diff = Math.round(s.wd - TARGET);
                const c = getC(s.id);
                return (
                  <tr key={s.id} onClick={() => openGid(s.id, rawRows)} className="group cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className={`${tdF} text-[var(--muted)]`} style={{ left: 0, ...fixW(S_NUM) }}>{i + 1}</td>
                    <td className={`${tdF} text-left font-bold text-teal-300`} style={{ left: SL_ID, ...fixW(S_ID) }}>
                      <div className="truncate" style={{ maxWidth: S_ID - 32 }}>{cap(s.id)}</div>
                    </td>
                    <td className={`${tdF} text-left font-semibold`} style={{ left: SL_NAME, ...fixW(S_NAME) }}>
                      <div className="truncate" style={{ maxWidth: S_NAME - 32 }}>{s.name}</div>
                    </td>
                    <td className={`${tdF} text-left`} style={{ left: SL_PRIMARY, ...fixW(S_PRIMARY) }}>
                      <div className="truncate" style={{ maxWidth: S_PRIMARY - 32 }}>{s.primary}</div>
                    </td>
                    <td className={`${tdF} text-left text-[var(--muted)]`} style={{ left: SL_TL, ...fixW(S_TL) }}>
                      <div className="truncate" style={{ maxWidth: S_TL - 32 }}>{s.tl || '—'}</div>
                    </td>
                    <td className={`${tdF} font-bold text-sky-300`} style={{ left: SL_WD, ...fixW(S_WD) }}>{s.wd.toFixed(2)}</td>
                    <td className={tdF} style={{ left: SL_TGT, ...fixW(S_TGT), ...edge }}>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                        {ok ? `✓ (+${diff})` : `✕ (${diff})`}
                      </span>
                    </td>
                    {TASK_COLS.map((col) => <td key={col.key} className="px-4 py-2.5">{cell(c[col.key])}</td>)}
                    <td className="px-4 py-2.5">{cell(c.stitching)}</td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={7 + TASK_COLS.length + 1} className="px-6 py-10 text-center text-sm text-[var(--muted)]">
                    No rows match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HourlyTable({
  visible,
  ks,
  rows,
  meta,
  exportMode = false,
  filters,
  setFilters,
  getOptions,
}: {
  visible: HourlyStaff[];
  ks: number[];
  rows: any[];
  meta: Record<string, StaffMeta>;
  exportMode?: boolean;
  filters?: Filters;
  setFilters?: Dispatch<SetStateAction<Filters>>;
  getOptions?: (key: string) => string[];
}) {
  const metaOf = (id: string): StaffMeta => meta[nid(id)] || { ss: '', region: '', tl: '' };

  if (exportMode) {
    return (
      <table className="border-separate border-spacing-0 whitespace-nowrap text-center text-[13px]">
        <thead>
          <tr>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Staff ID</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Name</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Team Leader</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Primary</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Shift Sup</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2 text-left">Region</th>
            <th rowSpan={2} className="bg-[#17233b] px-3 py-2">Total WD</th>
            {ks.map((k) => (
              <th key={k} colSpan={2} className="bg-[#17233b] px-3 py-2">{slotLabel(k)}</th>
            ))}
          </tr>
          <tr>
            {ks.map((k) => (
              <Fragment key={k}>
                <th className="bg-[#17233b] px-2 py-1 text-[11px] text-sky-300">WD</th>
                <th className="bg-[#17233b] px-2 py-1 text-[11px] text-emerald-300">W/O</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((s) => {
            const m = metaOf(s.id);
            return (
              <tr key={s.id} className="border-b border-white/[0.04]">
                <td className="bg-[#0f1726] px-3 py-1.5 text-left font-bold text-teal-300">{cap(s.id)}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 text-left">{s.name}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 text-left text-[var(--muted)]">{s.tl}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 text-left">{s.primary}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 text-left text-[var(--muted)]">{m.ss || '—'}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 text-left">{m.region || '—'}</td>
                <td className="bg-[#0f1726] px-3 py-1.5 font-bold">{s.wd.toFixed(2)}</td>
                {ks.map((k) => {
                  const c = s.h[k];
                  if (c && c.wd > 0) {
                    const cls = c.wd < 35 ? 'text-amber-300 bg-amber-500/10' : c.wd > 100 ? 'text-rose-300 bg-rose-500/10' : 'text-emerald-300 bg-emerald-500/10';
                    return (
                      <Fragment key={k}>
                        <td className={`px-2 py-1.5 font-semibold ${cls}`}>{c.wd.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-sky-300">{Math.round(c.wo)}</td>
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={k}>
                      <td className="px-2 py-1.5 text-slate-700">—</td>
                      <td className="px-2 py-1.5 text-slate-700">—</td>
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const f = filters || {};
  const setF = setFilters as Dispatch<SetStateAction<Filters>>;
  const opt = (key: string) => () => (getOptions ? getOptions(key) : []);
  const fth = (key: string, label: string, cls: string, style: React.CSSProperties, extra?: { rowSpan?: number; colSpan?: number }) => (
    <FilterTh
      key={key}
      label={label}
      filterKey={key}
      filters={f}
      setFilters={setF}
      getOptions={opt(key)}
      className={cls}
      style={style}
      rowSpan={extra?.rowSpan}
      colSpan={extra?.colSpan}
    />
  );

  return (
    <table
      className="hrt w-auto table-auto border-separate border-spacing-0 whitespace-nowrap text-center text-[13px]"
      style={{ width: 'auto' }}
    >
      <thead>
        <tr>
          {fth('id', 'Staff ID', 'fz sticky left-0 top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { height: HEAD_ROW_H, ...fixW(COL_ID) }, { rowSpan: 2 })}
          {fth('name', 'Name', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { left: L_NAME, height: HEAD_ROW_H, ...fixW(COL_NAME) }, { rowSpan: 2 })}
          {fth('tl', 'Team Leader', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { left: L_TL, height: HEAD_ROW_H, ...fixW(COL_TL) }, { rowSpan: 2 })}
          {fth('primary', 'Primary', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { left: L_PRIMARY, height: HEAD_ROW_H, ...fixW(COL_PRIMARY) }, { rowSpan: 2 })}
          {fth('ss', 'Shift Sup', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { left: L_SS, height: HEAD_ROW_H, ...fixW(COL_SS) }, { rowSpan: 2 })}
          {fth('region', 'Region', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2 text-left', { left: L_REGION, height: HEAD_ROW_H, ...fixW(COL_REGION) }, { rowSpan: 2 })}
          {fth('wd', 'Total WD', 'fz sticky top-0 z-30 bg-[#17233b] px-2 py-2', { left: L_WD, height: HEAD_ROW_H, ...fixW(COL_WD) }, { rowSpan: 2 })}
          {ks.map((k) =>
            fth(`slot_${k}`, slotLabel(k), 'sticky top-0 z-20 bg-[#17233b] px-2 py-2', { height: HEAD_ROW_H }, { colSpan: 2 })
          )}
        </tr>
        <tr>
          {ks.map((k) => (
            <Fragment key={k}>
              <th className="s2 sticky z-20 bg-[#17233b] px-2 py-1 text-[11px] text-sky-300" style={{ top: HEAD_ROW_H }}>WD</th>
              <th className="s2 sticky z-20 bg-[#17233b] px-2 py-1 text-[11px] text-emerald-300" style={{ top: HEAD_ROW_H }}>W/O</th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {visible.map((s) => {
          const m = metaOf(s.id);
          return (
            <tr
              key={s.id}
              data-gid={s.id}
              onClick={() => openGid(s.id, rows)}
              className={`cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03] ${s.wd === 0 ? 'opacity-60' : ''}`}
            >
              <td className="fz sticky left-0 z-[1] bg-[#0f1726] px-2 py-1.5 text-left font-bold text-teal-300" style={fixW(COL_ID)}>
                <div className="truncate" style={{ maxWidth: COL_ID - 16 }}>{cap(s.id)}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 text-left" style={{ left: L_NAME, ...fixW(COL_NAME) }}>
                <div className="truncate" style={{ maxWidth: COL_NAME - 16 }}>{s.name}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 text-left text-[var(--muted)]" style={{ left: L_TL, ...fixW(COL_TL) }}>
                <div className="truncate" style={{ maxWidth: COL_TL - 16 }}>{s.tl}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 text-left" style={{ left: L_PRIMARY, ...fixW(COL_PRIMARY) }}>
                <div className="truncate" style={{ maxWidth: COL_PRIMARY - 16 }}>{s.primary}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 text-left text-[var(--muted)]" style={{ left: L_SS, ...fixW(COL_SS) }}>
                <div className="truncate" style={{ maxWidth: COL_SS - 16 }}>{m.ss || '—'}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 text-left" style={{ left: L_REGION, ...fixW(COL_REGION) }}>
                <div className="truncate" style={{ maxWidth: COL_REGION - 16 }}>{m.region || '—'}</div>
              </td>
              <td className="fz sticky z-[1] bg-[#0f1726] px-2 py-1.5 font-bold" style={{ left: L_WD, ...fixW(COL_WD) }}>{s.wd.toFixed(2)}</td>
              {ks.map((k) => {
                const c = s.h[k];
                if (c && c.wd > 0) {
                  const cls = c.wd < 35 ? 'text-amber-300 bg-amber-500/10' : c.wd > 100 ? 'text-rose-300 bg-rose-500/10' : 'text-emerald-300 bg-emerald-500/10';
                  return (
                    <Fragment key={k}>
                      <td className={`px-2 py-1.5 font-semibold ${cls}`}>{c.wd.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-sky-300">{Math.round(c.wo)}</td>
                    </Fragment>
                  );
                }
                return (
                  <Fragment key={k}>
                    <td className="px-2 py-1.5 text-slate-700">—</td>
                    <td className="px-2 py-1.5 text-slate-700">—</td>
                  </Fragment>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type Tab = 'summary' | 'hourly';
type AdminMode = 'tl' | 'ss' | 'region';
type FetchTarget = { type: 'team_leader' | 'shift_sup'; value: string };

export function HourlyView() {
  const { rowsD, staff, tlList, staffErr, leaderFilter, setLeaderFilter, search, dateFilter, regionMaps } = useDashboard();
  const { user } = useAuth();

  const exportRef = useRef<HTMLDivElement>(null);
  const [leaderRows, setLeaderRows] = useState<typeof rowsD>([]);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const [hFilters, setHFilters] = useState<Filters>({});

  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userRegions, setUserRegions] = useState<string[]>([]);
  const [roleReady, setRoleReady] = useState(false);

  // Chip filter used inside Shift Sup mode (narrow to one TL)
  const [ssTLFilter, setSsTLFilter] = useState<string>('');

  // Admin multi-select state
  const [adminMode, setAdminMode] = useState<AdminMode>('tl');
  const [selTLs, setSelTLs] = useState<string[]>([]);
  const [selSSs, setSelSSs] = useState<string[]>([]);
  const [selRegions, setSelRegions] = useState<string[]>([]);
  // Regional supervisor: how they slice their own regions
  const [rsMode, setRsMode] = useState<'region' | 'tl' | 'ss'>('region');

  const staffList = useMemo(() => toStaffArray(staff), [staff]);

  // Seed the TL selection from the global leader filter once (keeps previous default behaviour)
  const seededTL = useRef(false);
  useEffect(() => {
    if (seededTL.current) return;
    if (leaderFilter) {
      setSelTLs([leaderFilter]);
      seededTL.current = true;
    }
  }, [leaderFilter]);

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      setUserName(null);
      setUserRegions([]);
      setRoleReady(true);
      return;
    }
    setRoleReady(false);
    const userRef = ref(db, 'users/' + user.uid);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserRole(data.role || data.profile?.role || null);
        setUserName(
          data.name ||
          data.profile?.name ||
          data.displayName ||
          user.displayName ||
          null
        );
        setUserRegions(toRegionList(data.regions ?? data.profile?.regions));
      } else {
        setUserRole(null);
        setUserName(user.displayName || null);
        setUserRegions([]);
      }
      setRoleReady(true);
    });
    return () => unsubscribe();
  }, [user]);

  const roleLower = (userRole || '').toLowerCase().trim();
  const isTeamLeader =
    roleLower === 'team leader' ||
    roleLower === 'teamlead' ||
    roleLower === 'team lead' ||
    roleLower === 'tl';
  const isShiftSup =
    roleLower === 'shift sup' ||
    roleLower === 'shift supervisor' ||
    roleLower === 'shift sup.' ||
    roleLower === 'shiftsup' ||
    roleLower === 'shift_sup' ||
    roleLower === 'shift-sup' ||
    roleLower === 'ss';

  const isRegionalSup =
    roleLower === 'regional supervisor' ||
    roleLower === 'regional sup' ||
    roleLower === 'regional sup.' ||
    roleLower === 'regional_supervisor' ||
    roleLower === 'regional-supervisor' ||
    roleLower === 'regionalsupervisor';

  // Admin / Supervisor / everyone else with full access
  const isOther = !isTeamLeader && !isShiftSup && !isRegionalSup;

  const adminTL = isOther && adminMode === 'tl';
  const adminSS = isOther && adminMode === 'ss';
  // Region scoping: admins pick any region, Regional supervisors are locked to their own
  const adminRegion = (isOther && adminMode === 'region') || isRegionalSup;

  const myRegions = useMemo(() => toRegionList(userRegions), [userRegions]);
  const effRegions = useMemo<string[]>(() => {
    if (isRegionalSup) {
      // TL / Shift Sup views always cover all of the supervisor's own regions
      if (rsMode !== 'region') return myRegions;
      const picked = selRegions.map(upRegion).filter((r) => myRegions.includes(r));
      return picked.length ? picked : myRegions;
    }
    return adminRegion ? selRegions : [];
  }, [isRegionalSup, rsMode, adminRegion, selRegions, myRegions]);

  const ssMode = isShiftSup || adminSS;
  const ssNames = useMemo<string[]>(() => {
    if (isShiftSup) return userName ? [userName] : [];
    if (adminSS) return selSSs;
    return [];
  }, [isShiftSup, userName, adminSS, selSSs]);
  const ssLabel = joinLabel(ssNames, 'Shift Sups');

  const shiftSupList = useMemo(() => (isOther ? listShiftSups(staffList) : []), [isOther, staffList]);

  useEffect(() => {
    if (adminSS && staffList.length > 0 && shiftSupList.length === 0) {
      console.warn('[HourlyView] No Shift Sup found in roster. Staff keys:', Object.keys(staffList[0] || {}), 'sample:', staffList[0]);
    }
  }, [adminSS, staffList, shiftSupList]);

  // Staff meta (Shift Sup + Region) keyed by normalized staff id
  const regionMap = regionMaps?.region || {};
  const metaById = useMemo(() => {
    const m: Record<string, StaffMeta> = {};
    for (const s of staffList) {
      if (!s || typeof s !== 'object') continue;
      const sid = nid(s.id);
      if (!sid) continue;
      m[sid] = {
        ss: getFieldValue(s, SS_FIELDS),
        region: getFieldValue(s, REGION_FIELDS).trim(),
        tl: getFieldValue(s, TL_FIELDS),
      };
    }
    return m;
  }, [staffList]);

  const regionList = useMemo(
    () => (isOther ? sortedUnique(Object.values(metaById).map((m) => m.region).filter(Boolean)) : []),
    [isOther, metaById]
  );

  // Team Leaders / Shift Sups that exist inside the Regional supervisor's regions
  const rsTLOptions = useMemo(() => {
    if (!isRegionalSup) return [] as string[];
    const mine = new Set(myRegions);
    const by = new Map<string, string>();
    for (const m of Object.values(metaById)) {
      if (!m.tl || !mine.has(upRegion(m.region))) continue;
      const n = normalizeName(m.tl);
      if (n && !by.has(n)) by.set(n, m.tl.trim());
    }
    return Array.from(by.values()).sort((a, b) => a.localeCompare(b));
  }, [isRegionalSup, myRegions, metaById]);

  const rsSSOptions = useMemo(() => {
    if (!isRegionalSup) return [] as string[];
    const mine = new Set(myRegions);
    const by = new Map<string, string>();
    for (const m of Object.values(metaById)) {
      if (!m.ss || !mine.has(upRegion(m.region))) continue;
      const n = normalizeName(m.ss);
      if (n && !by.has(n)) by.set(n, m.ss.trim());
    }
    return Array.from(by.values()).sort((a, b) => a.localeCompare(b));
  }, [isRegionalSup, myRegions, metaById]);

  const regionStaffIds = useMemo(() => {
    const ids = new Set<string>();
    if (!adminRegion || effRegions.length === 0) return ids;
    const wanted = new Set(effRegions.map(upRegion));
    const tlSel = isRegionalSup && rsMode === 'tl' ? selTLs.filter((t) => rsTLOptions.some((o) => nameMatches(o, t))) : [];
    const ssSel = isRegionalSup && rsMode === 'ss' ? selSSs.filter((s) => rsSSOptions.some((o) => nameMatches(o, s))) : [];
    for (const [sid, m] of Object.entries(metaById)) {
      if (!m.region || !wanted.has(upRegion(m.region))) continue;
      if (tlSel.length && !tlSel.some((t) => nameMatches(m.tl, t))) continue;
      if (ssSel.length && !ssSel.some((s) => nameMatches(m.ss, s))) continue;
      ids.add(sid);
    }
    return ids;
  }, [adminRegion, effRegions, metaById, isRegionalSup, rsMode, selTLs, selSSs, rsTLOptions, rsSSOptions]);

  const regionTLs = useMemo(() => {
    const byNorm = new Map<string, string>();
    if (!adminRegion) return [] as string[];
    for (const s of staffList) {
      if (!s || typeof s !== 'object') continue;
      if (!regionStaffIds.has(nid(s.id))) continue;
      const tl = getFieldValue(s, TL_FIELDS);
      const n = normalizeName(tl);
      if (n && !byNorm.has(n)) byNorm.set(n, tl.trim());
    }
    return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
  }, [adminRegion, staffList, regionStaffIds]);

  const effectiveTeamLeader = useMemo(() => {
    if (!isTeamLeader || !userName) return '';
    const match = (tlList || []).find((tl) => tl.toLowerCase() === userName.toLowerCase());
    return match || userName;
  }, [isTeamLeader, userName, tlList]);

  // Single leader (TL role, or admin with exactly one TL selected); multi/none => ''
  const activeLeader = isTeamLeader ? effectiveTeamLeader : (adminTL && selTLs.length === 1 ? selTLs[0] : '');

  useEffect(() => {
    if (isTeamLeader && effectiveTeamLeader && leaderFilter !== effectiveTeamLeader) {
      setLeaderFilter(effectiveTeamLeader);
    }
  }, [isTeamLeader, effectiveTeamLeader, leaderFilter, setLeaderFilter]);

  const ssTLNames = useMemo(() => {
    if (!ssMode || ssNames.length === 0) return [];
    const byNorm = new Map<string, string>();

    for (const r of leaderRows as any[]) {
      const tl = rowTLName(r);
      if (!tl) continue;
      const n = normalizeName(tl);
      if (n && !byNorm.has(n)) byNorm.set(n, tl.trim());
    }

    for (const ssn of ssNames) {
      for (const tl of findTLsForShiftSup(staffList, ssn)) {
        const n = normalizeName(tl);
        if (n && !byNorm.has(n)) byNorm.set(n, tl.trim());
      }
    }

    return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
  }, [ssMode, ssNames, staffList, leaderRows]);

  useEffect(() => {
    if (!ssMode) {
      if (ssTLFilter) setSsTLFilter('');
      return;
    }
    if (!ssTLFilter) return;
    const stillValid = ssTLNames.some((n) => nameMatches(n, ssTLFilter));
    if (!stillValid) setSsTLFilter('');
  }, [ssMode, ssTLFilter, ssTLNames]);

  // What to fetch from /api/fetch-all (one request per selected value, merged)
  const fetchTargets = useMemo<FetchTarget[] | null>(() => {
    if (!roleReady) return null;
    if (isShiftSup) return userName ? [{ type: 'shift_sup', value: userName }] : [];
    if (isTeamLeader) return userName ? [{ type: 'team_leader', value: effectiveTeamLeader || userName }] : [];
    if (adminSS) return selSSs.map((v) => ({ type: 'shift_sup' as const, value: v }));
    if (adminRegion) return regionTLs.map((v) => ({ type: 'team_leader' as const, value: v }));
    return selTLs.map((v) => ({ type: 'team_leader' as const, value: v }));
  }, [roleReady, isShiftSup, isTeamLeader, userName, effectiveTeamLeader, adminSS, selSSs, adminRegion, regionTLs, selTLs]);

  const targetsKey = JSON.stringify(fetchTargets);

  useEffect(() => {
    setLeaderRows([]);

    const targets = (JSON.parse(targetsKey) as FetchTarget[] | null) || [];
    if (targets.length === 0) {
      setFetchErr('');
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setFetchErr('');

    Promise.all(
      targets.map((t) => {
        const params = new URLSearchParams();
        params.set(t.type, t.value);
        if (dateFilter) params.set('date', dateFilter);
        return fetch(`/api/fetch-all?${params.toString()}`, { signal: ctl.signal })
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then((d) => ({ rows: parseFetchAll(d), err: '' }))
          .catch((e) => {
            if (e.name === 'AbortError') throw e;
            return { rows: [] as any[], err: e.message || 'Fetch failed' };
          });
      })
    )
      .then((results) => {
        setLeaderRows(results.flatMap((r) => r.rows) as typeof rowsD);
        const errs = results.filter((r) => r.err);
        setFetchErr(errs.length ? errs[0].err + (errs.length > 1 ? ` (+${errs.length - 1} more)` : '') : '');
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setFetchErr(e.message || 'Fetch failed');
        setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, dateFilter]);

  const leaders = tlList;

  const ssScopedRows = useMemo(() => {
    if (!roleReady || !ssMode || ssNames.length === 0) return [];
    const source = (leaderRows.length > 0 ? leaderRows : rowsD) as any[];
    if (source.length === 0) return [];

    if (ssTLNames.length === 0) {
      if (leaderRows.length > 0) return leaderRows as any[];
      return source.filter((r) => ssNames.some((n) => nameMatches(getFieldValue(r, SS_FIELDS), n, true)));
    }

    const strict = source.filter((r) => {
      const tl = rowTLName(r);
      return !!tl && ssTLNames.some((n) => nameMatches(tl, n));
    });
    if (strict.length > 0) return strict;

    return source.filter((r) => {
      const tl = rowTLName(r);
      return !!tl && ssTLNames.some((n) => nameMatches(tl, n, true));
    });
  }, [roleReady, ssMode, ssNames, leaderRows, rowsD, ssTLNames]);

  const ssStaffByTL = useMemo(() => {
    const byTL: Record<string, number> = {};
    const totalSet = new Set<string>();
    for (const tl of ssTLNames) byTL[tl] = 0;
    const sets: Record<string, Set<string>> = {};
    for (const tl of ssTLNames) sets[tl] = new Set();
    for (const r of ssScopedRows) {
      const tl = rowTLName(r);
      if (!tl) continue;
      const sid = nid(r.staff_id);
      if (!sid) continue;
      totalSet.add(sid);
      for (const n of ssTLNames) {
        if (nameMatches(tl, n, true)) {
          sets[n].add(sid);
          break;
        }
      }
    }
    for (const tl of ssTLNames) byTL[tl] = sets[tl].size;
    return { byTL, total: totalSet.size };
  }, [ssTLNames, ssScopedRows]);

  const filteredRows = useMemo(() => {
    if (!roleReady) return [];

    if (ssMode) {
      if (ssNames.length === 0) return [];
      if (!ssTLFilter) return ssScopedRows;
      return ssScopedRows.filter((r) => {
        const tl = rowTLName(r);
        return !!tl && nameMatches(tl, ssTLFilter, true);
      });
    }

    if (isTeamLeader) {
      if (!activeLeader) return [];
      const base = (leaderRows.length ? leaderRows : rowsD) as any[];
      return scopeToLeaders(base, [activeLeader], staffList as any[]);
    }

    if (adminRegion) {
      if (effRegions.length === 0) return [];
      return (leaderRows as any[]).filter((r) => regionStaffIds.has(nid(r.staff_id)));
    }

    // admin → Team Leader mode
    if (selTLs.length === 0) return rowsD;
    return scopeToLeaders(leaderRows as any[], selTLs, staffList as any[]);
  }, [roleReady, ssMode, ssNames, ssScopedRows, ssTLFilter, isTeamLeader, activeLeader, leaderRows, rowsD, adminRegion, effRegions, regionStaffIds, selTLs, staffList]);

  const allowedIds = useMemo<Set<string> | null>(() => {
    if (!roleReady) return new Set<string>();
    const ids = new Set<string>();
    for (const r of filteredRows as any[]) {
      const sid = nid(r.staff_id);
      if (sid) ids.add(sid);
    }

    if (ssMode) {
      for (const s of staffList) {
        if (!s || typeof s !== 'object') continue;
        const sid = nid(s.id);
        if (!sid) continue;
        const tl = getFieldValue(s, TL_FIELDS);
        let ok = false;
        if (ssTLFilter) {
          ok = !!tl && nameMatches(tl, ssTLFilter);
        } else if (ssTLNames.length > 0) {
          ok = !!tl && ssTLNames.some((n) => nameMatches(tl, n));
        } else if (ssNames.length > 0) {
          const ss = getFieldValue(s, SS_FIELDS);
          ok = ssNames.some((n) => nameMatches(ss, n));
        }
        if (ok) ids.add(sid);
      }
      return ids;
    }

    if (adminRegion) {
      regionStaffIds.forEach((sid) => ids.add(sid));
      return ids;
    }

    const leadersForIds = isTeamLeader ? [activeLeader] : adminTL ? selTLs : [];
    const real = leadersForIds.filter(Boolean);
    if (real.length) {
      for (const l of real) {
        for (const s of tlStaff(l, staffList as any)) {
          const sid = nid(s.id);
          if (sid) ids.add(sid);
        }
      }
      return ids;
    }

    return null;
  }, [roleReady, filteredRows, ssMode, staffList, ssTLFilter, ssTLNames, ssNames, adminRegion, regionStaffIds, isTeamLeader, activeLeader, adminTL, selTLs]);

  const data = useMemo(() => {
    const rows = [...hourlyRows(filteredRows, activeLeader, staffList as any, allowedIds)];
    // Always highest Total WD first (no grouping by Team Leader)
    return rows.sort(byWdDesc);
  }, [filteredRows, activeLeader, staffList, allowedIds]);

  const q = search.toLowerCase().trim();
  const searched = q ? data.filter((s) => (s.id + ' ' + s.name).toLowerCase().includes(q)) : data;

  let last = -1;
  data.forEach((s) => Object.keys(s.h).forEach((k) => { if (+k > last) last = +k; }));
  const ks = Array.from({ length: last + 1 }, (_, i) => i);

  // Hourly table column filters
  const hourlyVal = (s: HourlyStaff, key: string): string => {
    switch (key) {
      case 'id': return cap(s.id);
      case 'name': return s.name;
      case 'tl': return s.tl;
      case 'primary': return s.primary;
      case 'ss': return metaById[nid(s.id)]?.ss || '—';
      case 'region': return metaById[nid(s.id)]?.region || '—';
      case 'wd': return s.wd.toFixed(2);
      default: {
        if (key.startsWith('slot_')) {
          const c = s.h[parseInt(key.slice(5), 10)];
          return c && c.wd > 0 ? c.wd.toFixed(2) : '—';
        }
        return '';
      }
    }
  };
  const hourlyOptions = (key: string) => sortedUnique(searched.map((s) => hourlyVal(s, key)));
  const visible = applyFilters(searched, hFilters, hourlyVal);
  const hActive = countActive(hFilters);

  const date = dateFilter || bizDate();

  const regionScopeLabel = (() => {
    const base = joinLabel(effRegions, 'regions');
    if (isRegionalSup && rsMode === 'tl' && selTLs.length) return `${base} · TL: ${joinLabel(selTLs, 'TLs')}`;
    if (isRegionalSup && rsMode === 'ss' && selSSs.length) return `${base} · SS: ${joinLabel(selSSs, 'Shift Sups')}`;
    return base;
  })();

  // Human-readable scope used for titles / file names
  const scopeLabel = ssMode
    ? (ssTLFilter || ssLabel || 'shift')
    : adminRegion
      ? (regionScopeLabel || 'region')
      : isTeamLeader
        ? (activeLeader || 'all')
        : (joinLabel(selTLs, 'TLs') || 'all');
  const basename = sanitizeName('Hourly-Data-' + scopeLabel + '-' + date);

  const doImage = async (mode: 'copy' | 'download') => {
    if (!exportRef.current) return;
    try {
      const title = `Hourly Data — ${
        ssMode
          ? (ssTLFilter || `${ssLabel || 'Shift Sup'} (All TLs)`)
          : adminRegion
            ? `Region: ${regionScopeLabel || '—'}`
            : (isTeamLeader ? activeLeader : joinLabel(selTLs, 'team leaders')) || 'All team leaders'
      } — ${date}`;
      const canvas = await captureTableImage(exportRef.current, title);
      const fn = basename + '.png';
      if (mode === 'copy') { const ok = await copyCanvas(canvas, title); if (!ok) downloadCanvas(canvas, fn); }
      else downloadCanvas(canvas, fn);
    } catch (e) { console.error(e); alert('Image export failed'); }
  };

  const doExcel = () => {
    void exportHourlyExcel(
      filteredRows,
      data,
      ssMode ? (ssTLFilter || '') : activeLeader,
      date,
      staffList as any,
      regionMap,
      basename,
    );
  };

  const tabBtn = (k: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? 'border-sky-400 text-white' : 'border-transparent text-[var(--muted)] hover:text-white'}`}
    >
      {label}
    </button>
  );

  const buildEmpty = (list: HourlyStaff[], filteredOut: boolean) =>
    staffErr ? (
      <div className="px-6 py-12 text-center text-rose-300">Staff sheet error: {staffErr}</div>
    ) : (loading || !roleReady) && list.length === 0 ? (
      <div className="px-6 py-12 text-center text-[var(--muted)]">Loading…</div>
    ) : list.length === 0 ? (
      <div className="px-6 py-12 text-center text-[var(--muted)]">
        {filteredOut
          ? 'No rows match the selected filters.'
          : ssMode && ssNames.length === 0
            ? 'Select a Shift Sup to view data.'
            : adminRegion && effRegions.length === 0
              ? (isRegionalSup ? 'No region is assigned to your account.' : 'Select a Region to view data.')
              : adminRegion
                ? `No staff found for Region: ${regionScopeLabel}`
                : ssMode
                  ? ssTLFilter
                    ? `No staff found for Team Leader: ${ssTLFilter}`
                    : `No staff found under Team Leaders assigned to Shift Sup: ${ssLabel}`
                  : 'No staff data found.'}
      </div>
    ) : null;

  const summaryEmpty = buildEmpty(searched, false);
  const hourlyEmpty = buildEmpty(visible, searched.length > 0);

  const summaryLeaderLabel = ssMode
    ? ssTLFilter
      ? `TL: ${ssTLFilter} (SS: ${ssLabel})`
      : (ssLabel || 'Shift Sup')
    : adminRegion
      ? `Region: ${regionScopeLabel}`
      : isTeamLeader
        ? activeLeader
        : joinLabel(selTLs, 'team leaders');

  const showChips = ssMode && ssTLNames.length > 0;

  const modeBtn = (m: AdminMode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => { setAdminMode(m); setSsTLFilter(''); }}
      className={`rounded-md px-3 py-1 text-xs font-semibold ${adminMode === m ? 'bg-white/10 text-white' : 'text-[var(--muted)] hover:text-white'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onCopyImage={() => doImage('copy')}
        onDownloadImage={() => doImage('download')}
        onExportExcel={doExcel}
        showImageExport
        showExcelExport
      />

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
        {isShiftSup ? (
          <div className="text-xs text-[var(--muted)] px-2 py-1.5 bg-white/5 rounded">
            Shift Sup: {userName || ''}
          </div>
        ) : isTeamLeader ? (
          <div className="text-xs text-[var(--muted)] px-2 py-1.5 bg-white/5 rounded">
            Team: {effectiveTeamLeader || userName || ''}
          </div>
        ) : isRegionalSup ? (
          <>
            <div className="text-xs text-[var(--muted)] px-2 py-1.5 bg-white/5 rounded">
              Regional Sup: {userName || ''}
            </div>
            <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
              {([['region', 'Region'], ['tl', 'Team Leader'], ['ss', 'Shift Sup']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRsMode(m)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold ${rsMode === m ? 'bg-white/10 text-white' : 'text-[var(--muted)] hover:text-white'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {rsMode === 'region' && (
              <MultiSelect
                label="Region"
                options={myRegions}
                selected={selRegions.filter((r) => myRegions.includes(upRegion(r)))}
                onChange={setSelRegions}
                placeholder={myRegions.length ? `All my regions (${myRegions.join(', ')})` : 'No region assigned'}
              />
            )}
            {rsMode === 'tl' && (
              <MultiSelect
                label="Team Leader"
                options={rsTLOptions}
                selected={selTLs.filter((t) => rsTLOptions.includes(t))}
                onChange={setSelTLs}
                placeholder="All team leaders in my regions"
              />
            )}
            {rsMode === 'ss' && (
              <MultiSelect
                label="Shift Sup"
                options={rsSSOptions}
                selected={selSSs.filter((s) => rsSSOptions.includes(s))}
                onChange={setSelSSs}
                placeholder="All shift sups in my regions"
              />
            )}
          </>
        ) : (
          <>
            <div className="flex gap-1 rounded-lg bg-white/[0.04] p-1">
              {modeBtn('tl', 'Team Leader')}
              {modeBtn('ss', 'Shift Sup')}
              {modeBtn('region', 'Region')}
            </div>
            {adminMode === 'tl' && (
              <MultiSelect
                label="Team Leader"
                options={leaders}
                selected={selTLs}
                onChange={setSelTLs}
                placeholder="All team leaders"
              />
            )}
            {adminMode === 'ss' && (
              <MultiSelect
                label="Shift Sup"
                options={shiftSupList}
                selected={selSSs}
                onChange={(v) => { setSelSSs(v); setSsTLFilter(''); }}
                placeholder={shiftSupList.length ? 'Select Shift Sup' : 'No Shift Sup found in roster'}
              />
            )}
            {adminMode === 'region' && (
              <MultiSelect
                label="Region"
                options={regionList}
                selected={selRegions}
                onChange={setSelRegions}
                placeholder={regionList.length ? 'Select Region' : 'No Region found'}
              />
            )}
          </>
        )}
        <span className="text-xs text-[var(--muted)]">{(tab === 'summary' ? searched : visible).length.toLocaleString()} staff</span>
        {tab === 'hourly' && hActive > 0 && (
          <button
            type="button"
            onClick={() => setHFilters({})}
            className="rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
          >
            Clear filters ({hActive})
          </button>
        )}
        {loading && <span className="text-xs text-sky-300">Loading…</span>}
        {fetchErr && <span className="text-xs text-rose-300">{fetchErr}</span>}
      </div>

      {showChips && (
        <div className="border-b border-white/[0.06] px-4 py-2.5 lg:px-6">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
            <span>Team Leaders under {ssLabel}</span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/70">
              {ssTLNames.length}
            </span>
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
              All <span className="ml-1 text-[10px] opacity-70">({ssStaffByTL.total})</span>
            </button>
            {ssTLNames.map((tl) => {
              const active = !!ssTLFilter && nameMatches(tl, ssTLFilter);
              const count = ssStaffByTL.byTL[tl] || 0;
              return (
                <button
                  key={tl}
                  type="button"
                  onClick={() => setSsTLFilter(tl)}
                  title={`Show only ${tl}'s team`}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                      : 'border-white/10 bg-white/5 text-[var(--muted)] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {tl} <span className="ml-1 text-[10px] opacity-70">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-white/[0.06] px-4 lg:px-6">
        {tabBtn('summary', 'Summary')}
        {tabBtn('hourly', 'Hourly')}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 lg:px-6">
        {tab === 'summary' ? (
          summaryEmpty ? (
            <div className="card">{summaryEmpty}</div>
          ) : (
            <SummaryView
              rows={searched}
              rawRows={filteredRows as any[]}
              role={userRole}
              leader={summaryLeaderLabel}
            />
          )
        ) : (
          <div className="flex justify-center">
            <div className="card w-fit max-w-full overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              {hourlyEmpty ?? (
                <HourlyTable
                  visible={visible}
                  ks={ks}
                  rows={filteredRows as any[]}
                  meta={metaById}
                  filters={hFilters}
                  setFilters={setHFilters}
                  getOptions={hourlyOptions}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <div aria-hidden="true" style={{ position: 'fixed', left: '-99999px', top: 0, pointerEvents: 'none' }}>
        <div ref={exportRef} className="card" style={{ width: 'max-content' }}>
          <HourlyTable visible={visible} ks={ks} rows={filteredRows as any[]} meta={metaById} exportMode />
        </div>
      </div>
    </div>
  );
}