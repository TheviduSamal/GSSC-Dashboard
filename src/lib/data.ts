// ── Data helpers (ported from src/index.html) ───────────────────────

import { ANCHOR, HIDDEN_COL_KEYS, PROBE_NORM, SCENE_NORM, UF_PRIORITY_PROJECTS } from './constants';
import type { GidAgg, HourlyStaff, RawRow, StaffInfo } from './types';

export const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const nid = (s: unknown): string =>
  String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '').toLowerCase();

export const gk = (s: unknown): string =>
  nid(s).replace(/-?otl$/, '').replace(/[^a-z0-9]/g, '');

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const slugify = (s: unknown): string =>
  String(s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[\s-]+/g, '_');

export const normKey = (k: string): string => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

export const esc = (x: unknown): string =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Flatten nested API responses into a flat row array. */
export function flatten(v: unknown, out: RawRow[] = []): RawRow[] {
  if (v == null) return out;
  if (Array.isArray(v)) {
    v.forEach((x) => flatten(x, out));
    return out;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      (obj.rows as RawRow[]).forEach((x) => out.push({ ...x, team_leader: (obj.tl_name as string) || (obj.team_leader as string) || '' }));
      return out;
    }
    if (Array.isArray(obj.data)) {
      flatten(obj.data, out);
      return out;
    }
    if (obj.team_leaders && typeof obj.team_leaders === 'object') {
      Object.values(obj.team_leaders).forEach((x) => flatten(x, out));
      return out;
    }
    const vals = Object.values(obj);
    if (vals.length && vals.every((x) => x && typeof x === 'object') && !Object.keys(obj).some((k) => ['project', 'task', 'staff_id', 'timestamp', 'value', 'count', 'center'].includes(k))) {
      vals.forEach((x) => flatten(x, out));
      return out;
    }
    out.push(obj as RawRow);
    return out;
  }
  return out;
}

/** Dedupe rows by exact key, keeping the most-common variant per team leader. */
export function dedupe(a: RawRow[]): RawRow[] {
  const per: Record<string, Map<string, { r: RawRow; n: number }>> = {};
  a.forEach((r) => {
    const L = r.team_leader || '';
    const k = [r.timestamp, nid(r.staff_id), r.project_name, r.task_name, r.value, r.denominator ?? '', r.wd ?? '', r.count ?? ''].join('\u0001');
    const m = per[L] || (per[L] = new Map());
    const e = m.get(k);
    if (e) e.n++;
    else m.set(k, { r, n: 1 });
  });
  const best = new Map<string, { r: RawRow; n: number }>();
  Object.values(per).forEach((m) =>
    m.forEach((e, k) => {
      const b = best.get(k);
      if (!b || e.n > b.n) best.set(k, e);
    }),
  );
  const out: RawRow[] = [];
  best.forEach((e) => {
    for (let i = 0; i < e.n; i++) out.push(e.r);
  });
  return out;
}

const TASK_FALLBACK_035 = new Set(['offline_posm', 'posm_masking', 'posm_voting', 'stitching', 'stitching_edit', 'scene_recognition', 'scene_recognition_edit', 'validation_warm_up']);
const TASK_FALLBACK_1 = new Set(['category_expert', 'voting_engine', 'masking', 'masking_engine', 'masking_menu_items', 'masking_price_labels', 'offline_pricing', 'pricing_voting', 'special_masking', 'validation', 'validation_edit', 'offline_validation', 'voting', 'offline_voting']);

