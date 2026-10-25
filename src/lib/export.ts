// ── Excel + image export (ported from src/index.html) ───────────────
// Uses CDN-loaded window.XLSX (xlsx-js-style), window.JSZip, window.html2canvas.

import { XL_HEADER_START, GENERAL_FREEZE_COLS, SUMMARY_FREEZE_COLS, SLOT_HEADER_COLORS, CATEGORY_HEADER_COLORS, FIREBASE_HEADER_COLORS, TASK_CATEGORY_KEYS, TASK_CATEGORY_LABELS, SUMMARY_GROUPS } from './constants';
import { cap, calculateDailyTarget, getRowWDFull, getTaskCategory, hourlyRows, nid, num, parseTs, sanitizeName, slotLabel, slugify } from './data';
import { getProjectRegion } from './staff';
import type { GidAgg, HourlyStaff, PTHourlyModel, RawRow, StaffInfo } from './types';

// ── Excel color palette ─────────────────────────────────────────────
const XLC: Record<string, string> = {
  navy: '0F172A', slate: '1E293B', accent: '06B6D4', white: 'FFFFFF', zebra: 'F8FAFC',
  border: 'CBD5E1', borderDark: '94A3B8', text: '0F172A', soft: '475569', muted: '94A3B8',
  blue: '2563EB', blueBg: 'EFF6FF', purple: '7C3AED', purpleBg: 'F5F3FF', amber: 'B45309',
  amberBg: 'FEF3C7', cyan: '0891B2', cyanText: '0E7490', green: '15803D', greenBg: 'DCFCE7',
  red: 'DC2626', redBg: 'FEE2E2', dash: 'F87171', dashBg: 'FEF2F2', wdHeadBg: 'E0F2FE',
  wdHeadText: '0369A1', woHeadBg: 'DCFCE7', woHeadText: '15803D',
};

function xlFont(color: string, bold: boolean, sz?: number) {
  return { name: 'Calibri', sz: sz || 11, bold: !!bold, color: { rgb: color } };
}
function xlFill(rgb: string) {
  return { patternType: 'solid', fgColor: { rgb } };
}
function xlBorder(rgb?: string) {
  const b = { style: 'thin', color: { rgb: rgb || XLC.border } };
  return { top: b, bottom: b, left: b, right: b };
}
const XL_CENTER = { horizontal: 'center', vertical: 'center', wrapText: true };
const XL_LEFT = { horizontal: 'left', vertical: 'center', indent: 1 };

type XlCell = { t: string; v: string | number; s?: unknown; z?: string };
interface XlSheet {
  ws: Record<string, unknown>;
  merges: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  heights: Record<number, number>;
  maxRow: number;
}

