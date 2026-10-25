// src/lib/roles.ts

/**
 * Role / roster helpers — shared between HourlyView and CancellationView.
 * Tolerant name matching across many possible field aliases.
 */

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

export function stripOtl(s: string): string {
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

export function getFieldValue(obj: any, fields: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null) continue;
    const s = extractName(v);
    if (s) return s;
  }
  return '';
}

export function rowTLName(r: any): string {
  return getFieldValue(r, TL_FIELDS);
}

/**
 * Given a staff list and a shift-sup name, return all distinct TL names
 * whose staff rows report to that shift sup.
 *
 * Strategy:
 *   1. Exact match on shift-sup fields.
 *   2. Fallback: loose (substring) match if strict pass yields nothing.
 */
export function findTLsForShiftSup(staffList: any[], shiftSup: string): string[] {
  if (!staffList.length || !shiftSup) return [];
  const byNorm = new Map<string, string>();

  const addTL = (s: any) => {
    const tl = getFieldValue(s, TL_FIELDS);
    if (!tl) return;
    const n = normalizeName(tl);
    if (!n) return;
    if (!byNorm.has(n)) byNorm.set(n, tl.trim());
  };

  // strict pass
  for (const s of staffList) {
    if (!s || typeof s !== 'object') continue;
    const ss = getFieldValue(s, SS_FIELDS);
    if (!ss) continue;
    if (nameMatches(ss, shiftSup)) addTL(s);
  }

  // loose fallback
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