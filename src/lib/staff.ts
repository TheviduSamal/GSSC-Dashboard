// ── Staff + region map loading (ported from src/index.html) ─────────

import { api } from './api';
import { buildRegionMaps, gk, nid, parseCsv, rk } from './data';
import type { StaffInfo } from './types';

export interface StaffState {
  staff: Record<string, StaffInfo>;
  tlList: string[];
  staffErr: string;
}

export async function loadStaff(): Promise<StaffState> {
  try {
    const d = await api('/api/staff-lookup');
    const L = parseCsv(d.csv || '');
    if (L.length < 2) throw Error('Staff sheet is empty');
    const H = L[0].map((h) => h.toLowerCase().trim());
    const f = (fn: (h: string) => boolean) => H.findIndex(fn);
    const iId = f((h) => h === 'qat id' || h === 'gid' || h.includes('qat id') || (h.includes('staff') && h.includes('id')));
    const iN = f((h) => h === 'name');
    const iP = f((h) => h === 'primary');
    const iT = f((h) => ['teamlead', 'team lead', 'team_lead', 'tl'].includes(h));
    const iD = f((h) => h === 'doj' || h === 'date of joining' || h === 'joining date');
    // Region column from the staff sheet
    const iR = (() => {
      const exact = H.findIndex((h) => h === 'region');
      return exact >= 0 ? exact : H.findIndex((h) => h.includes('region'));
    })();
    // Shift column holds the Shift Sup name
    const iS = (() => {
      const exact = H.findIndex((h) => ['shift', 'shift sup', 'shift supervisor', 'shift_sup', 'shiftsup', 'ss'].includes(h));
      return exact >= 0 ? exact : H.findIndex((h) => h.includes('shift'));
    })();
    if (iId < 0 || iT < 0) throw Error('Staff sheet needs a QAT ID column and a Team Lead column');
    const staff: Record<string, StaffInfo> = {};
    for (const c of L.slice(1)) {
      const id = nid(c[iId]);
      if (!id) continue;
      staff[id] = {
        id: c[iId],
        name: (iN >= 0 && c[iN]) || c[iId],
        primary: (iP >= 0 && c[iP]) || '—',
        tl: c[iT] || '',
        doj: iD >= 0 && c[iD] ? c[iD] : '',
        shift: iS >= 0 && c[iS] ? c[iS].trim() : '',
        region: iR >= 0 && c[iR] ? c[iR].trim() : '',
      };
    }
    const tlList = [...new Set(Object.values(staff).map((s) => s.tl).filter(Boolean))].sort();
    return { staff, tlList, staffErr: '' };
  } catch (e) {
    return { staff: {}, tlList: [], staffErr: (e as Error).message };
  }
}

export const tlStaff = (tl: string, staff: Record<string, StaffInfo>): StaffInfo[] =>
  tl ? Object.values(staff).filter((s) => s.tl === tl && gk(s.id) !== gk(tl)) : Object.values(staff);

// ── Region map ──────────────────────────────────────────────────────

export interface RegionMaps {
  region: Record<string, string>;
  sup: Record<string, string>;
  tl: Record<string, string>;
  status: string;
}

export async function loadRegionMap(): Promise<RegionMaps> {
  let data: unknown = null;
  let status = 'not loaded';
  const base = String(window.QAT_FIREBASE_DB_URL || '').replace(/\/+$/, '');
  if (base) {
    try {
      const r = await fetch(base + '/Project%20And%20Region.json', { cache: 'no-store' });
      if (r.ok) data = await r.json();
      else status = 'Firebase HTTP ' + r.status + ' (check read rules for "Project And Region")';
    } catch (e) {
      status = 'Firebase fetch failed: ' + (e as Error).message;
      console.warn('Region REST failed:', (e as Error).message);
    }
  }
  if ((!data || typeof data !== 'object') && window.QAT_FIREBASE_CONFIG && typeof firebase !== 'undefined' && firebase) {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp?.(window.QAT_FIREBASE_CONFIG);
      data = (await firebase.database!().ref('Project And Region').once('value')).val();
    } catch (e) {
      console.warn('Region SDK failed:', (e as Error).message);
    }
  }
  if (data && typeof data === 'object') {
    const maps = buildRegionMaps(data);
    status = Object.keys(maps.region).length + ' projects mapped';
    return { ...maps, status };
  }
  return { region: {}, sup: {}, tl: {}, status };
}

export function getProjectRegion(name: string, map: Record<string, string>): string {
  if (!name) return 'Unknown';
  return map[rk(name)] || 'Unknown';
}

export function getProjectSupervisor(name: string, map: Record<string, string>): string {
  if (!name) return '';
  return map[rk(name)] || '';
}