function createXlSheet(): XlSheet {
  return { ws: {}, merges: [], heights: {}, maxRow: 0 };
}
function xlPut(sh: XlSheet, r: number, c: number, v: string | number, s?: unknown, z?: string) {
  const X = window.XLSX!;
  const addr = X.utils.encode_cell({ r, c });
  sh.ws[addr] = { t: typeof v === 'number' ? 'n' : 's', v, s, z };
  if (r > sh.maxRow) sh.maxRow = r;
}
function xlTextWidth(vals: string[], min: number, max: number): number {
  let l = 0;
  vals.forEach((v) => {
    if (v.length > l) l = v.length;
  });
  return Math.min(Math.max(min, l + 4), max);
}
function xlBanner(sh: XlSheet, numCols: number, title: string, subtitle: string) {
  for (let c = 0; c < numCols; c++) {
    xlPut(sh, 0, c, c === 0 ? title : '', { font: xlFont(XLC.white, true, 18), fill: xlFill(XLC.navy), alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    xlPut(sh, 1, c, c === 0 ? subtitle : '', { font: xlFont('CBD5E1', false, 10), fill: xlFill(XLC.slate), alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    xlPut(sh, 2, c, '', { fill: xlFill(XLC.accent) });
  }
  for (let r = 0; r < 3; r++) sh.merges.push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
  sh.heights[0] = 38; sh.heights[1] = 22; sh.heights[2] = 5; sh.heights[3] = 10;
}
function xlFinalize(sh: XlSheet, widths: number[], freezeCols?: number, freezeRows?: number) {
  const X = window.XLSX!;
  const lastRow = sh.maxRow, numCols = widths.length;
  sh.ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: numCols - 1 } });
  sh.ws['!cols'] = widths.map((w) => ({ wch: w }));
  const rows: { hpt: number }[] = [];
  Object.entries(sh.heights).forEach(([r, h]) => { rows[Number(r)] = { hpt: h }; });
  sh.ws['!rows'] = rows;
  if (sh.merges.length > 0) sh.ws['!merges'] = sh.merges;
  sh.ws['!views'] = [{ showGridLines: false }];
  (sh.ws as any)['!xFreeze'] = freezeCols || 0;
  (sh.ws as any)['!yFreeze'] = freezeRows || 0;
  return sh.ws;
}
const xlHeaderStyle = (bg: string, color?: string, sz?: number) => ({ font: xlFont(color || XLC.white, true, sz || 11), fill: xlFill(bg), alignment: XL_CENTER, border: xlBorder(XLC.white) });
const xlBodyStyle = (fill: string, color?: string, bold?: boolean, edge?: boolean) => {
  const border = xlBorder(XLC.border);
  if (edge) border.left = { style: 'medium', color: { rgb: XLC.borderDark } };
  return { font: xlFont(color || XLC.text, bold || false, 11), fill: xlFill(fill), alignment: XL_CENTER, border };
};

function parseTsForExcel(ts: unknown): Date | null {
  const s = String(ts ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && n > 0) {
    if (n > 1e12) return new Date(n);
    if (n > 1e9) return new Date(n * 1000);
  }
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?\s*(AM|PM)?$/i);
  if (m) {
    let h = +m[4];
    const ap = m[8] && m[8].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    const ms = m[7] ? +((m[7] + '00').slice(0, 3)) : 0;
    return new Date(+m[1], +m[2] - 1, +m[3], h, +m[5], +(m[6] || 0), ms);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── Workbook writer with freeze panes ───────────────────────────────
export async function exportWorkbookWithFreeze(wb: any, filename: string): Promise<void> {
  const X = window.XLSX!, J = window.JSZip!;
  const out = X.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const zip = await J.loadAsync(out as Blob);
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    const ws = wb.Sheets[wb.SheetNames[i]];
    const xSplit = ws['!xFreeze'] || 0;
    const ySplit = ws['!yFreeze'] || 0;
    let views: string;
    if (xSplit > 0 && ySplit > 0) {
      const topLeft = X.utils.encode_cell({ r: ySplit, c: xSplit });
      views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`;
    } else if (ySplit > 0) {
      const topLeft = X.utils.encode_cell({ r: ySplit, c: 0 });
      views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`;
    } else if (xSplit > 0) {
      const topLeft = X.utils.encode_cell({ r: 0, c: xSplit });
      views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane xSplit="${xSplit}" topLeftCell="${topLeft}" activePane="topRight" state="frozen"/><selection pane="topRight" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`;
    } else {
      views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>`;
    }
    let xml = await file.async('string');
    if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
      xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views);
    } else if (/<sheetViews\s*\/>/.test(xml)) {
      xml = xml.replace(/<sheetViews\s*\/>/, views);
    } else if (/<dimension[^>]*\/>/.test(xml)) {
      xml = xml.replace(/(<dimension[^>]*\/>)/, '$1' + views);
    } else if (/<sheetFormatPr/.test(xml)) {
      xml = xml.replace(/(<sheetFormatPr)/, views + '$1');
    } else {
      xml = xml.replace(/(<sheetData)/, views + '$1');
    }
    zip.file(path, xml);
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── All Data sheet ──────────────────────────────────────────────────
function buildAllDataSheet(allRows: RawRow[], title: string, subtitle: string) {
  if (!allRows || !allRows.length) return null;
  const sh = createXlSheet();
  const cols = [
    { key: 'timestamp', kind: 'date', label: 'DATE' },
    { key: 'timestamp', kind: 'time', label: 'TIME' },
    { key: 'region', kind: 'data', label: 'REGION' },
    { key: 'staff_id', kind: 'data', label: 'STAFF ID' },
    { key: 'project_name', kind: 'data', label: 'PROJECT NAME' },
    { key: 'task_name', kind: 'data', label: 'TASK NAME' },
    { key: 'value', kind: 'data', label: 'VALUE' },
    { key: 'denominator', kind: 'data', label: 'DENOMINATOR' },
    { key: 'wd', kind: 'data', label: 'WD' },
    { key: 'count', kind: 'data', label: 'COUNT' },
  ];
  const numCols = cols.length;
  xlBanner(sh, numCols, title, subtitle);
  cols.forEach((col, c) => xlPut(sh, XL_HEADER_START, c, col.label, xlHeaderStyle(FIREBASE_HEADER_COLORS[c % FIREBASE_HEADER_COLORS.length], XLC.white, 12)));
  sh.heights[XL_HEADER_START] = 30;
  allRows.forEach((row, i) => {
    const r = XL_HEADER_START + 1 + i;
    const fill = i % 2 === 0 ? XLC.white : XLC.zebra;
    cols.forEach((col, c) => {
      const k = col.key;
      const v = (row as any)[k];
      if (v === undefined || v === null) { xlPut(sh, r, c, '', xlBodyStyle(fill)); return; }
      if (col.kind === 'date') {
        const d = parseTsForExcel(String(v));
        if (!d) { xlPut(sh, r, c, String(v), xlBodyStyle(fill, XLC.text, true)); return; }
        const serial = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
        xlPut(sh, r, c, serial, xlBodyStyle(fill, XLC.text, true), 'yyyy-mm-dd');
        return;
      }
      if (col.kind === 'time') {
        const d = parseTsForExcel(String(v));
        if (!d) { xlPut(sh, r, c, '', xlBodyStyle(fill)); return; }
        const serial = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
        xlPut(sh, r, c, serial, xlBodyStyle(fill, XLC.text, true), 'hh:mm:ss AM/PM');
        return;
      }
      if (typeof v === 'number') {
        xlPut(sh, r, c, v, xlBodyStyle(fill, k === 'value' || k === 'wd' ? XLC.blue : XLC.text, k === 'value' || k === 'wd'), k === 'wd' ? '0.00' : undefined);
        return;
      }
      if (typeof v === 'object') { xlPut(sh, r, c, JSON.stringify(v), xlBodyStyle(fill, XLC.soft)); return; }
      const isId = k === 'staff_id' || k === 'region';
      xlPut(sh, r, c, String(v), xlBodyStyle(fill, isId ? XLC.cyanText : XLC.soft, isId));
    });
    sh.heights[r] = 20;
  });
  const widths = cols.map((col) => {
    if (col.kind === 'date' || col.kind === 'time') return 16;
    let max = col.label.length;
    allRows.forEach((r) => {
      const v = (r as any)[col.key];
      const len = v === undefined || v === null ? 0 : String(v).length;
      if (len > max) max = len;
    });
    return Math.min(Math.max(14, max + 4), 40);
  });
  const ws = xlFinalize(sh, widths, 0, XL_HEADER_START + 1);
  const X = window.XLSX!;
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: XL_HEADER_START, c: 0 }, e: { r: XL_HEADER_START + allRows.length, c: numCols - 1 } }) };
  return ws;
}

// ── General Info sheet ──────────────────────────────────────────────
interface StaffEntry {
  staff_id: string; name: string; primary: string; tl: string; doj: string;
  dailyTarget: number; totalWD: number; totalWO: number;
  hours: Record<string, { wd: number; wo: number }>;
  firebaseRows: RawRow[];
}

