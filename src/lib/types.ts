// ── Shared types for the QAT Dashboard ──────────────────────────────

/** A raw record row coming from any of the /api/* endpoints. */
export interface RawRow {
  [key: string]: unknown;
  staff_id?: string;
  qat_id?: string;
  gid?: string;
  staffId?: string;
  user_id?: string;
  agent_id?: string;
  userGid?: string;
  staff?: string;
  employee_id?: string;
  emp_id?: string;
  user?: string;
  agent?: string;
  qa_id?: string;
  team_leader?: string;
  tl_name?: string;
  tl?: string;
  teamLead?: string;
  team_lead?: string;
  leader?: string;
  supervisor?: string;
  project_name?: string;
  project?: string;
  Project?: string;
  task_name?: string;
  task?: string;
  Task?: string;
  template_name?: string;
  timestamp?: string | number;
  date?: string;
  created_at?: string;
  value?: string | number;
  denominator?: string | number;
  wd?: string | number;
  count?: string | number;
  region?: string;
  Region?: string;
  center?: string;
  center_name?: string;
  centre?: string;
  Center?: string;
  staff_name?: string;
  name?: string;
  category?: string;
}

/** Staff info loaded from /api/staff-lookup CSV. */
export interface StaffInfo {
  id: string;
  name: string;
  primary: string;
  tl: string;
  doj: string;
}

/** A normalised hourly row for the Hourly Data table. */
export interface HourlyStaff {
  id: string;
  name: string;
  primary: string;
  tl: string;
  wd: number;
  wo: number;
  h: Record<number, { wd: number; wo: number }>;
}

/** Dataset configuration. */
export interface Dataset {
  id: 'hourly' | 'filtered' | 'outflow' | 'cancellation';
  label: string;
  title: string;
  desc: string;
  url: string;
  hourly?: boolean;
  fetchUrl?: string;
}

/** GID modal state. */
export interface GidCur {
  gid: string;
  rs: RawRow[];
  info: StaffInfo;
}

/** Project/Task hourly model. */
export interface PTHourlyModel {
  gids: string[];
  hourlyMap: Record<string, PTHourlyEntry>;
  centerTotals: { GSSC: number; GSSK: number };
  centerHourTotals: { GSSC: Record<number, number>; GSSK: Record<number, number> };
  hourTotals: Record<number, number>;
  combinedTotal: number;
  showGSSC: boolean;
  showGSSK: boolean;
  filteredRows: RawRow[];
}

export interface PTHourlyEntry {
  total: number;
  center: 'GSSC' | 'GSSK';
  h: Record<number, number>;
}

/** Outflow normalised row. */
export interface OfNormRow {
  project: string;
  task: string;
  center: string;
  region: string;
  sup: string;
  sups: string[];
  val: number;
}

export interface OfProject {
  name: string;
  total: number;
  c: Record<string, number>;
  t: Map<string, OfTask>;
}

export interface OfTask {
  name: string;
  total: number;
  c: Record<string, number>;
}

/** GID aggregated project/task entry. */
export interface GidAgg {
  project: string;
  task: string;
  region: string;
  count: number;
  earned: number;
  hours: Record<number, { count: number; earned: number }>;
}

/** Status indicator state. */
export type StatusKind = 'ok' | 'err' | 'info';

/** API request view state. */
export interface ApiResponse {
  text: string;
  parsed: unknown;
  meta: string;
  ok: boolean;
}

// ── Window globals (CDN scripts + firebase config) ──────────────────
interface JSZipFile {
  async: (t: 'string') => Promise<string>;
}

interface JSZipResult {
  file: ((n: string) => JSZipFile | undefined) & ((n: string, c: string) => void);
  generateAsync: (o: { type: string; mimeType: string }) => Promise<Blob>;
}

declare global {
  interface Window {
    QAT_FIREBASE_CONFIG?: unknown;
    QAT_FIREBASE_DB_URL?: string;
    XLSX?: { utils: { encode_cell: (a: { r: number; c: number }) => string; encode_range: (a: { s: { r: number; c: number }; e: { r: number; c: number } }) => string; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void }; write: (wb: unknown, o: Record<string, unknown>) => Blob };
    JSZip?: { loadAsync: (d: Blob | Uint8Array) => Promise<JSZipResult> };
    html2canvas?: (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
    firebase?: {
      apps?: unknown[];
      initializeApp?: (c: unknown) => void;
      database?: () => { ref: (p: string) => { once: (e: string) => Promise<{ val: () => unknown }> } };
    };
  }
}

export {};
