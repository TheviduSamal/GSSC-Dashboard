// ── Shared dashboard state via React Context ────────────────────────

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DATASETS } from '@/lib/constants';
import { api, getAuth, clearAuth, setAuth } from '@/lib/api';
import { bizDate, dedupe, flatten, getRowCategory, isNAValue } from '@/lib/data';
import { loadStaff, loadProjectSuggestions as loadProjectSuggestionsFn, loadRegionMap, type RegionMaps, type StaffState } from '@/lib/staff';
import type { Dataset, RawRow } from '@/lib/types';

interface DashboardState {
  // dataset / nav
  active: Dataset;
  setActive: (d: Dataset) => void;

  // data
  raw: any;
  rows: RawRow[];
  rowsD: RawRow[];

  // filters
  search: string;
  setSearch: (s: string) => void;
  leaderFilter: string;
  setLeaderFilter: (s: string) => void;
  dateFilter: string;
  setDateFilter: (s: string) => void;

  // staff + region
  staff: Record<string, import('@/lib/types').StaffInfo>;
  tlList: string[];
  staffErr: string;
  regionMaps: RegionMaps;

  // status
  status: { text: string; kind: 'ok' | 'err' | 'info' };
  setStatus: (text: string, kind?: 'ok' | 'err' | 'info') => void;
  liveInfo: string;

  // PT state
  ptProject: string;
  setPtProject: (s: string) => void;
  ptTask: string;
  setPtTask: (s: string) => void;
  ptCenter: string;
  setPtCenter: (s: string) => void;
  ptApplied: { p: string; t: string };
  ptLive: RawRow[] | null;
  setPtLive: (r: RawRow[] | null) => void;
  ptProjectList: string[];
  ptProjectsLoaded: boolean;

  // actions
  reload: () => void;
  fetchLiveData: () => Promise<void>;
  doFetchPT: () => void;
  loadProjectSuggestions: () => Promise<void>;
  doLogin: () => void;

  // sidebar mobile
  sidebarOpen: boolean;
  setSidebarOpen: (b: boolean) => void;
}

const Ctx = createContext<DashboardState | null>(null);