function buildGeneralSheet(staffEntries: StaffEntry[], subtitle: string) {
  const sh = createXlSheet();
  const headers = [
    { label: 'GID', bg: '0284C7' }, { label: 'Name', bg: '7C3AED' }, { label: 'Primary', bg: 'D97706' },
    { label: 'Team Leader', bg: '059669' }, { label: 'Daily Target', bg: 'EA580C' }, { label: 'S/E', bg: 'BE185D' },
    { label: 'Total WD', bg: '0891B2' }, { label: 'Status', bg: '4F46E5' },
    ...TASK_CATEGORY_KEYS.map((k, i) => ({ label: TASK_CATEGORY_LABELS[k], bg: CATEGORY_HEADER_COLORS[i % CATEGORY_HEADER_COLORS.length] })),
  ];
  const numCols = headers.length;
  xlBanner(sh, numCols, 'TEAM THEVIDU DASHBOARD  |  GENERAL INFO', subtitle);
  headers.forEach((h, c) => xlPut(sh, XL_HEADER_START, c, h.label, xlHeaderStyle(h.bg, XLC.white, 12)));
  sh.heights[XL_HEADER_START] = 30;
  staffEntries.forEach((s, i) => {
    const r = XL_HEADER_START + 1 + i;
    const fill = i % 2 === 0 ? XLC.white : XLC.zebra;
    const idle = s.totalWD === 0;
    const se = s.totalWD - s.dailyTarget;
    const met = !idle && s.totalWD >= s.dailyTarget;
    const cats: Record<string, number> = {};
    TASK_CATEGORY_KEYS.forEach((k) => (cats[k] = 0));
    s.firebaseRows.forEach((row) => { const cat = getTaskCategory(row.task_name); if (cat) cats[cat] += num(row.value); });
    let c = 0;
    xlPut(sh, r, c++, cap(s.staff_id), xlBodyStyle(fill, XLC.cyanText, true));
    xlPut(sh, r, c++, s.name, xlBodyStyle(fill, XLC.text, true));
    xlPut(sh, r, c++, s.primary, xlBodyStyle(fill, XLC.soft));
    xlPut(sh, r, c++, s.tl, xlBodyStyle(fill, XLC.soft));
    xlPut(sh, r, c++, s.dailyTarget, xlBodyStyle(fill, XLC.text, true), '0');
    xlPut(sh, r, c++, se, xlBodyStyle(fill, se < 0 ? XLC.red : XLC.text, true), '0.00');
    xlPut(sh, r, c++, s.totalWD, xlBodyStyle(fill, idle ? XLC.muted : XLC.cyanText, true), '0.00');
    xlPut(sh, r, c++, idle ? 'No Output' : met ? 'Met' : 'Not Met', xlBodyStyle(met ? XLC.greenBg : XLC.redBg, met ? XLC.green : XLC.red, true));
    TASK_CATEGORY_KEYS.forEach((k) => { const v = cats[k] > 0 ? Math.round(cats[k]) : 0; xlPut(sh, r, c++, v, xlBodyStyle(fill, v > 0 ? XLC.text : XLC.muted, v > 0), '#,##0;-#,##0;"—"'); });
    sh.heights[r] = 21;
  });
  const widths = [12, xlTextWidth(staffEntries.map((s) => s.name), 22, 36), xlTextWidth(staffEntries.map((s) => s.primary), 14, 26), xlTextWidth(staffEntries.map((s) => s.tl), 16, 26), 14, 12, 13, 14, ...TASK_CATEGORY_KEYS.map(() => 13)];
  return xlFinalize(sh, widths, GENERAL_FREEZE_COLS, XL_HEADER_START + 1);
}

// ── Hourly sheet ────────────────────────────────────────────────────
function buildHourlySheet(staffEntries: StaffEntry[], slotData: Record<string, Record<string, { wd: number; wo: number }>>, showAdminCols: boolean, subtitle: string) {
  const sh = createXlSheet();
  const baseHeaders = [{ label: 'GID', bg: '0284C7' }, { label: 'Name', bg: '7C3AED' }, { label: 'Primary', bg: 'D97706' }, { label: 'Team Leader', bg: '059669' }];
  if (showAdminCols) { baseHeaders.push({ label: 'Target', bg: 'EA580C' }, { label: 'S/E', bg: 'BE185D' }, { label: 'Status', bg: '4F46E5' }); }
  baseHeaders.push({ label: 'Total WD', bg: '0891B2' });
  const baseCount = baseHeaders.length;
  const FIXED_TIME_SLOTS: string[] = [];
  for (let mins = 330; mins < 330 + 1440; mins += 60) { const a = mins % 1440; const h = Math.floor(a / 60); const m = a % 60; const ampm = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; FIXED_TIME_SLOTS.push(`${h12}:${String(m).padStart(2, '0')} ${ampm}`); }
  let lastActive = -1;
  FIXED_TIME_SLOTS.forEach((slot, idx) => {
    const has = staffEntries.some((s) => { const cell = slotData[s.staff_id]?.[slot]; return !!cell && (cell.wd > 0 || cell.wo > 0); });
    if (has) lastActive = idx;
  });
  const slotCount = lastActive >= 0 ? lastActive + 1 : FIXED_TIME_SLOTS.length;
  const numCols = baseCount + slotCount * 2;
  xlBanner(sh, numCols, 'TEAM THEVIDU DASHBOARD  |  HOURLY DATA', subtitle);
  const top = XL_HEADER_START, sub = XL_HEADER_START + 1;
  baseHeaders.forEach((h, c) => { const style = xlHeaderStyle(h.bg, XLC.white, 12); xlPut(sh, top, c, h.label, style); xlPut(sh, sub, c, '', style); sh.merges.push({ s: { r: top, c }, e: { r: sub, c } }); });
  for (let j = 0; j < slotCount; j++) {
    const c0 = baseCount + j * 2;
    const style = xlHeaderStyle(SLOT_HEADER_COLORS[j % SLOT_HEADER_COLORS.length], XLC.white, 12);
    xlPut(sh, top, c0, FIXED_TIME_SLOTS[j], style); xlPut(sh, top, c0 + 1, '', style);
    sh.merges.push({ s: { r: top, c: c0 }, e: { r: top, c: c0 + 1 } });
    xlPut(sh, sub, c0, 'WD', xlHeaderStyle(XLC.wdHeadBg, XLC.wdHeadText, 10));
    xlPut(sh, sub, c0 + 1, 'W/O', xlHeaderStyle(XLC.woHeadBg, XLC.woHeadText, 10));
  }
  sh.heights[top] = 28; sh.heights[sub] = 20;
  staffEntries.forEach((s, i) => {
    const r = sub + 1 + i;
    const fill = i % 2 === 0 ? XLC.white : XLC.zebra;
    const idle = s.totalWD === 0;
    const seValue = s.totalWD - s.dailyTarget;
    const met = !idle && s.totalWD >= s.dailyTarget;
    const staffSlots = slotData[s.staff_id] || {};
    let c = 0;
    xlPut(sh, r, c++, cap(s.staff_id), xlBodyStyle(fill, XLC.cyanText, true));
    xlPut(sh, r, c++, s.name, xlBodyStyle(fill, XLC.text, true));
    xlPut(sh, r, c++, s.primary || '—', xlBodyStyle(fill, XLC.soft));
    xlPut(sh, r, c++, s.tl, xlBodyStyle(fill, XLC.soft));
    if (showAdminCols) {
      xlPut(sh, r, c++, s.dailyTarget, xlBodyStyle(fill, XLC.text, true), '0');
      xlPut(sh, r, c++, seValue, xlBodyStyle(fill, seValue < 0 ? XLC.red : XLC.text, true), '0.00');
      xlPut(sh, r, c++, idle ? 'No Output' : met ? 'Met' : 'Not Met', xlBodyStyle(met ? XLC.greenBg : XLC.redBg, met ? XLC.green : XLC.red, true));
    }
    xlPut(sh, r, c++, s.totalWD, xlBodyStyle(fill, idle ? XLC.muted : XLC.cyanText, true), '0.00');
    for (let j = 0; j < slotCount; j++) {
      const cell = staffSlots[FIXED_TIME_SLOTS[j]];
      const wd = cell?.wd || 0;
      const wo = cell?.wo || 0;
      if (wd > 0) { const low = wd < 35, high = wd > 100; xlPut(sh, r, c++, wd, xlBodyStyle(low ? XLC.amberBg : high ? XLC.redBg : XLC.greenBg, low ? XLC.amber : high ? XLC.red : XLC.green, true, true), '0.00'); } else { xlPut(sh, r, c++, '—', xlBodyStyle(XLC.dashBg, XLC.dash, false, true)); }
      if (wo > 0) { xlPut(sh, r, c++, Math.round(wo), xlBodyStyle(XLC.blueBg, XLC.blue, true), '0'); } else { xlPut(sh, r, c++, '—', xlBodyStyle(XLC.dashBg, XLC.dash)); }
    }
    sh.heights[r] = 21;
  });
  const widths = [12, xlTextWidth(staffEntries.map((s) => s.name), 22, 36), xlTextWidth(staffEntries.map((s) => s.primary), 14, 26), xlTextWidth(staffEntries.map((s) => s.tl), 16, 26)];
  if (showAdminCols) widths.push(11, 11, 13);
  widths.push(13);
  for (let j = 0; j < slotCount; j++) widths.push(10, 9);
  return xlFinalize(sh, widths, baseCount, XL_HEADER_START + 2);
}