export function getProjectTL(name: string, map: Record<string, string>): string {
  if (!name) return '';
  return map[rk(name)] || '';
}

// ── Project suggestions for the Project/Task view ───────────────────

export function unwrapResponse(d: unknown): unknown {
  if (!d) return d;
  if (typeof d !== 'object') return d;
  const obj = d as Record<string, unknown>;
  if (obj.data !== undefined) return unwrapResponse(obj.data);
  if (obj.projects !== undefined) return unwrapResponse(obj.projects);
  return d;
}

export function extractProjectNames(d: unknown, set: Set<string>): void {
  if (!d) return;
  const root = unwrapResponse(d);
  if (!root) return;
  if (Array.isArray(root)) {
    root.forEach((item) => {
      if (typeof item === 'string') {
        const s = item.trim();
        if (s) set.add(s);
        return;
      }
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const p = o.project || o.project_name || o.projectName || o.Project || o.name;
        if (typeof p === 'string' && p.trim()) set.add(p.trim());
      }
    });
    return;
  }
  if (typeof root === 'object') {
    const obj = root as Record<string, unknown>;
    const direct = obj.project || obj.project_name || obj.projectName;
    if (typeof direct === 'string' && direct.trim()) set.add(direct.trim());
    Object.values(obj).forEach((v) => {
      if (v == null) return;
      if (typeof v === 'string') return;
      if (Array.isArray(v)) {
        extractProjectNames(v, set);
        return;
      }
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const p = o.project || o.project_name || o.projectName || o.Project;
        if (typeof p === 'string' && p.trim()) set.add(p.trim());
        else extractProjectNames(v, set);
      }
    });
  }
}

async function loadProjectsFromFirebaseREST(): Promise<string[]> {
  const base = String(window.QAT_FIREBASE_DB_URL || '').replace(/\/+$/, '');
  if (!base) throw Error('QAT_FIREBASE_DB_URL not set');
  const url = base + '/Project%20And%20Region.json';
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw Error('HTTP ' + r.status);
  const data = await r.json();
  if (!data || typeof data !== 'object') return [];
  const set = new Set<string>();
  Object.values(data).forEach((v) => {
    const p = String((v as Record<string, unknown>)?.project != null ? (v as Record<string, unknown>).project : '').trim();
    if (p) set.add(p);
  });
  return [...set];
}

async function loadProjectsFromFirebaseSDK(): Promise<string[]> {
  if (!window.QAT_FIREBASE_CONFIG) throw Error('Firebase SDK config not set');
  if (typeof firebase === 'undefined' || !firebase) throw Error('Firebase SDK not loaded');
  if (!firebase.apps || !firebase.apps.length) firebase.initializeApp?.(window.QAT_FIREBASE_CONFIG);
  const db = firebase.database!();
  const snap = await db.ref('Project And Region').once('value');
  const data = snap.val() || {};
  const set = new Set<string>();
  Object.values(data).forEach((v) => {
    const p = String((v as Record<string, unknown>)?.project != null ? (v as Record<string, unknown>).project : '').trim();
    if (p) set.add(p);
  });
  return [...set];
}

export async function loadProjectSuggestions(): Promise<{ projects: string[]; source: string }> {
  const projects = new Set<string>();
  let source = '';
  if (window.QAT_FIREBASE_DB_URL) {
    try {
      const fb = await loadProjectsFromFirebaseREST();
      fb.forEach((p) => projects.add(p));
      if (fb.length) source = 'Firebase';
    } catch (e) {
      console.warn('Firebase REST failed:', (e as Error).message);
    }
  }
  if (projects.size === 0 && window.QAT_FIREBASE_CONFIG) {
    try {
      const fb = await loadProjectsFromFirebaseSDK();
      fb.forEach((p) => projects.add(p));
      if (fb.length) source = 'Firebase SDK';
    } catch (e) {
      console.warn('Firebase SDK failed:', (e as Error).message);
    }
  }
  if (projects.size === 0) {
    try {
      const d = await api('/api/outflow');
      extractProjectNames(d, projects);
      if (projects.size) source = '/api/outflow';
    } catch (e) {
      console.warn('/api/outflow failed:', (e as Error).message);
    }
  }
  if (projects.size === 0) {
    try {
      const d = await api('/api/project-task-lookup');
      extractProjectNames(d, projects);
      if (projects.size) source = '/api/project-task-lookup';
    } catch (e) {
      console.warn('/api/project-task-lookup failed:', (e as Error).message);
    }
  }
  const sorted = [...projects].map((p) => String(p).trim()).filter((p) => p && p.length < 80).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const uniq: string[] = [];
  const seen = new Set<string>();
  sorted.forEach((p) => {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(p);
    }
  });
  return { projects: uniq, source };
}