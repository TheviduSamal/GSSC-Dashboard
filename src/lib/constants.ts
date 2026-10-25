// ── Constants ported from the original src/index.html ───────────────

import type { Dataset } from './types';

export const DATASETS: Dataset[] = [
  { id: 'hourly', label: 'Hourly Data', title: 'Hourly Data', desc: 'All Staff, WD and W/O by hour', url: '/api/fetch-all', hourly: true },
  { id: 'filtered', label: 'Project / Task', title: 'Project + Task Results', desc: 'type a project name and task name(s), then press Fetch data', url: '/api/filtered' },
  { id: 'outflow', label: 'Outflow', title: 'Project Outflow', desc: 'Project, task and center outflow totals', url: '/api/outflow', fetchUrl: '/api/fetch-outflow' },
  { id: 'cancellation', label: 'Cancellation', title: 'Cancellation Data', desc: 'Saved cancellation records', url: '/api/cancellation', fetchUrl: '/api/fetch-cancellation' },
];

export const ANCHOR = 330; // 5:30 AM business-day anchor

export const HOURLY_FREEZE = 6; // Staff ID, Name, Team Leader, Primary, Total WD, Total W/O

export const PRESET_TASKS = [
  'category_expert', 'voting_engine', 'masking', 'masking_engine', 'masking_menu_items',
  'masking_price_labels', 'offline_posm', 'offline_pricing', 'pricing_voting', 'posm_masking',
  'posm_voting', 'stitching', 'stitching_edit', 'scene_recognition', 'scene_recognition_edit',
  'special_masking', 'validation', 'validation_edit', 'offline_validation', 'voting',
  'offline_voting', 'validation_warm_up',
].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

export const UF_PRIORITY_PROJECTS = new Set([
  'batru', 'diageopl', 'diageoes', 'diageopebac', 'diageoromania', 'aneuae', 'rjreynoldsus',
  'diageomx', 'diageobenelux', 'diageoga', 'diageoza', 'diageoug', 'diageoca', 'diageouk',
  'diageoit', 'diageoco', 'diageotz', 'frucorau', 'diageogr', 'diageoin', 'diageoie',
  'diageoar', 'diageoke', 'diageostr', 'diageogtr',
]);

export const TASK_CATEGORY_KEYS = [
  'validation', 'offlinevalidation', 'voting', 'pricing', 'pricing_voting',
  'ev', 'posm', 's_r', 'masking', 'per_probe_scenes',
] as const;

export const TASK_CATEGORY_LABELS: Record<string, string> = {
  validation: 'Validation',
  offlinevalidation: 'Offline Val',
  voting: 'Voting',
  pricing: 'Pricing',
  pricing_voting: 'Pricing Vote',
  ev: 'EV',
  posm: 'POSM',
  s_r: 'S/R',
  masking: 'Masking',
  per_probe_scenes: 'Per Probe',
};

export const SLOT_HEADER_COLORS = ['4F46E5', '7C3AED', '0891B2', '059669', 'D97706', 'DB2777'];
export const CATEGORY_HEADER_COLORS = ['1D4ED8', '6D28D9', 'A21CAF', 'BE123C', 'C2410C', 'A16207', '15803D', '0F766E', '0369A1', '4338CA', '64748B'];
export const FIREBASE_HEADER_COLORS = ['0284C7', '7C3AED', 'BE185D', 'D97706', '0891B2', '059669', 'EA580C', '4F46E5', '0F766E', 'DB2777', '0F172A', 'B45309'];
export const FIREBASE_COL_ORDER = ['timestamp', 'project_name', 'region', 'task_name', 'staff_id', 'value', 'denominator', 'wd', 'count'];
export const GENERAL_FREEZE_COLS = 8;
export const SUMMARY_FREEZE_COLS = 1;
export const XL_HEADER_START = 4;

export const OF_NUM_KEYS = ['outflow', 'total_outflow', 'total', 'value', 'count', 'scenes', 'scene_count', 'qty', 'quantity', 'amount'];
export const OF_FIXED: Record<string, string> = { GSSC: '#60a5fa', GSSK: '#a78bfa' };
export const OF_EXTRA = ['#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c'];