// ── Summary sheet ───────────────────────────────────────────────────
function buildSummarySheet(staffEntries: StaffEntry[]) {
  const sh = createXlSheet();
  const thin = xlBorder(XLC.white);
  const hdr = (bg: string, color: string, bold?: boolean, sz?: number) => ({ font: xlFont(color, bold !== false, sz || 11), fill: xlFill(bg), alignment: XL_CENTER, border: thin });
  const flatTasks = SUMMARY_GROUPS.flatMap((g) => g.tasks.map((t) => ({ ...t, group: g })));
  const keySet = new Set(flatTasks.map((t) => t.key));
  const FIRST_COL = 1;
  const totalCol = FIRST_COL + flatTasks.length;
  const R_GROUP = 0, R_NAME = 1, R_OUT = 2, R_DATA = 3;
  for (let r = R_GROUP; r <= R_OUT; r++) xlPut(sh, r, 0, r === R_GROUP ? 'UserID' : '', hdr('7F7F7F', XLC.white, true, 12));
  sh.merges.push({ s: { r: R_GROUP, c: 0 }, e: { r: R_OUT, c: 0 } });
  let c = FIRST_COL;
  SUMMARY_GROUPS.forEach((g) => {
    const start = c;
    g.tasks.forEach((t, i) => { xlPut(sh, R_GROUP, c, i === 0 ? 'TOTAL' : '', hdr(g.head, g.text)); xlPut(sh, R_NAME, c, t.label, hdr(g.head, g.text)); xlPut(sh, R_OUT, c, 'Output', hdr(g.head, 'ED7D31')); c++; });
    if (g.tasks.length > 1) sh.merges.push({ s: { r: R_GROUP, c: start }, e: { r: R_GROUP, c: c - 1 } });
  });
  xlPut(sh, R_GROUP, totalCol, 'TOTAL COUNT', hdr('FF99FF', 'FF00CC', true, 12));
  xlPut(sh, R_NAME, totalCol, '', hdr('FF99FF', 'FF00CC'));
  sh.merges.push({ s: { r: R_GROUP, c: totalCol }, e: { r: R_NAME, c: totalCol } });
  xlPut(sh, R_OUT, totalCol, 'Output', hdr('FF99FF', 'FF0066'));
  sh.heights[R_GROUP] = 24; sh.heights[R_NAME] = 24; sh.heights[R_OUT] = 22;
  staffEntries.forEach((s, i) => {
    const r = R_DATA + i;
    const sums: Record<string, number> = {};
    for (const row of s.firebaseRows) { const k = slugify(row.task_name); if (!keySet.has(k)) continue; sums[k] = (sums[k] || 0) + getRowWDFull(row); }
    xlPut(sh, r, 0, cap(s.staff_id), { font: xlFont(XLC.white, true, 11), fill: xlFill('7F7F7F'), alignment: XL_CENTER, border: xlBorder(XLC.border) });
    let rowTotal = 0;
    flatTasks.forEach((t, j) => { const v = Math.round((sums[t.key] || 0) * 100) / 100; rowTotal += v; xlPut(sh, r, FIRST_COL + j, v, { font: xlFont(v > 0 ? XLC.text : XLC.muted, v > 0, 11), fill: xlFill(v > 0 ? t.group.body : XLC.white), alignment: XL_CENTER, border: xlBorder(XLC.border) }, '#,##0.00;-#,##0.00;"—"'); });
    xlPut(sh, r, totalCol, Math.round(rowTotal * 100) / 100, { font: xlFont('FF00CC', true, 11), fill: xlFill('FFCCFF'), alignment: XL_CENTER, border: xlBorder(XLC.border) }, '#,##0.00;-#,##0.00;"—"');
    sh.heights[r] = 21;
  });
  const widths = [12, ...flatTasks.map((t) => Math.max(14, t.label.length + 4)), 16];
  return xlFinalize(sh, widths, SUMMARY_FREEZE_COLS, R_OUT + 1);
}