export function getTaskCategory(t: unknown): string | null {
  const s = String(t ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (['validation', 'validation_edit', 'validation_warm_up'].includes(s)) return 'validation';
  if (s === 'offline_validation') return 'offlinevalidation';
  if (['voting', 'offline_voting', 'posm_voting'].includes(s)) return 'voting';
  if (s === 'offline_pricing') return 'pricing';
  if (s === 'pricing_voting') return 'pricing_voting';
  if (['voting_engine', 'category_expert'].includes(s)) return 'ev';
  if (s === 'offline_posm') return 'posm';
  if (['scene_recognition', 'scene_recognition_edit'].includes(s)) return 's_r';
  if (['masking', 'masking_engine', 'masking_menu_items', 'masking_price_labels', 'special_masking', 'posm_masking'].includes(s)) return 'masking';
  if (['stitching', 'stitching_edit'].includes(s)) return 'per_probe_scenes';
  return null;
}

export function getRowWDFull(r: RawRow): number {
  if (r.wd != null && r.wd !== '') return num(r.wd);
  const v = num(r.value);
  if (r.denominator != null && r.denominator !== '') return v * num(r.denominator);
  const ts = String(r.task_name || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (TASK_FALLBACK_035.has(ts)) return v * 0.35;
  if (TASK_FALLBACK_1.has(ts)) return v;
  return 0;
}

export function calculateDailyTarget(doj: string): number {
  if (!doj) return 100;
  try {
    const d = new Date(doj);
    if (isNaN(d.getTime())) return 100;
    const dd = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (dd <= 30) return 100;
    if (dd <= 60) return 150;
    if (dd <= 90) return 200;
    if (dd <= 120) return 250;
    return 365;
  } catch {
    return 100;
  }
}

export function getRowCategory(project: unknown, task: unknown, template: unknown): string {
  const p = String(project ?? '').trim().toLowerCase();
  const t = String(template ?? '').trim().toLowerCase();
  if (p === 'pges') return t.includes('display') ? 'Repair Only' : 'Repair & Attribute';
  if (UF_PRIORITY_PROJECTS.has(p)) {
    if (t.includes('menu')) return 'Menu';
    if (t.includes('posm')) return 'POSM';
    return String(task ?? '').trim() || '(no task)';
  }
  return '';
}

/** Merge probe/scene columns and hide timestamp-like columns for raw tables. */
export function prepareRowForTable(r: RawRow | null | undefined): Record<string, unknown> {
  if (!r || typeof r !== 'object') return r as unknown as Record<string, unknown>;
  let probeVal = '', sceneVal = '', probeSeen = false, sceneSeen = false;
  for (const k of Object.keys(r)) {
    const kn = normKey(k);
    if (PROBE_NORM.has(kn)) {
      probeSeen = true;
      if (r[k] != null && r[k] !== '') probeVal = String(r[k]);
    }
    if (SCENE_NORM.has(kn)) {
      sceneSeen = true;
      if (r[k] != null && r[k] !== '') sceneVal = String(r[k]);
    }
  }
  const out: Record<string, unknown> = {};
  let mergedEmitted = false;
  const emitMerged = () => {
    if (mergedEmitted) return;
    mergedEmitted = true;
    const v = [probeVal, sceneVal].filter(Boolean).join(' / ');
    if (v) out['probe_scene_id'] = v;
  };
  for (const [k, v] of Object.entries(r)) {
    const kn = normKey(k);
    if (HIDDEN_COL_KEYS.has(kn)) continue;
    if (PROBE_NORM.has(kn) || SCENE_NORM.has(kn)) {
      emitMerged();
      continue;
    }
    out[k] = v;
  }
  if ((probeSeen || sceneSeen) && !mergedEmitted) emitMerged();
  return out;
}

// ── Timestamp / slot helpers ────────────────────────────────────────

export function parseTs(ts: unknown): Date | null {
  const s = String(ts ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && n > 0) {
    if (n > 1e12) return new Date(n);
    if (n > 1e9) return new Date(n * 1000);
  }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[4];
    const ap = m[7] && m[7].toUpperCase();
    if (ap == 'PM' && h < 12) h += 12;
    if (ap == 'AM' && h == 12) h = 0;
    return new Date(+m[1], +m[2] - 1, +m[3], h, +m[5], +(m[6] || 0));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function slotOf(ts: unknown): number {
  const d = parseTs(ts);
  if (!d) return -1;
  const m = d.getHours() * 60 + d.getMinutes();
  return Math.floor(((((m - ANCHOR) % 1440) + 1440) % 1440) / 60);
}

export function slotLabel(k: number): string {
  const s = (ANCHOR + k * 60) % 1440;
  const h = Math.floor(s / 60);
  return (h % 12 || 12) + ':' + String(s % 60).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}

// ── Row field extractors ────────────────────────────────────────────

export const getRowStaffId = (r: RawRow): string => {
  const cands = [r.staff_id, r.qat_id, r.gid, r.staffId, r.user_id, r.agent_id, r.userGid, r.staff, r.employee_id, r.emp_id, r.user, r.agent, r.qa_id];
  for (const c of cands) {
    if (c !== undefined && c !== null && String(c).trim() !== '') return gk(c);
  }
  return '';
};

export const getRowTL = (r: RawRow): string => {
  const cands = [r.team_leader, r.tl_name, r.tl, r.teamLead, r.team_lead, r.leader, r.supervisor];
  for (const c of cands) {
    if (c !== undefined && c !== null && String(c).trim() !== '') return String(c).trim();
  }
  return '';
};

export const pf = (r: RawRow): string => String(r.project_name ?? r.project ?? '');
export const tf = (r: RawRow): string => String(r.task_name ?? r.task ?? '');

// ── Hourly row builder ──────────────────────────────────────────────

/**
 * Build per-staff hourly rows.
 * `allow` (optional): set of nid(staffId). When provided, only those staff
 * appear (both from the roster and from raw rows). null/undefined = no limit.
 */
export function hourlyRows(
  a: RawRow[],
  tl: string,
  staff: Record<string, StaffInfo>,
  allow?: Set<string> | null,
): HourlyStaff[] {
  const m: Record<string, HourlyStaff> = {};
  Object.values(staff).forEach((s) => {
    if (!s.id) return;
    if (gk(s.id) === gk(s.tl)) return;
    if (tl && String(s.tl || '').trim() !== String(tl).trim()) return;
    const id = nid(s.id);
    if (allow && !allow.has(id)) return;
    m[id] = { id: s.id, name: s.name, primary: s.primary, tl: s.tl, wd: 0, wo: 0, h: {} };
  });
  for (const r of a) {
    const id = nid(r.staff_id);
    let s = m[id];
    if (!s) {
      if (allow && !allow.has(id)) continue;
      if (tl && (Object.keys(staff).length || nid(r.team_leader || r.tl_name || '') !== nid(tl))) continue;
      s = m[id] = { id: (r.staff_id as string) || id, name: (r.staff_name as string) || (r.name as string) || (r.staff_id as string) || id, primary: '—', tl: (r.team_leader as string) || (r.tl_name as string) || '', wd: 0, wo: 0, h: {} };
    }
    const v = num(r.value);
    const wd = r.wd != null && r.wd !== '' ? num(r.wd) : r.denominator != null && r.denominator !== '' ? v * num(r.denominator) : getRowWDFull(r);
    s.wd += wd;
    s.wo += v;
    const k = slotOf(r.timestamp);
    if (k >= 0) {
      const c = s.h[k] || (s.h[k] = { wd: 0, wo: 0 });
      c.wd += wd;
      c.wo += v;
    }
  }
  return Object.values(m).sort((x, y) => y.wd - x.wd || String(x.name).localeCompare(String(y.name)));
}

// ── Outflow normaliser ──────────────────────────────────────────────

export function isNAValue(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return s === 'na';
}

// ── Region map helpers ──────────────────────────────────────────────

export const rk = (x: unknown): string => String(x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function tsMs(t: unknown): number {
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (typeof t === 'object') return 0;
  const n = Number(t);
  if (!isNaN(n)) return n;
  return new Date(t as string).getTime() || 0;
}

export function buildRegionMap(data: unknown): Record<string, string> {
  const latest: Record<string, { region: string; sup: string; tl: string; ts: number }> = {};
  Object.values(data || {}).forEach((v) => {
    if (!v || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    const p = rk(obj.project);
    const rg = String(obj.region ?? '').trim().toUpperCase();
    if (!p || !rg) return;
    const ts = tsMs(obj.timestamp);
    if (!latest[p] || ts >= latest[p].ts)
      latest[p] = { region: rg, sup: String(obj.responsible_team_supervisor ?? '').trim(), tl: String(obj.responsible_team_leader ?? '').trim(), ts };
  });
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(latest)) m[k] = v.region;
  return m;
}

export function buildRegionMaps(data: unknown): { region: Record<string, string>; sup: Record<string, string>; tl: Record<string, string> } {
  const latest: Record<string, { region: string; sup: string; tl: string; ts: number }> = {};
  Object.values(data || {}).forEach((v) => {
    if (!v || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    const p = rk(obj.project);
    const rg = String(obj.region ?? '').trim().toUpperCase();
    if (!p || !rg) return;
    const ts = tsMs(obj.timestamp);
    if (!latest[p] || ts >= latest[p].ts)
      latest[p] = { region: rg, sup: String(obj.responsible_team_supervisor ?? '').trim(), tl: String(obj.responsible_team_leader ?? '').trim(), ts };
  });
  const m: Record<string, string> = {}, s: Record<string, string> = {}, t: Record<string, string> = {};
  for (const [k, v] of Object.entries(latest)) {
    m[k] = v.region;
    s[k] = v.sup;
    t[k] = v.tl;
  }
  return { region: m, sup: s, tl: t };
}

// ── GID aggregation ─────────────────────────────────────────────────

export const isEmea = (r: string): boolean => String(r || '').trim().toUpperCase() === 'EMEA';

export function gidAggregate(rs: RawRow[], getProjectRegion: (n: string) => string): GidAgg[] {
  const map = new Map<string, GidAgg>();
  rs.forEach((r) => {
    const proj = String(r.project_name ?? r.project ?? '(no project)');
    const task = String(r.task_name ?? r.task ?? '(no task)');
    const k = rk(proj) + '||' + slugify(task);
    let e = map.get(k);
    if (!e) {
      e = { project: proj, task, region: getProjectRegion(proj), count: 0, earned: 0, hours: {} };
      map.set(k, e);
    }
    const cnt = num(r.value);
    const wd = getRowWDFull(r);
    e.count += cnt;
    e.earned += wd;
    const h = slotOf(r.timestamp);
    if (h >= 0) {
      const c = e.hours[h] || (e.hours[h] = { count: 0, earned: 0 });
      c.count += cnt;
      c.earned += wd;
    }
  });
  return [...map.values()].sort((a, b) => a.project.localeCompare(b.project) || a.task.localeCompare(b.task));
}

export const niceCeil = (v: number): number => {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10) * p;
};

// ── CSV parser ──────────────────────────────────────────────────────

export function parseCsv(t: string): string[][] {
  const R: string[][] = [];
  let r: string[] = [];
  let c = '';
  let q = false;
  t = t.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          c += '"';
          i++;
        } else q = false;
      } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      r.push(c.trim());
      c = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      r.push(c.trim());
      c = '';
      if (r.some((x) => x)) R.push(r);
      r = [];
    } else c += ch;
  }
  r.push(c.trim());
  if (r.some((x) => x)) R.push(r);
  return R;
}

// ── Date helpers ────────────────────────────────────────────────────

export const isoD = (d: Date): string =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

export const bizDate = (): string => isoD(new Date(Date.now() - ANCHOR * 60000));

export function formatPTCaptionDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function friendlyFetchError(msg: string): string {
  const m = String(msg || '');
  if (/501|not enabled|not implemented/i.test(m)) return 'Live refresh not enabled on this server';
  if (/404|not found/i.test(m)) return 'Live refresh endpoint not found';
  if (/network|failed to fetch|cors/i.test(m)) return 'Live server unreachable (CORS/network)';
  if (m.length > 70) return m.slice(0, 70) + '…';
  return m;
}

export function sanitizeName(s: string): string {
  return String(s || 'export').replace(/[^a-z0-9-_.]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}