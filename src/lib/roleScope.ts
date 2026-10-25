import { useEffect, useMemo, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboard } from '@/hooks/useDashboardData';
import { gk, getRowStaffId, getRowTL } from '@/lib/data';
import { tlStaff } from '@/lib/staff';

/* ------------------------------------------------------------------ */
/*  Name / roster helpers                                              */
/* ------------------------------------------------------------------ */

export const SS_FIELDS = [
  'shift_sup', 'shiftSup', 'shift_supervisor', 'shiftSupervisor',
  'shift_sup_name', 'shiftSupName', 'shiftsup', 'shift_sup_id',
  'shift', 'supervisor', 'supervisor_name', 'supervisorName',
  'ss', 'shift_lead', 'shiftLead', 'shift_head', 'shiftHead',
  'reports_to', 'reportsTo', 'manager', 'manager_name',
];

export const TL_FIELDS = [
  'team_leader', 'teamLead', 'team_lead', 'teamleader', 'tl', 'tl_name', 'tlName',
];

export function extractName(v: any): string {
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

export function normalizeName(s: any): string {
  return extractName(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripOtl(s: string): string {
  return s.replace(/-?otl\b/gi, '').replace(/\s+/g, ' ').trim();
}

export function nameMatches(a: any, b: any, loose = false): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (stripOtl(na) === stripOtl(nb)) return true;
  if (loose && (na.includes(nb) || nb.includes(na))) return true;
  if (loose && (stripOtl(na).includes(stripOtl(nb)) || stripOtl(nb).includes(stripOtl(na)))) return true;
  return false;
}

export function toStaffArray(staff: any): any[] {
  if (!staff) return [];
  if (Array.isArray(staff)) return staff;
  if (typeof staff === 'object') {
    return Object.entries(staff).map(([key, val]: [string, any]) => {
      if (val && typeof val === 'object') {
        return { ...val, id: val.id ?? val.gid ?? val.staff_id ?? val.staffId ?? key };
      }
      return { id: key, name: String(val) };
    });
  }
  return [];
}

const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const SS_KEYS = new Set(SS_FIELDS.map(normKey));
const TL_KEYS = new Set(TL_FIELDS.map(normKey));

// exact key match first, then case/space/underscore-insensitive match
export function getFieldValue(obj: any, fields: string[]): string {
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

export function findTLsForShiftSup(staffList: any[], shiftSup: string): string[] {
  if (!staffList.length || !shiftSup) return [];
  const byNorm = new Map<string, string>();
  const addTL = (s: any) => {
    const tl = getFieldValue(s, TL_FIELDS);
    if (!tl) return;
    const n = normalizeName(tl);
    if (n && !byNorm.has(n)) byNorm.set(n, tl.trim());
  };
  for (const s of staffList) {
    if (!s || typeof s !== 'object') continue;
    const ss = getFieldValue(s, SS_FIELDS);
    if (ss && nameMatches(ss, shiftSup)) addTL(s);
  }
  if (byNorm.size === 0) {
    for (const s of staffList) {
      if (!s || typeof s !== 'object') continue;
      const ss = getFieldValue(s, SS_FIELDS);
      if (ss && nameMatches(ss, shiftSup, true)) addTL(s);
    }
  }
  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
}

export function listShiftSups(staffList: any[]): string[] {
  const byNorm = new Map<string, string>();
  for (const s of staffList) {
    if (!s || typeof s !== 'object') continue;
    const ss = getFieldValue(s, SS_FIELDS);
    const n = normalizeName(ss);
    if (n && !byNorm.has(n)) byNorm.set(n, ss.trim());
  }
  return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/*  Scope + row matching                                               */
/* ------------------------------------------------------------------ */

export type ScopeKind = 'none' | 'all' | 'tl' | 'ss';

export interface Scope {
  kind: ScopeKind;
  ids: Set<string>; // staff ids (gk form) that are in scope
  tls: string[];    // team leader names that are in scope
}

export function matchesScope(r: any, scope: Scope): boolean {
  if (scope.kind === 'none') return false;
  if (scope.kind === 'all') return true;
  const sid = getRowStaffId(r);
  if (sid && scope.ids.has(sid)) return true;
  const rowTl = getRowTL(r);
  return !!rowTl && scope.tls.some((t) => nameMatches(rowTl, t));
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export type AdminMode = 'tl' | 'ss';

export function useRoleScope() {
  const { staff, tlList, leaderFilter, setLeaderFilter } = useDashboard();
  const { user } = useAuth();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);

  const [adminMode, setAdminMode] = useState<AdminMode>('tl');
  const [adminSS, setAdminSS] = useState<string>('');
  const [ssTLFilter, setSsTLFilter] = useState<string>('');

  const staffList = useMemo(() => toStaffArray(staff), [staff]);

  useEffect(() => {
    if (!user) {
      setUserRole(null);
      setUserName(null);
      setRoleReady(true);
      return;
    }
    setRoleReady(false);
    const userRef = ref(db, 'users/' + user.uid);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserRole(data.role || data.profile?.role || null);
        setUserName(data.name || data.profile?.name || data.displayName || user.displayName || null);
      } else {
        setUserRole(null);
        setUserName(user.displayName || null);
      }
      setRoleReady(true);
    });
    return () => unsubscribe();
  }, [user]);

  const roleLower = (userRole || '').toLowerCase().trim();
  const isTeamLeader = ['team leader', 'teamlead', 'team lead', 'tl'].includes(roleLower);
  const isShiftSup = ['shift sup', 'shift supervisor', 'shift sup.', 'shiftsup', 'shift_sup', 'shift-sup', 'ss'].includes(roleLower);
  const isOther = !isTeamLeader && !isShiftSup;

  const ssMode = isShiftSup || (isOther && adminMode === 'ss');
  const ssName: string | null = isShiftSup ? userName : (isOther && adminMode === 'ss' ? adminSS : null);

  const effectiveTeamLeader = useMemo(() => {
    if (!isTeamLeader || !userName) return '';
    const match = (tlList || []).find((tl) => tl.toLowerCase() === userName.toLowerCase());
    return match || userName;
  }, [isTeamLeader, userName, tlList]);

  const activeLeader = isTeamLeader ? effectiveTeamLeader : (ssMode ? '' : leaderFilter);

  // Team Leaders are locked to their own team
  useEffect(() => {
    if (isTeamLeader && effectiveTeamLeader && leaderFilter !== effectiveTeamLeader) {
      setLeaderFilter(effectiveTeamLeader);
    }
  }, [isTeamLeader, effectiveTeamLeader, leaderFilter, setLeaderFilter]);

  const shiftSupList = useMemo(() => (isOther ? listShiftSups(staffList) : []), [isOther, staffList]);

  const ssTLNames = useMemo(
    () => (ssMode && ssName ? findTLsForShiftSup(staffList, ssName) : []),
    [ssMode, ssName, staffList],
  );

  useEffect(() => {
    if (!ssMode) {
      if (ssTLFilter) setSsTLFilter('');
      return;
    }
    if (ssTLFilter && !ssTLNames.some((n) => nameMatches(n, ssTLFilter))) setSsTLFilter('');
  }, [ssMode, ssTLFilter, ssTLNames]);

  const buildScope = (chip: string): Scope => {
    const none: Scope = { kind: 'none', ids: new Set(), tls: [] };
    if (!roleReady) return none;

    if (ssMode) {
      if (!ssName) return none;
      const tls = chip ? [chip] : ssTLNames;
      const ids = new Set<string>();
      for (const s of staffList) {
        if (!s || typeof s !== 'object') continue;
        const tl = getFieldValue(s, TL_FIELDS);
        const inTL = !!tl && tls.some((n) => nameMatches(tl, n));
        const inSS = !chip && nameMatches(getFieldValue(s, SS_FIELDS), ssName);
        if (inTL || inSS) ids.add(gk(s.id));
      }
      return { kind: 'ss', ids, tls };
    }

    if (!activeLeader) {
      // a Team Leader with no resolved name must never see everything
      return isTeamLeader ? none : { kind: 'all', ids: new Set(), tls: [] };
    }
    const ids = new Set(tlStaff(activeLeader, staff).map((s) => gk(s.id)));
    return { kind: 'tl', ids, tls: [activeLeader] };
  };

  // what is shown (respects the TL chip)
  const scope = useMemo<Scope>(
    () => buildScope(ssTLFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleReady, ssMode, ssName, ssTLFilter, ssTLNames, staffList, activeLeader, isTeamLeader, staff],
  );

  // what is fetched from the server (whole Shift Sup / Team Leader, ignores the TL chip so chips don't refetch)
  const fetchScope = useMemo<Scope>(
    () => buildScope(''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleReady, ssMode, ssName, ssTLNames, staffList, activeLeader, isTeamLeader, staff],
  );

  return {
    roleReady, userRole, userName,
    isTeamLeader, isShiftSup, isOther,
    adminMode, setAdminMode, adminSS, setAdminSS,
    ssMode, ssName, shiftSupList, ssTLNames, ssTLFilter, setSsTLFilter,
    effectiveTeamLeader, activeLeader,
    scope, fetchScope,
  };
}