// ── Region sheet ────────────────────────────────────────────────────
function buildRegionSheet(rowsIn: RawRow[], subtitle: string, regionMap: Record<string, string>) {
  const sh = createXlSheet();
  const agg = new Map<string, { reg: string; proj: string; wd: number; wo: number; staff: Set<string> }>();
  rowsIn.forEach((r) => {
    const reg = getProjectRegion(String(r.project_name ?? ''), regionMap);
    const proj = String(r.project_name ?? '(no project)');
    const k = reg + '\u0001' + proj;
    let o = agg.get(k);
    if (!o) { o = { reg, proj, wd: 0, wo: 0, staff: new Set() }; agg.set(k, o); }
    o.wd += getRowWDFull(r);
    o.wo += num(r.value);
    if (r.staff_id) o.staff.add(nid(r.staff_id));
  });
  const list = [...agg.values()].sort((a, b) => a.reg.localeCompare(b.reg) || b.wd - a.wd);
  const heads: [string, string][] = [['REGION', '0284C7'], ['PROJECT', '7C3AED'], ['STAFF', 'D97706'], ['TOTAL W/O', '059669'], ['TOTAL WD', '0891B2']];
  xlBanner(sh, heads.length, 'TEAM THEVIDU DASHBOARD  |  REGION WISE', subtitle);
  heads.forEach((h, c) => xlPut(sh, XL_HEADER_START, c, h[0], xlHeaderStyle(h[1], XLC.white, 12)));
  sh.heights[XL_HEADER_START] = 30;
  let r = XL_HEADER_START + 1, i = 0;
  const regs = [...new Set(list.map((x) => x.reg))];
  regs.forEach((reg) => {
    let tw = 0, to = 0;
    list.filter((x) => x.reg === reg).forEach((o) => {
      const fill = i++ % 2 === 0 ? XLC.white : XLC.zebra;
      tw += o.wd; to += o.wo;
      xlPut(sh, r, 0, o.reg, xlBodyStyle(fill, XLC.cyanText, true));
      xlPut(sh, r, 1, o.proj, xlBodyStyle(fill, XLC.text, true));
      xlPut(sh, r, 2, o.staff.size, xlBodyStyle(fill, XLC.soft), '0');
      xlPut(sh, r, 3, Math.round(o.wo), xlBodyStyle(fill, XLC.blue, true), '#,##0');
      xlPut(sh, r, 4, o.wd, xlBodyStyle(fill, XLC.text, true), '#,##0.00');
      sh.heights[r++] = 20;
    });
    const st = (col: string) => ({ font: xlFont(col, true, 12), fill: xlFill(XLC.amberBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) });
    xlPut(sh, r, 0, reg + ' TOTAL', st(XLC.amber)); xlPut(sh, r, 1, '', st(XLC.amber)); xlPut(sh, r, 2, '', st(XLC.amber));
    xlPut(sh, r, 3, Math.round(to), st(XLC.amber), '#,##0'); xlPut(sh, r, 4, tw, st(XLC.amber), '#,##0.00');
    sh.heights[r++] = 22;
  });
  return xlFinalize(sh, [22, 34, 12, 16, 16], 0, XL_HEADER_START + 1);
}

// ── PT Hourly sheet ─────────────────────────────────────────────────
function buildPTHourlySheet(model: PTHourlyModel, p: string, catLabel: string, t: string, dateLabel: string, staff: Record<string, StaffInfo>) {
  const sh = createXlSheet();
  const baseHeaders = [{ label: 'GID', bg: '0284C7' }, { label: 'Name', bg: '7C3AED' }, { label: 'Primary', bg: 'D97706' }, { label: 'Team Leader', bg: '059669' }, { label: 'Total', bg: '0891B2' }];
  const baseCount = baseHeaders.length;
  const hourLabels = Array.from({ length: 24 }, (_, i) => slotLabel(i));
  const numCols = baseCount + hourLabels.length;
  const subtitle = [`Project: ${p}`, catLabel ? `Category: ${catLabel}` : null, `Task: ${t}`, `Date: ${dateLabel}`, `${model.gids.length} QATs`, `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`].filter(Boolean).join('   |   ');
  xlBanner(sh, numCols, 'TEAM THEVIDU DASHBOARD  |  HOURLY REPORT', subtitle);
  const TOP = XL_HEADER_START;
  baseHeaders.forEach((h, c) => xlPut(sh, TOP, c, h.label, xlHeaderStyle(h.bg, XLC.white, 11)));
  hourLabels.forEach((h, i) => xlPut(sh, TOP, baseCount + i, h, xlHeaderStyle(SLOT_HEADER_COLORS[i % SLOT_HEADER_COLORS.length], XLC.white, 11)));
  sh.heights[TOP] = 30;
  model.gids.forEach((gid, i) => {
    const r = TOP + 1 + i;
    const gd = model.hourlyMap[gid];
    const isG = gd.center === 'GSSC';
    const info = staff[nid(gid)] || ({ id: '', name: '—', primary: '—', tl: '—', doj: '' } as StaffInfo);
    const fill = i % 2 === 0 ? XLC.white : XLC.zebra;
    const accent = isG ? XLC.blue : XLC.purple;
    let c = 0;
    xlPut(sh, r, c++, gid, xlBodyStyle(fill, accent, true));
    xlPut(sh, r, c++, info.name || '—', xlBodyStyle(fill, XLC.text, true));
    xlPut(sh, r, c++, info.primary || '—', xlBodyStyle(fill, XLC.soft));
    xlPut(sh, r, c++, info.tl || '—', xlBodyStyle(fill, XLC.soft));
    xlPut(sh, r, c++, gd.total, xlBodyStyle(fill, accent, true), '#,##0;-#,##0;"—"');
    hourLabels.forEach((_, idx) => {
      const v = gd.h[idx] || 0;
      if (v > 0) xlPut(sh, r, c++, v, xlBodyStyle(isG ? XLC.blueBg : XLC.purpleBg, accent, true), '#,##0;-#,##0;"—"');
      else xlPut(sh, r, c++, '—', xlBodyStyle(fill, XLC.muted));
    });
    sh.heights[r] = 21;
  });
  let r = TOP + 1 + model.gids.length;
  const writeFooter = (label: string, labelColor: string, fillBg: string, total: number, perHour: Record<number, number>) => {
    let c = 0;
    xlPut(sh, r, c++, label, { font: xlFont(labelColor, true, 11), fill: xlFill(fillBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) });
    for (let k = 0; k < 3; k++) xlPut(sh, r, c++, '', { font: xlFont(labelColor, true, 11), fill: xlFill(fillBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) });
    xlPut(sh, r, c++, total, { font: xlFont(labelColor, true, 12), fill: xlFill(fillBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) }, '#,##0;-#,##0;"—"');
    hourLabels.forEach((_, i) => {
      const v = perHour[i] || 0;
      if (v > 0) xlPut(sh, r, c++, v, { font: xlFont(labelColor, true, 12), fill: xlFill(fillBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) }, '#,##0;-#,##0;"—"');
      else xlPut(sh, r, c++, '—', { font: xlFont(XLC.muted, false, 11), fill: xlFill(fillBg), alignment: XL_CENTER, border: xlBorder(XLC.borderDark) });
    });
    sh.heights[r] = 22;
    r++;
  };
  if (model.showGSSC && model.centerTotals.GSSC > 0) writeFooter('GSSC', XLC.blue, XLC.blueBg, model.centerTotals.GSSC, model.centerHourTotals.GSSC);
  if (model.showGSSK && model.centerTotals.GSSK > 0) writeFooter('GSSK', XLC.purple, XLC.purpleBg, model.centerTotals.GSSK, model.centerHourTotals.GSSK);
  writeFooter('COMBINED', XLC.amber, XLC.amberBg, model.combinedTotal, model.hourTotals);
  const widths = [12, 24, 18, 22, 12];
  hourLabels.forEach(() => widths.push(11));
  const ws = xlFinalize(sh, widths, 5, 5);
  const X = window.XLSX!;
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: TOP, c: 0 }, e: { r: TOP + model.gids.length, c: numCols - 1 } }) };
  return ws;
}