export function useDashboard(): DashboardState {
  const ctx = useContext(Ctx);
  if (!ctx) throw Error('useDashboard must be used within DashboardProvider');
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState<Dataset>(DATASETS[0]);
  const [raw, setRaw] = useState<any>(null);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [rowsD, setRowsD] = useState<RawRow[]>([]);
  const [search, setSearch] = useState('');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [dateFilter, setDateFilter] = useState(bizDate());
  const [staff, setStaff] = useState<Record<string, import('@/lib/types').StaffInfo>>({});
  const [tlList, setTlList] = useState<string[]>([]);
  const [staffErr, setStaffErr] = useState('');
  const [regionMaps, setRegionMaps] = useState<RegionMaps>({ region: {}, sup: {}, tl: {}, status: 'not loaded' });
  const [status, setStatusState] = useState<{ text: string; kind: 'ok' | 'err' | 'info' }>({ text: 'Ready', kind: 'info' });
  const [liveInfo, setLiveInfo] = useState('');
  const [ptProject, setPtProject] = useState('');
  const [ptTask, setPtTask] = useState('');
  const [ptCenter, setPtCenter] = useState('both');
  const [ptApplied, setPtApplied] = useState({ p: '', t: '' });
  const [ptLive, setPtLive] = useState<RawRow[] | null>(null);
  const [ptProjectList, setPtProjectList] = useState<string[]>([]);
  const [ptProjectsLoaded, setPtProjectsLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const liveTokRef = useRef(0);

  const setStatus = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'info') => {
    setStatusState({ text, kind });
  }, []);

  // ── Load staff + region on mount ─────────────────────────────────
  useEffect(() => {
    loadStaff().then((s: StaffState) => {
      setStaff(s.staff);
      setTlList(s.tlList);
      setStaffErr(s.staffErr);
    });
    loadRegionMap().then(setRegionMaps);
  }, []);

  // ── Load dataset ─────────────────────────────────────────────────
  const load = useCallback(
    async (ds: Dataset) => {
      if (ds.hourly) {
        // loadLive handled separately
        return;
      }
      setStatus('Loading…');
      if (ds.id === 'filtered') {
        setRaw(null);
        setRows([]);
        setRowsD([]);
        if (!ptLive) setStatus('Ready');
        return;
      }
      try {
        const r = await api(ds.url);
        let fetched = flatten(r.data);
        if (ds.id === 'outflow') fetched = fetched.filter((row) => !isNAValue(row.task_name ?? row.task) && !isNAValue(row.center ?? row.center_name ?? row.centre));
        setRaw(r);
        setRows(fetched);
        setRowsD([]);
        setStatus('Connected');
      } catch (e) {
        setRaw(null);
        setRows([]);
        setRowsD([]);
        setStatus('Load failed', 'err');
      }
    },
    [ptLive, setStatus],
  );

  const loadLive = useCallback(
    async (ds: Dataset, tl: string, date: string) => {
      const tok = ++liveTokRef.current;
      const q = encodeURIComponent;
      setStatus('Fetching live…');
      try {
        let url = '/api/fetch-all?date=' + q(date);
        if (tl) url += '&team_leader=' + q(tl);
        const d = await api(url);
        if (tok !== liveTokRef.current) return;
        let list: any[] = Array.isArray(d.data) ? d.data : d.data && typeof d.data === 'object' ? Object.values(d.data) : [];
        let fails = 0;
        if (!list.length && !tl && tlList.length) {
          list = [];
          for (const name of tlList) {
            try {
              const r = await api('/api/fetch-all?team_leader=' + q(name) + '&date=' + q(date));
              list.push(...(Array.isArray(r.data) ? r.data : r.data && typeof r.data === 'object' ? Object.values(r.data) : []));
            } catch {
              fails++;
            }
            if (tok !== liveTokRef.current) return;
          }
        }
        const out: RawRow[] = [];
        for (const t of list) {
          let rs = t.rows;
          const name = t.tl_name || tl;
          if (t.error) {
            try {
              rs = (await api('/api/fetch?tl_name=' + q(name) + '&date=' + q(date))).rows || [];
            } catch {
              fails++;
              rs = [];
            }
          }
          (rs || []).forEach((r: RawRow) => out.push({ ...r, team_leader: name || r.team_leader || '' }));
        }
        if (tok !== liveTokRef.current) return;
        setRows(out);
        setRowsD(dedupe(out));
        setRaw(d);
        setLiveInfo(
          ` · ${tl || 'All team leaders'} · ${date} · ${out.length.toLocaleString()} rows fetched` +
            (fails ? ` · ${fails} leader(s) failed` : '') +
            ` · updated ${(d.updated_at || '').toString().slice(0, 19).replace('T', ' ') || 'now'}`,
        );
        setStatus('Live', 'ok');
      } catch (e) {
        if (tok !== liveTokRef.current) return;
        setRows([]);
        setRowsD([]);
        setRaw(null);
        setLiveInfo('');
        setStatus('Live fetch failed', 'err');
      }
    },
    [setStatus, tlList],
  );

  const reload = useCallback(() => {
    if (active.hourly) {
      void loadLive(active, leaderFilter, dateFilter || bizDate());
    } else if (active.id === 'filtered') {
      // no-op: PT has its own fetch
    } else {
      void load(active);
    }
  }, [active, leaderFilter, dateFilter, loadLive, load]);

  const fetchLiveData = useCallback(async () => {
    if (!active.fetchUrl) return;
    const date = dateFilter || bizDate();
    setStatus('Fetching…');
    try {
      const qs = new URLSearchParams({ date });
      const d = await api(active.fetchUrl + '?' + qs);
      if (d && d.error) throw Error(d.error);
      let fetched = flatten(d.data !== undefined ? d.data : d);
      if (active.id === 'outflow') fetched = fetched.filter((row) => !isNAValue(row.task_name ?? row.task) && !isNAValue(row.center ?? row.center_name ?? row.centre));
      setRows(fetched);
      setRaw(d);
      setStatus(d.source === 'firebase' ? 'Refreshed' : 'Live', 'ok');
    } catch (e) {
      // fallback to saved
      try {
        const r = await api(active.url);
        let fetched = flatten(r.data);
        if (active.id === 'outflow') fetched = fetched.filter((row) => !isNAValue(row.task_name ?? row.task) && !isNAValue(row.center ?? row.center_name ?? row.centre));
        setRows(fetched);
        setRaw(r);
        setStatus('Saved data', 'info');
      } catch (e2) {
        setStatus('Load failed', 'err');
      }
    }
  }, [active, dateFilter, setStatus]);

  const doFetchPT = useCallback(async () => {
    const P = ptProject.trim();
    const T = ptTask.trim();
    setPtApplied({ p: P.toLowerCase(), t: T.toLowerCase() });
    if (!P && !T) {
      setPtLive(null);
      return;
    }
    const date = dateFilter || bizDate();
    const tok = ++liveTokRef.current;
    const tasks = T.split(',').map((t) => t.trim()).filter(Boolean);
    setStatus('Fetching live…');
    try {
      const allRows: RawRow[] = [];
      let fails = 0;
      if (tasks.length === 0) {
        const qs = new URLSearchParams({ project_name: P, project: P, date });
        const d = await api('/api/fetch-filtered?' + qs);
        if (tok !== liveTokRef.current) return;
        allRows.push(...flatten(d.data !== undefined ? d.data : d));
      } else {
        for (const task of tasks) {
          try {
            const qs = new URLSearchParams({ project_name: P, project: P, task_name: task, task, date });
            const d = await api('/api/fetch-filtered?' + qs);
            if (tok !== liveTokRef.current) return;
            allRows.push(...flatten(d.data !== undefined ? d.data : d));
          } catch {
            fails++;
          }
        }
      }
      if (tok !== liveTokRef.current) return;
      const enriched = allRows.map((r) => ({ ...r, category: getRowCategory(r.project_name, r.task_name, r.template_name) }));
      setPtLive(enriched);
      setLiveInfo(
        ` · ${P || '(all)'} / ${tasks.join(', ') || '(all)'} · ${date} · ${allRows.length.toLocaleString()} rows fetched` +
          (fails ? ` · ${fails} task(s) failed` : ''),
      );
      setStatus('Live', 'ok');
    } catch (e) {
      if (tok !== liveTokRef.current) return;
      setPtLive(null);
      setLiveInfo('');
      setStatus('Live fetch failed', 'err');
    }
  }, [ptProject, ptTask, dateFilter, setStatus]);

  const ptProjectsLoadingRef = useRef(false);
  const loadProjectSuggestions = useCallback(async () => {
    if (ptProjectsLoaded || ptProjectsLoadingRef.current) return;
    ptProjectsLoadingRef.current = true;
    try {
      const { projects } = await loadProjectSuggestionsFn();
      setPtProjectList(projects);
      setPtProjectsLoaded(projects.length > 0);
    } catch {
      /* ignore */
    } finally {
      ptProjectsLoadingRef.current = false;
    }
  }, [ptProjectsLoaded]);

  const doLogin = useCallback(() => {
    const u = prompt('API username (leave blank to clear saved login):');
    if (u === null) return;
    if (!u) {
      clearAuth();
      setStatus('Login cleared');
      return;
    }
    const p = prompt('API password:');
    if (p === null) return;
    setAuth(u, p);
    setStatus('Login saved');
  }, [setStatus]);

  // ── Switch dataset ───────────────────────────────────────────────
  const setActive = useCallback(
    (ds: Dataset) => {
      setActiveState(ds);
      setPtApplied({ p: '', t: '' });
      setPtLive(null);
      if (!ds.hourly) setLeaderFilter('');
      setSidebarOpen(false);
      if (ds.hourly) {
        void loadLive(ds, leaderFilter, dateFilter || bizDate());
      } else {
        void load(ds);
      }
    },
    [leaderFilter, dateFilter, load, loadLive],
  );

  // ── Initial load ─────────────────────────────────────────────────
  useEffect(() => {
    void loadLive(DATASETS[0], '', bizDate());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<DashboardState>(
    () => ({
      active,
      setActive,
      raw,
      rows,
      rowsD,
      search,
      setSearch,
      leaderFilter,
      setLeaderFilter,
      dateFilter,
      setDateFilter,
      staff,
      tlList,
      staffErr,
      regionMaps,
      status,
      setStatus,
      liveInfo,
      ptProject,
      setPtProject,
      ptTask,
      setPtTask,
      ptCenter,
      setPtCenter,
      ptApplied,
      ptLive,
      setPtLive,
      ptProjectList,
      ptProjectsLoaded,
      reload,
      fetchLiveData,
      doFetchPT,
      loadProjectSuggestions,
      doLogin,
      sidebarOpen,
      setSidebarOpen,
    }),
    [active, setActive, raw, rows, rowsD, search, leaderFilter, dateFilter, staff, tlList, staffErr, regionMaps, status, setStatus, liveInfo, ptProject, ptTask, ptCenter, ptApplied, ptLive, ptProjectList, ptProjectsLoaded, reload, fetchLiveData, doFetchPT, loadProjectSuggestions, doLogin, sidebarOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// re-export getAuth for convenience
export { getAuth };