export const HIDDEN_COL_KEYS = new Set([
  'timestamp', 'shifteventname', 'taskuuid', 'traxcategorygroupid', 'traxcategoryingroup',
]);
export const PROBE_NORM = new Set(['probeid', 'probe']);
export const SCENE_NORM = new Set(['sceneid', 'scene']);

export const SUMMARY_GROUPS = [
  { tasks: [{ key: 'validation', label: 'validation' }, { key: 'validation_edit', label: 'validation_edit' }, { key: 'offline_validation', label: 'offline_validation' }], head: 'CDBEDF', body: 'E6DEF0', text: '7030A0' },
  { tasks: [{ key: 'masking', label: 'masking' }, { key: 'masking_price_labels', label: 'masking_price_labels' }, { key: 'masking_engine', label: 'masking_engine' }, { key: 'masking_menu_items', label: 'masking_menu_items' }], head: 'B6DDE8', body: 'DAEEF3', text: '0070C0' },
  { tasks: [{ key: 'voting', label: 'voting' }, { key: 'voting_engine', label: 'voting_engine' }, { key: 'offline_voting', label: 'offline_voting' }, { key: 'pricing_voting', label: 'pricing_voting' }], head: 'FCD5B4', body: 'FDE9D9', text: 'C55A11' },
  { tasks: [{ key: 'offline_pricing', label: 'offline_pricing' }, { key: 'offline_posm', label: 'offline_posm' }], head: 'E6B8B7', body: 'F2DCDB', text: '632523' },
  { tasks: [{ key: 'stitching', label: 'stitching' }, { key: 'stitching_edit', label: 'stitching_edit' }], head: 'D8E4BC', body: 'EBF1DE', text: '4F6228' },
  { tasks: [{ key: 'scene_recognition', label: 'scene_recognition' }, { key: 'scene_recognition_edit', label: 'scene_recognition_edit' }], head: 'FFFF99', body: 'FFFFCC', text: 'ED7D31' },
  { tasks: [{ key: 'validation_warm_up', label: 'validation_warm_up' }], head: 'A6A29A', body: 'D9D7D2', text: 'ED7D31' },
  { tasks: [{ key: 'category_expert', label: 'category_expert' }], head: 'C5D9F1', body: 'DCE6F1', text: '1F3864' },
  { tasks: [{ key: 'special_masking', label: 'special_masking' }], head: 'C5D9F1', body: 'DCE6F1', text: '1F3864' },
  { tasks: [{ key: 'posm_masking', label: 'Posm_masking' }], head: 'C5D9F1', body: 'DCE6F1', text: '1F3864' },
  { tasks: [{ key: 'posm_voting', label: 'posm_voting' }], head: 'C5D9F1', body: 'DCE6F1', text: '1F3864' },
];

export const API_ENDPOINT_OPTIONS = [
  { value: '/api/health', label: 'GET /api/health — Health check' },
  { value: '/api/tl-hourly', label: 'GET /api/tl-hourly — TL hourly data' },
  { value: '/api/staff', label: 'GET /api/staff — Staff data' },
  { value: '/api/filtered', label: 'GET /api/filtered — Filtered data' },
  { value: '/api/outflow', label: 'GET /api/outflow — Outflow data' },
  { value: '/api/queue', label: 'GET /api/queue — Queue monitor data' },
  { value: '/api/cancellation', label: 'GET /api/cancellation — Cancellation data' },
  { value: '/api/staff-lookup', label: 'GET /api/staff-lookup — Staff lookup CSV' },
  { value: '/api/project-task-lookup', label: 'GET /api/project-task-lookup — Project/task lookup' },
  { value: '/api/fetch-all', label: 'GET /api/fetch-all — Live refresh (may be disabled)' },
  { value: '/api/fetch', label: 'GET /api/fetch — Live fetch (may be disabled)' },
  { value: '/api/fetch-filtered', label: 'GET /api/fetch-filtered — Live filtered refresh (may be disabled)' },
  { value: '/api/fetch-outflow', label: 'GET /api/fetch-outflow — Live outflow refresh' },
  { value: '/api/fetch-cancellation', label: 'GET /api/fetch-cancellation — Live cancellation refresh' },
  { value: '/api/queue-monitor', label: 'GET /api/queue-monitor — Queue refresh' },
];