// ── PT Data sheet ───────────────────────────────────────────────────
function buildPTDataSheet(rows: RawRow[], p: string, catLabel: string, t: string, dateLabel: string, regionMap: Record<string, string>) {
  if (!rows || !rows.length) return null;
  const sh = createXlSheet();
  const cols = [
    { key: 'timestamp', kind: 'date', label: 'DATE' }, { key: 'timestamp', kind: 'time', label: 'TIME' },
    { key: 'category', kind: 'data', label: 'CATEGORY' }, { key: 'region', kind: 'data', label: 'REGION' },
    { key: 'project_name', kind: 'data', label: 'PROJECT NAME' }, { key: 'task_name', kind: 'data', label: 'TASK NAME' },
    { key: 'template_name', kind: 'data', label: 'TEMPLATE NAME' }, { key: 'staff_id', kind: 'data', label: 'STAFF ID' },
    { key: 'value', kind: 'data', label: 'VALUE' }, { key: 'denominator', kind: 'data', label: 'DENOMINATOR' },
    { key: 'wd', kind: 'data', label: 'WD' }, { key: 'count', kind: 'data', label: 'COUNT' },
  ];
  const numCols = cols.length;
  const subtitle = [`Project: ${p}`, catLabel ? `Category: ${catLabel}` : null, `Task: ${t}`, `Date: ${dateLabel}`, `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`].filter(Boolean).join('   |   ');
  xlBanner(sh, numCols, 'TEAM THEVIDU DASHBOARD  |  PROJECT DATA', subtitle);
  const TOP = XL_HEADER_START;
  cols.forEach((col, c) => xlPut(sh, TOP, c, col.label, xlHeaderStyle(FIREBASE_HEADER_COLORS[c % FIREBASE_HEADER_COLORS.length], XLC.white, 12)));
  sh.heights[TOP] = 30;
  rows.forEach((row, i) => {
    const r = TOP + 1 + i;
    const fill = i % 2 === 0 ? XLC.white : XLC.zebra;
    cols.forEach((col, c) => {
      const k = col.key;
      const v = (row as any)[k];
      if (v === undefined || v === null) { xlPut(sh, r, c, '', xlBodyStyle(fill)); return; }
      if (col.kind === 'date') {
        const d = parseTsForExcel(String(v));
        if (!d) { xlPut(sh, r, c, String(v), xlBodyStyle(fill, XLC.text, true)); return; }
        const serial = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
        xlPut(sh, r, c, serial, xlBodyStyle(fill, XLC.text, true), 'yyyy-mm-dd');
        return;
      }
      if (col.kind === 'time') {
        const d = parseTsForExcel(String(v));
        if (!d) { xlPut(sh, r, c, '', xlBodyStyle(fill)); return; }
        const serial = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
        xlPut(sh, r, c, serial, xlBodyStyle(fill, XLC.text, true), 'hh:mm:ss AM/PM');
        return;
      }
      if (typeof v === 'number') { xlPut(sh, r, c, v, xlBodyStyle(fill, k === 'value' || k === 'wd' ? XLC.blue : XLC.text, k === 'value' || k === 'wd'), k === 'wd' ? '0.00' : undefined); return; }
      if (typeof v === 'object') { xlPut(sh, r, c, JSON.stringify(v), xlBodyStyle(fill, XLC.soft)); return; }
      const isId = k === 'staff_id' || k === 'region';
      xlPut(sh, r, c, String(v), xlBodyStyle(fill, isId ? XLC.cyanText : XLC.soft, isId));
    });
    sh.heights[r] = 20;
  });
  const widths = cols.map((col) => {
    if (col.kind === 'date' || col.kind === 'time') return 16;
    let max = col.label.length;
    rows.forEach((r) => { const v = (r as any)[col.key]; const len = v === undefined || v === null ? 0 : String(v).length; if (len > max) max = len; });
    return Math.min(Math.max(14, max + 4), 40);
  });
  const ws = xlFinalize(sh, widths, 0, 5);
  const X = window.XLSX!;
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: TOP, c: 0 }, e: { r: TOP + rows.length, c: numCols - 1 } }) };
  return ws;
}

// ── Staff lookup (accepts Record OR array) ──────────────────────────
// HourlyView passes an array (toStaffArray) while other callers pass a
// Record keyed by id. Indexing an array with an id string returned
// undefined, so DOJ was empty and every daily target became 100.
const DOJ_KEYS = ['doj', 'DOJ', 'Doj', 'date_of_joining', 'dateOfJoining', 'joining_date', 'joiningDate', 'join_date', 'joinDate', 'date_joined', 'dateJoined'];

function buildStaffLookup(staff: unknown): Map<string, StaffInfo> {
  const map = new Map<string, StaffInfo>();
  const add = (key: unknown, v: any) => {
    if (!v || typeof v !== 'object') return;
    const k = nid(v.id ?? v.gid ?? v.staff_id ?? v.staffId ?? key);
    if (!k || map.has(k)) return;
    let doj = '';
    for (const f of DOJ_KEYS) {
      if (v[f]) { doj = String(v[f]); break; }
    }
    map.set(k, {
      id: String(v.id ?? v.gid ?? v.staff_id ?? key ?? ''),
      name: v.name ?? '—',
      primary: v.primary ?? '—',
      tl: v.tl ?? v.team_leader ?? v.teamLead ?? '—',
      doj,
    });
  };
  if (Array.isArray(staff)) staff.forEach((v) => add(undefined, v));
  else if (staff && typeof staff === 'object') Object.entries(staff as Record<string, unknown>).forEach(([k, v]) => add(k, v));
  return map;
}

