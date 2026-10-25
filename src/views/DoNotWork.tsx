import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  RefreshCw, Search, ChevronDown, Filter,
  Download, Image as ImageIcon, FileSpreadsheet, ClipboardCopy,
} from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import JSZip from 'jszip';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SHEET_ID =
  '2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd';
const GID = '40889860';
const GID_POOLS = '143385079';

const fetchCSVFromGid = async (gid) => {
  const url = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${gid}&single=true&output=csv&_nc=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CSV LINE SPLITTER
// ─────────────────────────────────────────────────────────────────────────────
const splitCSVLine = (line) => {
  const out = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// TYPE ORDER + THEME
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_ORDER = ['pricing', 'stitching', 'masking'];
const TYPE_THEME = {
  pricing:   { label: 'Pricing',   accent: '#f2a9a9', rgb: '242,169,169', head: '#1d1319' },
  stitching: { label: 'Stitching', accent: '#8fd3ef', rgb: '143,211,239', head: '#101c2a' },
  masking:   { label: 'Masking',   accent: '#f0cd77', rgb: '240,205,119', head: '#1e190c' },
};
const themeVars = (theme) => ({
  '--rgb': theme.rgb,
  '--accent': theme.accent,
  '--head': theme.head,
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSER 1 — "Pool Project" tab
// ─────────────────────────────────────────────────────────────────────────────
const parseProjectCSV = (csv) => {
  const lines = csv.trim().split('\n').filter(l => l.trim() !== '');
  if (lines.length < 2) return {};

  const headerRow = splitCSVLine(lines[0]).map(c => c.toLowerCase());
  const blockStarts = [];
  headerRow.forEach((c, i) => {
    if (c.includes('pool project') || c === 'project') blockStarts.push(i);
  });
  if (blockStarts.length === 0) {
    for (let i = 0; i < headerRow.length; i += 3) blockStarts.push(i);
  }

  const sections = {};
  TYPE_ORDER.forEach(t => { sections[t] = []; });

  for (let li = 1; li < lines.length; li++) {
    const cells = splitCSVLine(lines[li]);
    blockStarts.forEach(start => {
      const project = (cells[start] ?? '').trim();
      const task = (cells[start + 1] ?? '').trim();
      const region = (cells[start + 2] ?? '').trim();
      if (!project) return;
      const t = task.toLowerCase();
      const key = t.includes('mask') ? 'masking' : t.includes('stitch') ? 'stitching' : t.includes('pric') ? 'pricing' : null;
      if (key) sections[key].push({ project, region });
    });
  }
  return sections;
};

// ─────────────────────────────────────────────────────────────────────────────
// PARSER 2 — "Pool QAT List" tab
// ─────────────────────────────────────────────────────────────────────────────
const COL_HEADER_KEYWORDS = ['qat', 'project', 'task', 'name', 'dedicated project', 'team leader', 'region'];
const CANONICAL_COL_ORDER = ['QAT', 'Project', 'Task', 'Name', 'Dedicated project', 'Team Leader', 'Region'];

const orderColumns = (cols) => {
  const norm = (s) => s.trim().toLowerCase();
  const used = new Set();
  const ordered = [];
  CANONICAL_COL_ORDER.forEach(c => {
    const match = cols.find(col => norm(col) === norm(c));
    if (match && !used.has(match)) { ordered.push(match); used.add(match); }
  });
  cols.forEach(col => { if (!used.has(col)) { ordered.push(col); used.add(col); } });
  return ordered;
};

const parsePoolCSV = (csv) => {
  const lines = csv.trim().split('\n').filter(l => l.trim() !== '');
  if (lines.length < 3) return {};

  let sectionRowIdx = -1;
  let colHeaderRowIdx = -1;

  for (let i = 0; i < Math.min(6, lines.length); i++) {
    const cells = splitCSVLine(lines[i]).map(c => c.toLowerCase());
    const secScore = cells.filter(c => TYPE_ORDER.some(t => c.includes(t))).length;
    const colScore = COL_HEADER_KEYWORDS.filter(kw => cells.some(c => c === kw || c.includes(kw))).length;
    if (sectionRowIdx === -1 && secScore > 0) sectionRowIdx = i;
    if (colHeaderRowIdx === -1 && colScore >= 3 && (sectionRowIdx === -1 || i > sectionRowIdx)) colHeaderRowIdx = i;
  }
  if (sectionRowIdx === -1) sectionRowIdx = 0;
  if (colHeaderRowIdx === -1) colHeaderRowIdx = sectionRowIdx + 1;
  const dataStartIdx = colHeaderRowIdx + 1;

  const sectionCells = splitCSVLine(lines[sectionRowIdx]);
  const colHeaderCells = splitCSVLine(lines[colHeaderRowIdx]);
  const maxCols = Math.max(sectionCells.length, colHeaderCells.length);

  let curSec = '';
  const secPerCol = [];
  for (let i = 0; i < maxCols; i++) {
    const v = (sectionCells[i] ?? '').trim();
    if (v) curSec = v;
    secPerCol.push(curSec.toLowerCase());
  }
  const normSection = (s) => TYPE_ORDER.find(t => s.includes(t)) ?? null;

  const colMeta = Array.from({ length: maxCols }, (_, i) => ({
    sectionId: normSection(secPerCol[i] ?? ''),
    label: (colHeaderCells[i] ?? '').trim(),
  }));

  const sectionsMap = {};
  TYPE_ORDER.forEach(t => { sectionsMap[t] = { cols: [], rows: [] }; });

  colMeta.forEach(({ sectionId, label }) => {
    if (sectionId && label && !sectionsMap[sectionId].cols.includes(label)) {
      sectionsMap[sectionId].cols.push(label);
    }
  });
  TYPE_ORDER.forEach(t => { sectionsMap[t].cols = orderColumns(sectionsMap[t].cols); });

  for (let li = dataStartIdx; li < lines.length; li++) {
    const cells = splitCSVLine(lines[li]);
    const perSectionRow = {};
    colMeta.forEach(({ sectionId, label }, i) => {
      if (!sectionId || !label) return;
      if (!perSectionRow[sectionId]) perSectionRow[sectionId] = {};
      perSectionRow[sectionId][label] = (cells[i] ?? '').trim();
    });
    Object.entries(perSectionRow).forEach(([sectionId, rowObj]) => {
      const hasData = Object.values(rowObj).some(v => v !== '');
      if (hasData) sectionsMap[sectionId].rows.push(rowObj);
    });
  }
  return sectionsMap;
};

// ─────────────────────────────────────────────────────────────────────────────
// QAT column layout
// ─────────────────────────────────────────────────────────────────────────────
const QAT_EXPORT_COLUMNS = [
  { canonical: 'QAT',               exportLabel: 'QAT' },
  { canonical: 'Name',              exportLabel: 'Name' },
  { canonical: 'Dedicated project', exportLabel: 'Dedicated project' },
  { canonical: 'Project',           exportLabel: 'Pool Project' },
  { canonical: 'Task',              exportLabel: 'Task' },
  { canonical: 'Team Leader',       exportLabel: 'Team Leader' },
];

const QAT_VISIBLE_COLUMNS = [
  { canonical: 'QAT',               display: 'QAT' },
  { canonical: 'Name',              display: 'Name' },
  { canonical: 'Dedicated project', display: 'Dedicated project' },
  { canonical: 'Project',           display: 'Pool Project' },
  { canonical: 'Task',              display: 'Task' },
  { canonical: 'Team Leader',       display: 'Team Leader' },
  { canonical: 'Region',            display: 'Region' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES BACKGROUND
// ─────────────────────────────────────────────────────────────────────────────
const Particles = () => {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    let raf;
    const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const pts = Array.from({ length: 50 }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.3 + 0.3,
      dx: (Math.random() - 0.5) * 0.3, dy: (Math.random() - 0.5) * 0.3,
      a: Math.random() * 0.3 + 0.06,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach(p => {
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,210,225,${p.a})`; ctx.fill();
      });
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
          const d = Math.hypot(dx, dy);
          if (d < 110) {
            ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = `rgba(0,210,225,${0.12 * (1 - d / 110)})`;
            ctx.lineWidth = 0.5; ctx.stroke();
          }
        }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />;
};

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const wrapCanvasText = (ctx, text, maxWidth) => {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const lines = [];
  raw.split('\n').forEach(para => {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); return; }
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
};

const tableToCanvas = (tableEl, _bgColor = '#0b1220', scale = 2) => {
  if (!tableEl) throw new Error('No table element supplied');

  const trs = Array.from(tableEl.querySelectorAll('tr'));
  if (trs.length === 0) throw new Error('Table has no rows');

  const grid = trs.map(tr => Array.from(tr.children));
  const colCount = grid.reduce((m, cells) => Math.max(m, cells.length), 0);
  if (colCount === 0) throw new Error('Table has no columns');

  const colWidths = new Array(colCount).fill(0);
  grid.forEach(cells => {
    cells.forEach((cell, i) => {
      const w = cell.getBoundingClientRect().width;
      if (w > colWidths[i]) colWidths[i] = w;
    });
  });
  const rowHeights = grid.map(cells =>
    cells.reduce((m, c) => Math.max(m, c.getBoundingClientRect().height), 0)
  );

  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(totalW * scale));
  canvas.height = Math.max(1, Math.ceil(totalH * scale));

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  let y = 0;
  grid.forEach((cells, ri) => {
    const h = rowHeights[ri];
    let x = 0;
    cells.forEach((cell, ci) => {
      const w = colWidths[ci];
      const cs = window.getComputedStyle(cell);

      const cellBg = cs.backgroundColor;
      if (cellBg && cellBg !== 'transparent' && cellBg !== 'rgba(0, 0, 0, 0)') {
        ctx.fillStyle = cellBg;
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(x, y, w, h);
      }

      const text = (cell.innerText ?? cell.textContent ?? '').trim();
      ctx.font = `${cs.fontStyle || 'normal'} ${cs.fontWeight || '400'} ${cs.fontSize || '13px'} ${cs.fontFamily || 'Inter, system-ui, sans-serif'}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : (cs.letterSpacing || '0px');
      ctx.fillStyle = cs.color || '#e2e8f0';

      const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
      ctx.textAlign = align;

      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const availW = Math.max(4, w - padL - padR);

      let tx;
      if (align === 'center') tx = x + w / 2;
      else if (align === 'right') tx = x + w - padR;
      else tx = x + padL;

      if (text) {
        const fontSize = parseFloat(cs.fontSize) || 13;
        const lineHeight = fontSize * 1.3;
        const lines = wrapCanvasText(ctx, text, availW);
        let ty = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        lines.forEach(line => {
          ctx.fillText(line, tx, ty);
          ty += lineHeight;
        });
        ctx.restore();
      }

      const bwB = parseFloat(cs.borderBottomWidth) || 0;
      if (bwB > 0 && cs.borderBottomStyle !== 'none') {
        ctx.strokeStyle = cs.borderBottomColor;
        ctx.lineWidth = bwB;
        ctx.beginPath();
        ctx.moveTo(x, y + h - bwB / 2);
        ctx.lineTo(x + w, y + h - bwB / 2);
        ctx.stroke();
      }
      const bwR = parseFloat(cs.borderRightWidth) || 0;
      if (bwR > 0 && cs.borderRightStyle !== 'none') {
        ctx.strokeStyle = cs.borderRightColor;
        ctx.lineWidth = bwR;
        ctx.beginPath();
        ctx.moveTo(x + w - bwR / 2, y);
        ctx.lineTo(x + w - bwR / 2, y + h);
        ctx.stroke();
      }

      x += w;
    });
    y += h;
  });

  return canvas;
};

const tableToPngDataUrl = (tableEl, bgColor) =>
  tableToCanvas(tableEl, bgColor).toDataURL('image/png');

const tableToPngBlob = (tableEl, bgColor) =>
  new Promise((resolve, reject) => {
    try {
      const canvas = tableToCanvas(tableEl, bgColor);
      if (canvas.toBlob) {
        canvas.toBlob(
          blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
          'image/png'
        );
      } else {
        const dataUrl = canvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/png' }));
      }
    } catch (e) {
      reject(e);
    }
  });

const downloadDataUrl = (dataUrl, filename) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL STYLED HELPERS (banner + colored headers + freeze + autofilter)
// ─────────────────────────────────────────────────────────────────────────────
const XL = {
  navy: '0F172A',
  slate: '1E293B',
  accent: '06B6D4',
  white: 'FFFFFF',
  zebra: 'F8FAFC',
  border: 'CBD5E1',
  text: '0F172A',
  soft: '475569',
  muted: '94A3B8',
};

const XL_PAD_ROWS = 60;
const XL_PAD_COLS = 20;
const XL_HEADER_ROW = 4;
const XL_HEADER_COLORS = [
  '0284C7', '7C3AED', 'D97706', '059669', 'EA580C', 'BE185D',
  '0891B2', '4F46E5', '0F766E', '1D4ED8', '6D28D9', 'A21CAF',
  'BE123C', 'C2410C', 'A16207', '15803D',
];

const xlFont = (color, bold = false, sz = 11) => ({ name: 'Calibri', sz, bold, color: { rgb: color } });
const xlFill = (rgb) => ({ patternType: 'solid', fgColor: { rgb } });
const xlBorder = (rgb) => {
  const b = { style: 'thin', color: { rgb } };
  return { top: b, bottom: b, left: b, right: b };
};
const XL_CENTER = { horizontal: 'center', vertical: 'center', wrapText: true };

const xlHeaderStyle = (bg, color = XL.white, sz = 11) => ({
  font: xlFont(color, true, sz),
  fill: xlFill(bg),
  alignment: XL_CENTER,
  border: xlBorder(XL.white),
});

const xlBodyStyle = (fill, color = XL.text, bold = false) => ({
  font: xlFont(color, bold, 11),
  fill: xlFill(fill),
  alignment: XL_CENTER,
  border: xlBorder(XL.border),
});

const xlPut = (sh, r, c, v, s, z) => {
  const cell = { t: typeof v === 'number' ? 'n' : 's', v, s };
  if (z) cell.z = z;
  sh.ws[XLSX.utils.encode_cell({ r, c })] = cell;
  if (r > sh.maxRow) sh.maxRow = r;
};

const xlBanner = (sh, numCols, title, subtitle) => {
  for (let c = 0; c < numCols; c++) {
    xlPut(sh, 0, c, c === 0 ? title : '', {
      font: xlFont(XL.white, true, 18),
      fill: xlFill(XL.navy),
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    });
    xlPut(sh, 1, c, c === 0 ? subtitle : '', {
      font: xlFont('CBD5E1', false, 10),
      fill: xlFill(XL.slate),
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    });
    xlPut(sh, 2, c, '', { fill: xlFill(XL.accent) });
  }
  for (let r = 0; r < 3; r++) sh.merges.push({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
  sh.heights[0] = 38;
  sh.heights[1] = 22;
  sh.heights[2] = 5;
  sh.heights[3] = 10;
};

const xlFinalize = (sh, widths, freezeCols = 0) => {
  const numCols = widths.length;
  const lastRow = sh.maxRow + XL_PAD_ROWS;
  const lastCol = numCols + XL_PAD_COLS - 1;
  for (let r = 0; r <= lastRow; r++) {
    for (let c = 0; c <= lastCol; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!sh.ws[addr]) sh.ws[addr] = { t: 's', v: '', s: { fill: xlFill(XL.white) } };
    }
  }
  sh.ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
  sh.ws['!cols'] = [
    ...widths.map(wch => ({ wch })),
    ...Array.from({ length: XL_PAD_COLS }, () => ({ wch: 10 })),
  ];
  const rows = [];
  Object.entries(sh.heights).forEach(([r, h]) => { rows[Number(r)] = { hpt: h }; });
  sh.ws['!rows'] = rows;
  if (sh.merges.length > 0) sh.ws['!merges'] = sh.merges;
  sh.ws['!views'] = [{ showGridLines: false }];
  sh.ws['!xFreeze'] = freezeCols;
  return sh.ws;
};

const exportWorkbookWithFreeze = async (wb, filename) => {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const zip = await JSZip.loadAsync(out);

  // Banner (rows 0-3) + header row (row 4) = 5 rows frozen at the top
  const ySplit = XL_HEADER_ROW + 1;

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;

    const n = (wb.Sheets[wb.SheetNames[i]]['!xFreeze']) || 0;
    const topLeft = XLSX.utils.encode_cell({ r: ySplit, c: n });

    const pane =
      n > 0
        ? `<pane xSplit="${n}" ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>` +
          `<selection pane="topRight"/>` +
          `<selection pane="bottomLeft"/>` +
          `<selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
        : `<pane ySplit="${ySplit}" topLeftCell="${topLeft}" activePane="bottomLeft" state="frozen"/>` +
          `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`;

    const views = `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews>`;

    const xml = await file.async('string');
    zip.file(path, xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views));
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Excel sheet names: max 31 chars, cannot contain \ / ? * [ ] :
const sanitizeSheetName = (name) => {
  const cleaned = (name || 'Data').replace(/[\\/?*\[\]:]/g, '_').trim();
  const truncated = cleaned.slice(0, 31);
  return truncated || 'Data';
};

// Freeze up to & including the first meaningful "ID-like" column.
// Priority: QAT → QAT ID → Pool Project → GID → first column.
const computeFreezeCols = (headers) => {
  const target = ['qat', 'qat id', 'pool project', 'gid'];
  for (const t of target) {
    const idx = headers.findIndex(h => h.trim().toLowerCase() === t);
    if (idx >= 0) return idx + 1;
  }
  return headers.length > 0 ? 1 : 0;
};

const buildStyledSheet = (headers, rows, title, subtitle, freezeCols) => {
  const sh = { ws: {}, merges: [], heights: {}, maxRow: 0 };
  const numCols = Math.max(headers.length, 1);

  xlBanner(sh, numCols, title, subtitle);

  headers.forEach((h, c) => {
    const bg = XL_HEADER_COLORS[c % XL_HEADER_COLORS.length];
    xlPut(sh, XL_HEADER_ROW, c, String(h).toUpperCase(), xlHeaderStyle(bg, XL.white, 11));
  });
  sh.heights[XL_HEADER_ROW] = 30;

  rows.forEach((row, i) => {
    const r = XL_HEADER_ROW + 1 + i;
    const fill = i % 2 === 0 ? XL.white : XL.zebra;
    headers.forEach((h, c) => {
      const raw = row[h];
      const str = raw === null || raw === undefined ? '' : String(raw);
      const cleaned = str.replace(/,/g, '');
      const num = str.trim() !== '' && !isNaN(Number(cleaned)) && isFinite(Number(cleaned))
        ? Number(cleaned)
        : null;

      const style = xlBodyStyle(fill, XL.text, false);
      sh.ws[XLSX.utils.encode_cell({ r, c })] = num !== null
        ? { t: 'n', v: num, s: style }
        : { t: 's', v: str || '—', s: style };
    });
    sh.heights[r] = 21;
  });

  const widths = headers.map(h => {
    let max = String(h).length;
    rows.forEach(r => {
      const len = String(r[h] ?? '').length;
      if (len > max) max = len;
    });
    return Math.min(Math.max(14, max + 4), 42);
  });

  const ws = xlFinalize(sh, widths, freezeCols);
  if (rows.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: XL_HEADER_ROW, c: 0 },
        e: { r: XL_HEADER_ROW + rows.length, c: numCols - 1 },
      }),
    };
  }
  return ws;
};

const exportRowsToExcel = async (headers, rows, filename, sheetName = 'Data') => {
  const freezeCols = computeFreezeCols(headers);
  const safeSheetName = sanitizeSheetName(sheetName);
  const subtitle = [
    `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
    `${rows.length} rows`,
    `${headers.length} columns`,
  ].join('   |   ');
  const ws = buildStyledSheet(headers, rows, safeSheetName.toUpperCase(), subtitle, freezeCols);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
  await exportWorkbookWithFreeze(wb, filename);
};

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const copyRowsAsBorderedText = async (headers, rows) => {
  const theadHtml = `<tr>${headers.map(h =>
    `<th style="border:1px solid #999999;padding:4px 10px;background:#e8edf2;font-weight:700;">${escapeHtml(h)}</th>`
  ).join('')}</tr>`;
  const tbodyHtml = rows.map(r =>
    `<tr>${headers.map(h =>
      `<td style="border:1px solid #999999;padding:4px 10px;">${escapeHtml(r[h])}</td>`
    ).join('')}</tr>`
  ).join('');
  const html = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;">${theadHtml}${tbodyHtml}</table>`;
  const text = [headers.join('\t'), ...rows.map(r => headers.map(h => r[h] ?? '').join('\t'))].join('\n');

  if (window.ClipboardItem && navigator.clipboard?.write) {
    const item = new window.ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
  } else {
    await navigator.clipboard.writeText(text);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HIDDEN EXPORT TABLE (used for PNG download / copy)
// ─────────────────────────────────────────────────────────────────────────────
const ExportTable = React.forwardRef(({ headers, rows, theme, showIndex }, ref) => (
  <div
    aria-hidden="true"
    style={{ position: 'absolute', left: -99999, top: 0, pointerEvents: 'none' }}
  >
    <table
      ref={ref}
      style={{
        borderCollapse: 'collapse',
        fontSize: 13,
        fontFamily: "'Manrope', Inter, system-ui, sans-serif",
        background: '#0b1220',
      }}
    >
      <thead>
        <tr>
          {showIndex && (
            <th style={exportThStyle(theme, true)}>#</th>
          )}
          {headers.map(h => (
            <th key={h} style={exportThStyle(theme)}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const bg = ri % 2 ? '#0d1626' : '#0b1220';
          return (
            <tr key={ri}>
              {showIndex && (
                <td style={{ ...exportTdStyle(bg), color: '#7d90a5', fontSize: 11, minWidth: 40 }}>{ri + 1}</td>
              )}
              {headers.map((h, hi) => (
                <td key={h} style={{ ...exportTdStyle(bg), fontWeight: hi === 0 ? 700 : 500 }}>
                  {row[h] ?? ''}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
));

const exportThStyle = (theme, isIndex = false) => ({
  padding: '11px 18px',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
  background: theme.head,
  color: isIndex ? '#7d90a5' : theme.accent,
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: '1px solid rgba(255,255,255,0.06)',
  borderBottom: `2px solid ${theme.accent}`,
});

const exportTdStyle = (bg) => ({
  padding: '9px 18px',
  textAlign: 'center',
  background: bg,
  color: '#e8eef6',
  fontSize: 13,
  whiteSpace: 'nowrap',
  minWidth: 110,
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: '1px solid rgba(255,255,255,0.05)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT TOOLBAR
// ─────────────────────────────────────────────────────────────────────────────
const exportBtnStyle = (accentColor) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
  borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${accentColor}40`, color: accentColor,
});

const ExportToolbar = ({ tableRef, headers, rows, filenameBase, accentColor, bgColor, sheetName }) => {
  const [status, setStatus] = useState('');
  const flash = (msg) => setStatus(msg);

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(''), 1800);
    return () => clearTimeout(id);
  }, [status]);

  const handleDownloadImage = () => {
    if (!tableRef.current) return;
    try {
      const dataUrl = tableToPngDataUrl(tableRef.current, bgColor);
      downloadDataUrl(dataUrl, `${filenameBase}.png`);
      flash('Image downloaded ✓');
    } catch (e) {
      console.error('Download image failed:', e);
      flash('Image download failed');
    }
  };

  const handleCopyImage = async () => {
    if (!tableRef.current) return;
    try {
      const blob = await tableToPngBlob(tableRef.current, bgColor);
      if (!window.ClipboardItem || !navigator.clipboard?.write) {
        flash('Clipboard images unsupported — use download');
        return;
      }
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      flash('Image copied ✓');
    } catch (e) {
      console.error('Copy image failed:', e);
      flash('Copy image failed — try download instead');
    }
  };

  const handleExportExcel = async () => {
    try {
      await exportRowsToExcel(headers, rows, `${filenameBase}.xlsx`, sheetName || 'Data');
      flash('Excel exported ✓');
    } catch (e) {
      console.error('Excel export failed:', e);
      flash('Excel export failed');
    }
  };

  const handleCopyText = async () => {
    try {
      await copyRowsAsBorderedText(headers, rows);
      flash('Copied with borders ✓');
    } catch (e) {
      console.error('Copy text failed:', e);
      flash('Copy failed');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={handleDownloadImage} title="Download table as image" style={exportBtnStyle(accentColor)}>
        <Download size={13} />
      </button>
      <button onClick={handleCopyImage} title="Copy table as image" style={exportBtnStyle(accentColor)}>
        <ImageIcon size={13} />
      </button>
      <button onClick={handleExportExcel} title="Export to Excel" style={exportBtnStyle(accentColor)}>
        <FileSpreadsheet size={13} />
      </button>
      <button onClick={handleCopyText} title="Copy as text with borders" style={exportBtnStyle(accentColor)}>
        <ClipboardCopy size={13} />
      </button>
      {status && <span style={{ fontSize: 10, color: accentColor, whiteSpace: 'nowrap' }}>{status}</span>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR BITS
// ─────────────────────────────────────────────────────────────────────────────
const RefreshButton = ({ spinning, onClick }) => (
  <button onClick={onClick} disabled={spinning} style={{
    display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8,
    cursor: spinning ? 'not-allowed' : 'pointer',
    background: 'rgba(0,229,255,0.09)', border: '1px solid rgba(0,229,255,0.25)',
    color: '#00e5ff', fontSize: 11, fontWeight: 800, letterSpacing: 1,
    textTransform: 'uppercase', opacity: spinning ? 0.4 : 1,
  }}>
    <RefreshCw size={11} className={spinning ? 'sp' : ''} />
    Refresh
  </button>
);

const SearchBox = ({ value, onChange, placeholder }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.3)',
    borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', padding: '5px 10px',
    flex: '1 1 auto', maxWidth: 280,
  }}>
    <Search size={12} color="#64778c" />
    <input type="text" placeholder={placeholder} value={value}
      onChange={e => onChange(e.target.value)}
      style={{ background: 'transparent', border: 'none', outline: 'none', color: '#e8eef6', fontSize: 12, width: '100%', fontFamily: 'inherit' }} />
    {value && (
      <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', color: '#64778c', cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>×</button>
    )}
  </div>
);

const TypeTabs = ({ active, onChange, counts }) => (
  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
    {TYPE_ORDER.map(t => {
      const theme = TYPE_THEME[t];
      const isActive = active === t;
      return (
        <button key={t} onClick={() => onChange(t)} style={{
          padding: '8px 18px', borderRadius: '10px 10px 0 0', cursor: 'pointer',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
          border: 'none', whiteSpace: 'nowrap', fontFamily: 'inherit',
          background: isActive ? `rgba(${theme.rgb},0.12)` : 'transparent',
          color: isActive ? theme.accent : '#64778c',
          borderBottom: isActive ? `2px solid ${theme.accent}` : '2px solid transparent',
          transition: 'color .2s, background .2s',
        }}>
          {theme.label}{counts ? ` (${counts[t] ?? 0})` : ''}
        </button>
      );
    })}
  </div>
);

const highlight = (val, term) => {
  const s = String(val ?? '');
  const t = (term || '').trim();
  if (!t) return s;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = s.split(new RegExp(`(${esc})`, 'gi'));
  if (parts.length === 1) return s;
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="qt-mark">{part}</mark>
      : part
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL-STYLE COLUMN HEADER FILTER
// ─────────────────────────────────────────────────────────────────────────────
const FilterDropdown = ({ options, selected, onChange, onClose, accentColor, alignRight }) => {
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [onClose]);

  const isChecked = (opt) => !!selected && selected.has(opt);
  const visibleOptions = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const isSearching = search.trim() !== '';

  const commit = (set) => onChange(set.size === 0 ? null : set);

  const toggle = (opt) => {
    const base = new Set(selected ?? []);
    if (base.has(opt)) base.delete(opt); else base.add(opt);
    commit(base);
  };

  const selectAll = () => {
    const base = new Set(selected ?? []);
    visibleOptions.forEach(o => base.add(o));
    commit(base);
  };

  const clearAll = () => {
    if (!isSearching) { onChange(null); return; }
    const base = new Set(selected ?? []);
    visibleOptions.forEach(o => base.delete(o));
    commit(base);
  };

  const checkedCount = selected ? options.filter(o => selected.has(o)).length : 0;

  return (
    <div
      ref={boxRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: '100%',
        left: alignRight ? 'auto' : 0,
        right: alignRight ? 0 : 'auto',
        marginTop: 4, zIndex: 100,
        width: 224, background: '#0b1220', border: `1px solid ${accentColor}55`,
        borderRadius: 10, boxShadow: '0 14px 36px rgba(0,0,0,0.65)',
        padding: 8, textAlign: 'left', textTransform: 'none', letterSpacing: 'normal',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)',
        borderRadius: 6, padding: '4px 8px', marginBottom: 6,
      }}>
        <Search size={11} color="#64778c" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search values..."
          style={{ background: 'transparent', border: 'none', outline: 'none', color: '#e8eef6', fontSize: 11, width: '100%', fontFamily: 'inherit', fontWeight: 400 }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: '#64778c', cursor: 'pointer', fontSize: 13 }}>×</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button onClick={selectAll} disabled={visibleOptions.length === 0} style={{
          flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5,
          border: `1px solid ${accentColor}55`, background: 'transparent', color: accentColor,
          cursor: visibleOptions.length === 0 ? 'not-allowed' : 'pointer',
          opacity: visibleOptions.length === 0 ? 0.5 : 1,
        }}>{isSearching && visibleOptions.length > 0 ? `Select all (${visibleOptions.length})` : 'Select all'}</button>
        <button onClick={clearAll} disabled={visibleOptions.length === 0} style={{
          flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#9fb0c3',
          cursor: visibleOptions.length === 0 ? 'not-allowed' : 'pointer',
          opacity: visibleOptions.length === 0 ? 0.5 : 1,
        }}>Clear</button>
      </div>

      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibleOptions.length === 0 && (
          <div style={{ color: '#64778c', fontSize: 11, padding: '6px 4px' }}>No matches</div>
        )}
        {visibleOptions.map(opt => (
          <label key={opt} style={{
            display: 'flex', alignItems: 'center', gap: 7, padding: '4px 4px', borderRadius: 4,
            fontSize: 11, fontWeight: 400, color: '#e8eef6', cursor: 'pointer',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <input type="checkbox" checked={isChecked(opt)} onChange={() => toggle(opt)} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt || '(blank)'}</span>
          </label>
        ))}
      </div>

      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 10, color: '#64778c' }}>
        {checkedCount === 0 ? `None selected · showing all (${options.length})` : `${checkedCount} / ${options.length} selected`}
      </div>
    </div>
  );
};

const FilterableHeader = ({ label, options, selected, onChange, accentColor, alignRight }) => {
  const [open, setOpen] = useState(false);
  const isActive = selected !== null && selected !== undefined && selected.size > 0;
  return (
    <th
      className="qt-f"
      style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }}
      onClick={() => setOpen(o => !o)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        {label}
        {isActive ? <Filter size={10} /> : <ChevronDown size={10} style={{ opacity: 0.55 }} />}
      </span>
      {open && (
        <FilterDropdown
          options={options}
          selected={selected}
          onChange={onChange}
          onClose={() => setOpen(false)}
          accentColor={accentColor}
          alignRight={alignRight}
        />
      )}
    </th>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FILTER LOGIC (shared)
// ─────────────────────────────────────────────────────────────────────────────
const uniqueValues = (rows, getter) =>
  Array.from(new Set(rows.map(getter).map(v => (v ?? '').trim()))).sort((a, b) => a.localeCompare(b));

const rowMatchesFilters = (row, getters, filters, excludeKey) => {
  for (const key of Object.keys(getters)) {
    if (key === excludeKey) continue;
    const sel = filters[key];
    if (!sel || sel.size === 0) continue;
    const val = (getters[key](row) ?? '').trim();
    if (!sel.has(val)) return false;
  }
  return true;
};

const buildCascadingOptions = (rows, getters, filters, searchFn) => {
  const searched = searchFn ? rows.filter(searchFn) : rows;
  const out = {};
  Object.keys(getters).forEach(key => {
    const reachableRows = searched.filter(row => rowMatchesFilters(row, getters, filters, key));
    out[key] = uniqueValues(reachableRows, getters[key]);
  });
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL SHARED PIECES
// ─────────────────────────────────────────────────────────────────────────────
const Banner = ({ title, meta }) => (
  <div className="qt-banner">
    <span className="qt-line" />
    <span className="qt-banner-title">{title}</span>
    <span className="qt-count">{meta}</span>
    <span className="qt-line r" />
  </div>
);

const LoadingBlock = ({ text }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 50, gap: 12 }}>
    <div className="sp" style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #182436', borderTopColor: '#00e5ff' }} />
    <span style={{ color: '#00e5ff', fontSize: 12, letterSpacing: 1 }}>{text}</span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — "Pool Project" (routing) VIEW
// ─────────────────────────────────────────────────────────────────────────────
const ProjectPoolView = () => {
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState('pricing');
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({ project: null, region: null });
  const exportTableRef = useRef(null);

  const load = useCallback(async () => {
    setSpinning(true);
    setError('');
    try {
      const csv = await fetchCSVFromGid(GID);
      setSections(parseProjectCSV(csv));
    } catch (e) {
      setError(e.message ?? 'Fetch failed');
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFilters({ project: null, region: null }); }, [activeType]);

  const rows = sections[activeType] ?? [];
  const searchLower = searchTerm.toLowerCase().trim();

  const getters = useMemo(() => ({
    project: (r) => r.project,
    region: (r) => r.region,
  }), []);

  const matchesSearch = useCallback((r) => {
    if (!searchLower) return true;
    return r.project.toLowerCase().includes(searchLower) || r.region.toLowerCase().includes(searchLower);
  }, [searchLower]);

  const cascadingOptions = useMemo(
    () => buildCascadingOptions(rows, getters, filters, matchesSearch),
    [rows, getters, filters, matchesSearch]
  );

  if (loading) return <LoadingBlock text="Fetching sheet data…" />;
  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#f87171', fontSize: 13, marginBottom: 10 }}>⚠ {error}</p>
        <p style={{ color: '#4a6178', fontSize: 11, lineHeight: 1.8 }}>
          1. Open the Google Sheet → File → Share → Publish to web<br />
          2. Choose <b style={{ color: '#60a5fa' }}>CSV</b> format → Publish<br />
          3. Press Refresh
        </p>
      </div>
    );
  }

  const filtered = rows.filter(r => matchesSearch(r) && rowMatchesFilters(r, getters, filters));
  const theme = TYPE_THEME[activeType];
  const counts = Object.fromEntries(TYPE_ORDER.map(t => [t, (sections[t] ?? []).length]));

  const exportHeaders = ['Pool Project', 'Region'];
  const exportRows = filtered.map(r => ({ 'Pool Project': r.project, Region: r.region }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', ...themeVars(theme) }}>
      <div style={{
        display: 'flex', gap: 10, padding: '10px 10px 0', alignItems: 'flex-end',
        flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
      }}>
        <TypeTabs active={activeType} onChange={setActiveType} counts={counts} />
        <div style={{ marginLeft: 'auto', marginBottom: 6 }}>
          <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search project or region..." />
        </div>
        <div style={{ marginBottom: 6 }}>
          <ExportToolbar
            tableRef={exportTableRef}
            headers={exportHeaders}
            rows={exportRows}
            filenameBase={`${theme.label} Pool Project List`}
            accentColor={theme.accent}
            bgColor="#0b1220"
            sheetName={`${theme.label} Pool Projects`}
          />
        </div>
        <div style={{ marginBottom: 6 }}>
          <RefreshButton spinning={spinning} onClick={load} />
        </div>
      </div>

      <Banner
        title={`${theme.label} pool projects`}
        meta={`${filtered.length} / ${rows.length}`}
      />

      <div key={activeType} className="qt-wrap">
        <table className="qt-table">
          <thead>
            <tr>
              <th className="qt-idx-h" style={{ width: 52 }}>#</th>
              <FilterableHeader
                label="Pool Project"
                options={cascadingOptions.project ?? []}
                selected={filters.project}
                onChange={sel => setFilters(f => ({ ...f, project: sel }))}
                accentColor={theme.accent}
              />
              <FilterableHeader
                label="Region"
                options={cascadingOptions.region ?? []}
                selected={filters.region}
                onChange={sel => setFilters(f => ({ ...f, region: sel }))}
                accentColor={theme.accent}
                alignRight
              />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri} style={{ '--i': Math.min(ri, 24) }}>
                <td className="qt-idx">{ri + 1}</td>
                <td className="qt-strong">{highlight(row.project, searchTerm)}</td>
                <td>
                  {row.region ? <span className="qt-pill">{highlight(row.region, searchTerm)}</span> : null}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr className="qt-empty">
                <td colSpan={3}>
                  {searchTerm ? `No projects matching "${searchTerm}"` : 'No projects match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ExportTable
        ref={exportTableRef}
        headers={exportHeaders}
        rows={exportRows}
        theme={theme}
        showIndex
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — "Pool QAT List" VIEW
// ─────────────────────────────────────────────────────────────────────────────
const PoolQATView = () => {
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState('pricing');
  const [searchTerm, setSearchTerm] = useState('');
  const [assignedOnly, setAssignedOnly] = useState(true);
  const [filters, setFilters] = useState({});
  const exportTableRef = useRef(null);

  const load = useCallback(async () => {
    setSpinning(true);
    setError('');
    try {
      const csv = await fetchCSVFromGid(GID_POOLS);
      setSections(parsePoolCSV(csv));
    } catch (e) {
      setError(e.message ?? 'Fetch failed');
    } finally {
      setLoading(false);
      setSpinning(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFilters({}); }, [activeType]);

  const active = sections[activeType] ?? { cols: [], rows: [] };
  const teamLeaderCol = active.cols.find(c => c.toLowerCase().includes('team leader'));
  const searchLower = searchTerm.toLowerCase().trim();

  const baseRows = useMemo(() => {
    if (assignedOnly && teamLeaderCol) {
      return active.rows.filter(row => (row[teamLeaderCol] ?? '').trim() !== '');
    }
    return active.rows;
  }, [active.rows, assignedOnly, teamLeaderCol]);

  const getters = useMemo(() => {
    const g = {};
    active.cols.forEach(col => { g[col] = (row) => row[col]; });
    return g;
  }, [active.cols]);

  const matchesSearch = useCallback((row) => {
    if (!searchLower) return true;
    return active.cols.some(c => (row[c] ?? '').toLowerCase().includes(searchLower));
  }, [active.cols, searchLower]);

  const cascadingOptions = useMemo(
    () => buildCascadingOptions(baseRows, getters, filters, matchesSearch),
    [baseRows, getters, filters, matchesSearch]
  );

  const findActual = useCallback(
    (canonical) => active.cols.find(c => c.trim().toLowerCase() === canonical.toLowerCase()),
    [active.cols]
  );

  const visibleCols = useMemo(() => {
    const list = [];
    const used = new Set();
    QAT_VISIBLE_COLUMNS.forEach(o => {
      const actual = findActual(o.canonical);
      if (actual) { list.push({ actual, display: o.display }); used.add(actual); }
    });
    active.cols.forEach(c => {
      if (!used.has(c)) list.push({ actual: c, display: c });
    });
    return list;
  }, [active.cols, findActual]);

  const exportColMap = useMemo(() => {
    return QAT_EXPORT_COLUMNS
      .map(o => ({ ...o, actual: findActual(o.canonical) }))
      .filter(o => o.actual);
  }, [findActual]);

  const exportHeaders = exportColMap.map(o => o.exportLabel);

  if (loading) return <LoadingBlock text="Loading pool data…" />;
  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <p style={{ color: '#f87171', fontSize: 13 }}>⚠ {error}</p>
      </div>
    );
  }

  const filtered = baseRows.filter(row => matchesSearch(row) && rowMatchesFilters(row, getters, filters));

  const theme = TYPE_THEME[activeType];
  const counts = Object.fromEntries(TYPE_ORDER.map(t => [t, (sections[t]?.rows ?? []).length]));

  const exportRows = filtered.map(row => {
    const r = {};
    exportColMap.forEach(o => { r[o.exportLabel] = row[o.actual] ?? ''; });
    return r;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', ...themeVars(theme) }}>
      <div style={{
        display: 'flex', gap: 10, padding: '10px 10px 0', alignItems: 'flex-end',
        flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
      }}>
        <TypeTabs active={activeType} onChange={setActiveType} counts={counts} />
        {teamLeaderCol && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11, color: '#9fb0c3', fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer' }}>
            <input type="checkbox" checked={assignedOnly} onChange={e => setAssignedOnly(e.target.checked)} />
            Assigned only
          </label>
        )}
        <div style={{ marginLeft: 'auto', marginBottom: 6 }}>
          <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search QATs..." />
        </div>
        <div style={{ marginBottom: 6 }}>
          <ExportToolbar
            tableRef={exportTableRef}
            headers={exportHeaders}
            rows={exportRows}
            filenameBase={`${theme.label} Pool QAT List`}
            accentColor={theme.accent}
            bgColor="#0b1220"
            sheetName={`${theme.label} Pool QATs`}
          />
        </div>
        <div style={{ marginBottom: 6 }}>
          <RefreshButton spinning={spinning} onClick={load} />
        </div>
      </div>

      <Banner
        title={`${theme.label} pools`}
        meta={`${filtered.length} / ${active.rows.length} QATs`}
      />

      <div key={activeType} className="qt-wrap">
        <table className="qt-table">
          <thead>
            <tr>
              <th className="qt-idx-h" style={{ width: 52 }}>#</th>
              {visibleCols.map((vc, vi) => (
                <FilterableHeader
                  key={vc.actual}
                  label={vc.display}
                  options={cascadingOptions[vc.actual] ?? []}
                  selected={filters[vc.actual] ?? null}
                  onChange={sel => setFilters(f => ({ ...f, [vc.actual]: sel }))}
                  accentColor={theme.accent}
                  alignRight={vi === visibleCols.length - 1}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri} style={{ '--i': Math.min(ri, 24) }}>
                <td className="qt-idx">{ri + 1}</td>
                {visibleCols.map(vc => {
                  const val = row[vc.actual] ?? '';
                  const key = vc.actual.toLowerCase();
                  const isRegion = key === 'region';
                  const isQat = key === 'qat';
                  return (
                    <td key={vc.actual} className={isQat ? 'qt-strong qt-wrapcell' : 'qt-wrapcell'}>
                      {isRegion
                        ? (val ? <span className="qt-pill">{highlight(val, searchTerm)}</span> : null)
                        : highlight(val, searchTerm)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr className="qt-empty">
                <td colSpan={visibleCols.length + 1}>
                  {searchTerm
                    ? `No QATs found matching "${searchTerm}"`
                    : assignedOnly
                      ? 'No QATs with a team leader assigned.'
                      : 'No QATs match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ExportTable
        ref={exportTableRef}
        headers={exportHeaders}
        rows={exportRows}
        theme={theme}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const QATDashboard = () => {
  const [mainTab, setMainTab] = useState('routing');

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #070d18; margin: 0; padding: 0; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes qtIn  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .sp { animation: spin 0.72s linear infinite; }
        .fl { animation: float 3.2s ease-in-out infinite; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e3a52; border-radius: 4px; }

        .qt-root {
          --t1: #e8eef6;
          --t2: #a3b3c6;
          --t3: #64778c;
          font-family: 'Manrope', Inter, system-ui, sans-serif;
        }

        .qt-banner {
          display: flex; align-items: center; gap: 16px;
          padding: 14px 6px 12px; flex-shrink: 0;
        }
        .qt-line {
          flex: 1; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(var(--rgb), 0.55));
        }
        .qt-line.r { background: linear-gradient(270deg, transparent, rgba(var(--rgb), 0.55)); }
        .qt-banner-title {
          color: var(--accent); font-size: 15px; font-weight: 800; letter-spacing: 0.14em;
          text-shadow: 0 0 22px rgba(var(--rgb), 0.45);
        }
        .qt-count {
          color: var(--t2); font-size: 11px; font-weight: 600;
          padding: 3px 10px; border-radius: 999px;
          border: 1px solid rgba(var(--rgb), 0.28);
          background: rgba(var(--rgb), 0.06);
          font-variant-numeric: tabular-nums;
        }

        .qt-wrap {
          flex: 1; min-height: 0; overflow: auto; position: relative;
          align-self: center;
          width: fit-content;
          max-width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(var(--rgb), 0.26);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.025),
            0 24px 60px -18px rgba(0,0,0,0.7),
            0 0 48px -14px rgba(var(--rgb), 0.38);
        }
        .qt-table {
          width: auto;
          min-width: 340px;
          border-collapse: separate; border-spacing: 0;
          font-size: 13px; color: var(--t1);
        }

        .qt-table thead { position: sticky; top: 0; z-index: 10; }
        .qt-table thead th {
          padding: 14px 16px; text-align: center; white-space: nowrap;
          font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
          color: var(--accent);
          background-color: var(--head);
          background-image: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 70%);
          border-bottom: 1px solid rgba(var(--rgb), 0.55);
          box-shadow: 0 8px 18px -10px rgba(var(--rgb), 0.35);
          transition: color .18s;
        }
        .qt-table thead th.qt-f:hover { color: #fff; }
        .qt-table thead th.qt-idx-h { color: var(--t3); cursor: default; }

        .qt-table tbody td {
          padding: 11px 16px; text-align: center;
          background: transparent;
          color: var(--t1); font-weight: 500;
          border-bottom: 1px solid rgba(255,255,255,0.055);
          transition: background-color .18s;
        }
        .qt-table tbody tr:last-child td { border-bottom: none; }
        .qt-table tbody tr:hover td {
          background: linear-gradient(90deg, rgba(var(--rgb), 0.11), rgba(var(--rgb), 0.03));
        }
        .qt-table tbody tr:hover td:first-child { box-shadow: inset 3px 0 0 var(--accent); }

        .qt-table td.qt-idx {
          width: 52px; color: var(--t3); font-size: 11px; font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .qt-table td.qt-strong { font-weight: 700; letter-spacing: 0.01em; }
        .qt-table td.qt-wrapcell { white-space: normal; word-break: break-word; min-width: 110px; }

        .qt-pill {
          display: inline-block; padding: 3px 13px; border-radius: 999px;
          font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--t1);
          border: 1px solid rgba(var(--rgb), 0.38);
          background: rgba(var(--rgb), 0.07);
        }
        .qt-mark {
          background: rgba(var(--rgb), 0.38); color: #fff;
          padding: 0 3px; border-radius: 3px;
        }
        .qt-table tr.qt-empty td { padding: 44px; color: var(--t3); }
        .qt-table tr.qt-empty:hover td { background: transparent; box-shadow: none; }

        .qt-wrap .qt-table tbody tr {
          animation: qtIn .5s cubic-bezier(.2,.7,.2,1) both;
          animation-delay: calc(var(--i, 0) * 16ms);
        }
        @media (prefers-reduced-motion: reduce) {
          .qt-wrap .qt-table tbody tr { animation: none; }
          .fl { animation: none; }
        }
      `}</style>

      <Particles />

      <div className="qt-root" style={{
        position: 'relative', zIndex: 1, height: '100vh',
        display: 'flex', flexDirection: 'column', padding: '16px',
        color: '#e8eef6', background: 'transparent',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 14, flexShrink: 0 }}>
          <h1 className="fl" style={{
            fontSize: 26, fontWeight: 900, letterSpacing: 5, textTransform: 'uppercase',
            background: 'linear-gradient(90deg,#00e5ff,#00b4d8,#00e676)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', display: 'inline-block',
          }}>
            DO NOT WORK — Pool Project
          </h1>
          <div style={{ width: 60, height: 2, margin: '6px auto', background: 'linear-gradient(90deg,#00e5ff,#00b4d8)', borderRadius: 99 }} />
        </div>

        <div style={{
          display: 'flex', gap: 4, marginBottom: 12,
          borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
        }}>
          {['routing', 'pools'].map(tab => (
            <button key={tab} onClick={() => setMainTab(tab)} style={{
              padding: '8px 22px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.04em', border: 'none', fontFamily: 'inherit',
              borderBottom: mainTab === tab ? '2px solid #00e5ff' : '2px solid transparent',
              background: 'transparent', color: mainTab === tab ? '#00e5ff' : '#64778c',
            }}>
              {tab === 'routing' ? 'Pool Project' : 'Pool QAT List'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {mainTab === 'routing' ? <ProjectPoolView /> : <PoolQATView />}
        </div>
      </div>
    </>
  );
};

export default QATDashboard;