// ── Hourly Excel export (full workbook) ─────────────────────────────
export async function exportHourlyExcel(
  filteredRows: RawRow[], data: HourlyStaff[], tl: string, date: string,
  staff: Record<string, StaffInfo> | StaffInfo[], regionMap: Record<string, string>, basename: string,
): Promise<void> {
  const X = window.XLSX!, J = window.JSZip!;
  if (!X || !J) { alert('Excel library not loaded — try again in a moment.'); return; }
  if (!data.length) { alert('No data to export'); return; }
  const staffLookup = buildStaffLookup(staff);
  const firebaseRowsByStaff: Record<string, RawRow[]> = {};
  filteredRows.forEach((r) => { const id = nid(r.staff_id); if (!firebaseRowsByStaff[id]) firebaseRowsByStaff[id] = []; firebaseRowsByStaff[id].push(r); });
  const staffEntries: StaffEntry[] = data.map((s) => {
    const info = staffLookup.get(nid(s.id)) || ({ id: '', name: '—', primary: '—', tl: '—', doj: '' } as StaffInfo);
    const doj = info.doj || '';
    const dailyTarget = calculateDailyTarget(doj);
    const hours: Record<string, { wd: number; wo: number }> = {};
    for (const [slotIdx, v] of Object.entries(s.h)) { const label = slotLabel(parseInt(slotIdx)); hours[label] = { wd: v.wd, wo: v.wo }; }
    return { staff_id: s.id, name: s.name, primary: s.primary, tl: s.tl, doj, dailyTarget, totalWD: s.wd, totalWO: s.wo, hours, firebaseRows: firebaseRowsByStaff[nid(s.id)] || [] };
  });
  const slotData: Record<string, Record<string, { wd: number; wo: number }>> = {};
  staffEntries.forEach((s) => { slotData[s.staff_id] = s.hours; });
  const activeCount = staffEntries.filter((s) => s.totalWD > 0).length;
  const idleCount = staffEntries.length - activeCount;
  const subtitle = [`Date: ${date}`, `Team Leader: ${tl || 'All'}`, `${staffEntries.length} staff (${activeCount} active / ${idleCount} idle)`, `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`].join('   |   ');
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, buildGeneralSheet(staffEntries, subtitle), 'General Info');
  X.utils.book_append_sheet(wb, buildHourlySheet(staffEntries, slotData, true, subtitle), 'Hourly Data');
  X.utils.book_append_sheet(wb, buildSummarySheet(staffEntries), 'Summary');
  const enrichedRows = filteredRows.map((r) => ({ ...r, region: getProjectRegion(String(r.project_name ?? ''), regionMap) }));
  const allDataWs = buildAllDataSheet(enrichedRows, `Hourly Data — All Rows — ${tl || 'All team leaders'} — ${date}`, `${filteredRows.length.toLocaleString()} rows | Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
  X.utils.book_append_sheet(wb, buildRegionSheet(filteredRows, subtitle, regionMap), 'By Region');
  if (allDataWs) X.utils.book_append_sheet(wb, allDataWs, 'All Data');
  try { await exportWorkbookWithFreeze(wb, basename + '.xlsx'); }
  catch (e) { console.error(e); alert('Excel export failed: ' + (e as Error).message); }
}

// ── PT Excel export ─────────────────────────────────────────────────
export async function exportPTExcel(
  model: PTHourlyModel, p: string, t: string, date: string, dateLabel: string,
  catLabel: string, staff: Record<string, StaffInfo>, regionMap: Record<string, string>,
): Promise<void> {
  const X = window.XLSX!, J = window.JSZip!;
  if (!X || !J) { alert('Excel library not loaded — try again in a moment.'); return; }
  if (!model || !model.gids.length) { alert('No data to export — fetch data first'); return; }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, buildPTHourlySheet(model, p, catLabel, t, dateLabel, staff), 'Hourly Report');
  const dataWs = buildPTDataSheet(model.filteredRows.map((r) => ({ ...r, region: getProjectRegion(String(r.project_name ?? ''), regionMap) })), p, catLabel, t, dateLabel, regionMap);
  if (dataWs) X.utils.book_append_sheet(wb, dataWs, 'Project Data');
  const projCap = cap(p || 'project');
  const fileName = `Hourly Report ${projCap}${catLabel ? ` (${catLabel})` : ''} ${t} (${date}).xlsx`;
  try { await exportWorkbookWithFreeze(wb, fileName); }
  catch (e) { console.error(e); alert('Excel export failed: ' + (e as Error).message); }
}

// ── GID Excel export ────────────────────────────────────────────────
export async function gidExcel(rows: GidAgg[], hours: number[], gid: string, name: string, info: StaffInfo): Promise<void> {
  const X = window.XLSX!, J = window.JSZip!;
  if (!X || !J) { alert('Excel library not loaded'); return; }
  const sub = `GID: ${cap(String(gid))}   |   Primary: ${info.primary || '—'}   |   Team Leader: ${info.tl || '—'}   |   Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  const wb = X.utils.book_new();
  // Summary
  let sh = createXlSheet();
  const H = ['#', 'Project Name', 'Task Name', 'Region', 'Output Count', 'Deno Rate', 'With Deno'];
  const BG = ['64748B', '0284C7', '7C3AED', 'D97706', '059669', '0891B2', 'EA580C'];
  xlBanner(sh, H.length, `${name.toUpperCase()}  |  ${cap(String(gid))}  |  SUMMARY`, sub);
  H.forEach((h, c) => xlPut(sh, XL_HEADER_START, c, h, xlHeaderStyle(BG[c], XLC.white, 12)));
  sh.heights[XL_HEADER_START] = 28;
  rows.forEach((r, i) => {
    const R = XL_HEADER_START + 1 + i, f = i % 2 ? XLC.zebra : XLC.white, em = (r.region || '').trim().toUpperCase() === 'EMEA';
    xlPut(sh, R, 0, i + 1, xlBodyStyle(f, XLC.muted));
    xlPut(sh, R, 1, r.project, xlBodyStyle(f, XLC.cyanText, true));
    xlPut(sh, R, 2, r.task, xlBodyStyle(f));
    xlPut(sh, R, 3, r.region, xlBodyStyle(em ? XLC.blueBg : XLC.redBg, em ? XLC.blue : XLC.red, true));
    xlPut(sh, R, 4, Math.round(r.count), xlBodyStyle(f, XLC.blue, true), '#,##0');
    xlPut(sh, R, 5, r.count > 0 ? r.earned / r.count : 0, xlBodyStyle(f, XLC.soft), '0.00');
    xlPut(sh, R, 6, r.earned, xlBodyStyle(f, XLC.amber, true), '0.00');
    sh.heights[R] = 21;
  });
  const TR = XL_HEADER_START + 1 + rows.length;
  const ts = (col: string) => xlBodyStyle(XLC.zebra, col, true);
  for (let c = 0; c < 4; c++) xlPut(sh, TR, c, c === 3 ? 'TOTAL' : '', ts(XLC.text));
  xlPut(sh, TR, 4, Math.round(rows.reduce((n, r) => n + r.count, 0)), ts(XLC.green), '#,##0');
  xlPut(sh, TR, 5, '', ts(XLC.muted));
  xlPut(sh, TR, 6, rows.reduce((n, r) => n + r.earned, 0), ts(XLC.amber), '0.00');
  X.utils.book_append_sheet(wb, xlFinalize(sh, [6, 28, 28, 14, 16, 14, 16], 0, XL_HEADER_START + 1), 'Summary');
  // Hourly
  sh = createXlSheet();
  const nc = 2 + hours.length + 1;
  xlBanner(sh, nc, `${name.toUpperCase()}  |  HOURLY DATA`, sub);
  let R = XL_HEADER_START;
  [['deno', 'With Deno', 'D97706', '0.00'], ['count', 'Output Count', '2563EB', '#,##0']].forEach(([m, lab, ac, nf]) => {
    for (let c = 0; c < nc; c++) xlPut(sh, R, c, c === 0 ? (lab as string).toUpperCase() : '', { font: xlFont(XLC.white, true, 13), fill: xlFill(ac as string), alignment: { horizontal: 'left', vertical: 'center', indent: 1 } });
    sh.merges.push({ s: { r: R, c: 0 }, e: { r: R, c: nc - 1 } }); R++;
    xlPut(sh, R, 0, 'Project', xlHeaderStyle('0284C7'));
    xlPut(sh, R, 1, 'Task', xlHeaderStyle('7C3AED'));
    hours.forEach((h, j) => xlPut(sh, R, 2 + j, slotLabel(h), xlHeaderStyle(SLOT_HEADER_COLORS[j % SLOT_HEADER_COLORS.length])));
    xlPut(sh, R, 2 + hours.length, 'Total', xlHeaderStyle('059669')); R++;
    const ct = hours.map(() => 0);
    rows.forEach((r, i) => {
      const f = i % 2 ? XLC.zebra : XLC.white;
      xlPut(sh, R, 0, r.project, xlBodyStyle(f, XLC.cyanText, true));
      xlPut(sh, R, 1, r.task, xlBodyStyle(f));
      let rt = 0;
      hours.forEach((h, j) => { const x = r.hours[h]; const v = x ? (m === 'deno' ? x.earned : x.count) : 0; rt += v; ct[j] += v; if (v > 0) xlPut(sh, R, 2 + j, v, xlBodyStyle(f, XLC.text, true), nf as string); else xlPut(sh, R, 2 + j, '—', xlBodyStyle(XLC.dashBg, XLC.dash)); });
      xlPut(sh, R, 2 + hours.length, rt, xlBodyStyle(f, XLC.green, true), nf as string);
      R++;
    });
    xlPut(sh, R, 0, 'Hourly Total', ts(XLC.text)); xlPut(sh, R, 1, '', ts(XLC.text));
    ct.forEach((v, j) => xlPut(sh, R, 2 + j, v, ts(XLC.green), nf as string));
    xlPut(sh, R, 2 + hours.length, ct.reduce((a, b) => a + b, 0), ts(XLC.amber), nf as string);
    R += 3;
  });
  X.utils.book_append_sheet(wb, xlFinalize(sh, [28, 28, ...hours.map(() => 11), 12], 2, 0), 'Hourly Data');
  try { await exportWorkbookWithFreeze(wb, sanitizeName(cap(String(gid)) + '-' + name + '-Report') + '.xlsx'); }
  catch (e) { console.error(e); alert('Excel export failed: ' + (e as Error).message); }
}

// ── Image capture + copy/download ───────────────────────────────────
export async function captureTableImage(src: HTMLElement, title: string): Promise<HTMLCanvasElement> {
  if (typeof window.html2canvas === 'undefined') throw Error('Image library not loaded yet');
  const clone = src.cloneNode(true) as HTMLElement;
  clone.id = '';
  Object.assign(clone.style, { position: 'absolute', left: '-99999px', top: '0', maxHeight: 'none', maxWidth: 'none', overflow: 'visible', border: 'none', borderRadius: '0', background: '#0b1020', padding: '20px', color: '#edf3ff', width: 'auto' });
  clone.querySelectorAll('th').forEach((th) => { (th as HTMLElement).style.position = 'static'; (th as HTMLElement).style.top = 'auto'; (th as HTMLElement).style.zIndex = 'auto'; });
  clone.querySelectorAll('td').forEach((td) => { if ((td as HTMLElement).style.position === 'sticky') (td as HTMLElement).style.position = 'static'; });
  if (title) {
    const h = document.createElement('div');
    h.style.cssText = 'padding:14px 18px;font:700 16px/1.4 Inter,sans-serif;color:#70e1c1;background:#121a2d;border:1px solid #293752;border-radius:10px;margin-bottom:14px';
    h.textContent = title;
    clone.insertBefore(h, clone.firstChild);
  }
  document.body.appendChild(clone);
  const w = Math.max(clone.scrollWidth, clone.offsetWidth);
  clone.style.width = w + 'px';
  try {
    return await window.html2canvas(clone, { backgroundColor: '#0b1020', scale: 2, logging: false, useCORS: true, width: w });
  } finally {
    document.body.removeChild(clone);
  }
}

export async function copyCanvas(canvas: HTMLCanvasElement, text: string): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return false;
    const items: Record<string, Blob> = { 'image/png': blob };
    if (text) items['text/plain'] = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch (e) {
    console.warn('Copy failed:', e);
    return false;
  }
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

export async function captureElement(el: HTMLElement, opts: Record<string, unknown> = {}): Promise<HTMLCanvasElement> {
  if (typeof window.html2canvas === 'undefined') throw Error('Image library not loaded yet');
  return await window.html2canvas(el, { backgroundColor: '#0f172a', scale: 2, logging: false, useCORS: true, ...opts });
}