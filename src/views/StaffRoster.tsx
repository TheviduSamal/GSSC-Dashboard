import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, X, Check, Download, Image as ImageIcon, FileSpreadsheet, ClipboardCopy } from "lucide-react";
import * as XLSX from 'xlsx-js-style';
import JSZip from 'jszip';

interface DataRow {
  [key: string]: string;
}

let memoryCache: { timestamp: number; data: DataRow[] } | null = null;
const CACHE_EXPIRY = 24 * 60 * 60 * 1000;
const getCachedData = (): DataRow[] | null => {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.timestamp < CACHE_EXPIRY) return memoryCache.data;
  memoryCache = null; return null;
};
const setCachedData = (data: DataRow[]) => { memoryCache = { timestamp: Date.now(), data }; };

const parseCSV = (text: string): DataRow[] => {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false, i = 0;
  const csv = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < csv.length) {
    const ch = csv[i], next = csv[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; }
      else if (ch === '"') { inQuotes = false; i++; }
      else { field += ch === '\n' ? ' ' : ch; i++; }
    } else {
      if (ch === '"') { inQuotes = true; i++; }
      else if (ch === ',') { row.push(field.trim()); field = ''; i++; }
      else if (ch === '\n') {
        row.push(field.trim()); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = []; i++;
      } else { field += ch; i++; }
    }
  }
  if (field.trim() || row.length > 0) { row.push(field.trim()); if (row.some(v => v !== '')) rows.push(row); }
  if (rows.length < 2) return [];
  let headerRow = rows[0], dataStart = 1;
  const maxCols = Math.max(...rows.map(r => r.length));
  if (headerRow.length < maxCols) {
    const overflow = rows[1], merged: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const p1 = (headerRow[c] ?? '').trim(), p2 = (overflow[c] ?? '').trim();
      const isData = /^\d/.test(p2) || (p2 !== '' && rows.slice(2,5).some(r => r[c] === p2));
      merged.push(p2 && !isData ? (p1 ? `${p1} ${p2}` : p2) : p1);
    }
    headerRow = merged; dataStart = 2;
  }
  const headers = headerRow.map(h => h.trim()).filter((h, i, arr) => h !== '' || arr.slice(0,i).every(p => p !== ''));
  return rows.slice(dataStart).filter(r => r.some(v => v !== '')).map(r => {
    const obj: DataRow = {};
    headers.forEach((h, idx) => { if (h) obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
};

type ColumnFilters = Map<string, Set<string>>;

// ═══════════════════════════════════════════════════════════════════════════
// EXCEL HELPERS (styled workbook + freeze)
// ═══════════════════════════════════════════════════════════════════════════
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

const xlFont = (color: string, bold = false, sz = 11) => ({ name: 'Calibri', sz, bold, color: { rgb: color } });
const xlFill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
const xlBorder = (rgb: string): any => {
  const b = { style: 'thin', color: { rgb } };
  return { top: b, bottom: b, left: b, right: b };
};
const XL_CENTER = { horizontal: 'center', vertical: 'center', wrapText: true };

const xlHeaderStyle = (bg: string, color: string = XL.white, sz = 11) => ({
  font: xlFont(color, true, sz),
  fill: xlFill(bg),
  alignment: XL_CENTER,
  border: xlBorder(XL.white),
});

const xlBodyStyle = (fill: string, color: string = XL.text, bold = false) => ({
  font: xlFont(color, bold, 11),
  fill: xlFill(fill),
  alignment: XL_CENTER,
  border: xlBorder(XL.border),
});

interface XlSheet {
  ws: Record<string, any>;
  merges: any[];
  heights: Record<number, number>;
  maxRow: number;
}

const createXlSheet = (): XlSheet => ({ ws: {}, merges: [], heights: {}, maxRow: 0 });

const xlPut = (sh: XlSheet, r: number, c: number, v: string | number, s: any, z?: string) => {
  const cell: any = { t: typeof v === 'number' ? 'n' : 's', v, s };
  if (z) cell.z = z;
  sh.ws[XLSX.utils.encode_cell({ r, c })] = cell;
  if (r > sh.maxRow) sh.maxRow = r;
};

const xlBanner = (sh: XlSheet, numCols: number, title: string, subtitle: string) => {
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

const xlFinalize = (sh: XlSheet, widths: number[], freezeCols = 0) => {
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
  const rows: any[] = [];
  Object.entries(sh.heights).forEach(([r, h]) => { rows[Number(r)] = { hpt: h }; });
  sh.ws['!rows'] = rows;
  if (sh.merges.length > 0) sh.ws['!merges'] = sh.merges;
  sh.ws['!views'] = [{ showGridLines: false }];
  sh.ws['!xFreeze'] = freezeCols;
  return sh.ws;
};

const exportWorkbookWithFreeze = async (wb: any, filename: string) => {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const zip = await JSZip.loadAsync(out);

  // Banner (rows 0-3) + header row (row 4) = 5 rows frozen at the top
  const ySplit = XL_HEADER_ROW + 1;

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const path = `xl/worksheets/sheet${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;

    const n: number = (wb.Sheets[wb.SheetNames[i]] as any)['!xFreeze'] || 0;
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

// Find the "PRIMARY" column index (case-insensitive); freeze everything up to & including it.
const computeFreezeCols = (headers: string[]): number => {
  const idx = headers.findIndex(h => h.trim().toLowerCase() === 'primary');
  return idx >= 0 ? idx + 1 : 0;
};

const buildStyledSheet = (
  headers: string[],
  rows: DataRow[],
  title: string,
  subtitle: string,
  freezeCols: number
) => {
  const sh = createXlSheet();
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

      const isAverage = h.toLowerCase().includes('average');
      const n = num ?? NaN;
      const isLow = isAverage && !isNaN(n) && n < 82;
      const isHigh = isAverage && !isNaN(n) && n >= 82;
      const color = isLow ? 'DC2626' : isHigh ? '15803D' : XL.text;

      const style = xlBodyStyle(fill, color, isLow || isHigh);
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
    return Math.min(Math.max(14, max + 4), 40);
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

const exportRowsToExcel = async (headers: string[], rows: DataRow[], filename: string) => {
  const freezeCols = computeFreezeCols(headers);
  const subtitle = [
    `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
    `${rows.length} rows`,
    `${headers.length} columns`,
  ].join('   |   ');
  const ws = buildStyledSheet(headers, rows, 'STAFF ROSTER', subtitle, freezeCols);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Staff Roster');
  await exportWorkbookWithFreeze(wb, filename);
};

// ═══════════════════════════════════════════════════════════════════════════
// IMAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const wrapCanvasText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const raw = String(text ?? '');
  if (!raw) return [''];
  const lines: string[] = [];
  raw.split('\n').forEach(para => {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); return; }
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= maxWidth) line = test;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
};

const tableToCanvas = (tableEl: HTMLElement, bgColor: string = '#0b1220', scale: number = 2): HTMLCanvasElement => {
  if (!tableEl) throw new Error('No table element supplied');
  const trs = Array.from(tableEl.querySelectorAll('tr'));
  if (trs.length === 0) throw new Error('Table has no rows');

  const grid: Element[][] = trs.map(tr => Array.from(tr.children));
  const colCount = grid.reduce((m, cells) => Math.max(m, cells.length), 0);
  if (colCount === 0) throw new Error('Table has no columns');

  const colWidths = new Array(colCount).fill(0);
  grid.forEach(cells => {
    cells.forEach((cell, i) => {
      const w = (cell as HTMLElement).getBoundingClientRect().width;
      if (w > colWidths[i]) colWidths[i] = w;
    });
  });
  const rowHeights = grid.map(cells =>
    cells.reduce((m, c) => Math.max(m, (c as HTMLElement).getBoundingClientRect().height), 0)
  );

  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(totalW * scale));
  canvas.height = Math.max(1, Math.ceil(totalH * scale));

  const ctx = canvas.getContext('2d')!;
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
      } else {
        ctx.fillStyle = bgColor;
      }
      ctx.fillRect(x, y, w, h);

      const text = ((cell as HTMLElement).innerText ?? cell.textContent ?? '').trim();
      ctx.font = `${cs.fontStyle || 'normal'} ${cs.fontWeight || '400'} ${cs.fontSize || '13px'} ${cs.fontFamily || 'system-ui, sans-serif'}`;
      if ('letterSpacing' in ctx) (ctx as any).letterSpacing = cs.letterSpacing || '0px';
      ctx.fillStyle = cs.color || '#e2e8f0';

      const align = cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
      ctx.textAlign = align;

      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const availW = Math.max(4, w - padL - padR);

      let tx: number;
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
        lines.forEach(line => { ctx.fillText(line, tx, ty); ty += lineHeight; });
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

const tableToPngDataUrl = (el: HTMLElement, bg: string) => tableToCanvas(el, bg).toDataURL('image/png');

const tableToPngBlob = (el: HTMLElement, bg: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    try {
      const canvas = tableToCanvas(el, bg);
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
    } catch (e) { reject(e); }
  });

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const escapeHtml = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const copyRowsAsBorderedText = async (headers: string[], rows: DataRow[]) => {
  const headerStyle = 'border:1px solid #999999;padding:6px 12px;text-align:center;background:#16314A;color:#38f9d7;font-weight:700;font-family:Arial,sans-serif;font-size:13px;';
  const cellStyle = 'border:1px solid #999999;padding:6px 12px;text-align:center;font-family:Arial,sans-serif;font-size:13px;color:#111111;';

  const theadHtml = `<tr>${headers.map(h => `<th style="${headerStyle}">${escapeHtml(h)}</th>`).join('')}</tr>`;
  const tbodyHtml = rows.map(r =>
    `<tr>${headers.map(h => `<td style="${cellStyle}">${escapeHtml(r[h] ?? '')}</td>`).join('')}</tr>`
  ).join('');
  const html = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>`;
  const text = [headers.join('\t'), ...rows.map(r => headers.map(h => r[h] ?? '').join('\t'))].join('\n');

  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (ClipboardItemCtor && navigator.clipboard?.write) {
    const item = new ClipboardItemCtor({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
  } else {
    await navigator.clipboard.writeText(text);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT TOOLBAR
// ═══════════════════════════════════════════════════════════════════════════
const exportBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
  background: 'rgba(56,249,215,0.07)',
  border: '1px solid rgba(56,249,215,0.22)',
  color: '#38f9d7', transition: 'all 0.15s ease',
};

const ExportToolbar: React.FC<{
  tableRef: React.RefObject<HTMLDivElement>;
  headers: string[];
  rows: DataRow[];
  filenameBase: string;
}> = ({ tableRef, headers, rows, filenameBase }) => {
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(''), 1800);
    return () => clearTimeout(id);
  }, [status]);

  const handleDownloadImage = () => {
    if (!tableRef.current) return;
    try {
      const dataUrl = tableToPngDataUrl(tableRef.current, '#0b1220');
      downloadDataUrl(dataUrl, `${filenameBase}.png`);
      setStatus('Image downloaded ✓');
    } catch (e) {
      console.error('Download image failed:', e);
      setStatus('Image download failed');
    }
  };

  const handleCopyImage = async () => {
    if (!tableRef.current) return;
    try {
      const blob = await tableToPngBlob(tableRef.current, '#0b1220');
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        setStatus('Clipboard images unsupported');
        return;
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setStatus('Image copied ✓');
    } catch (e) {
      console.error('Copy image failed:', e);
      setStatus('Copy image failed — try download');
    }
  };

  const handleExportExcel = async () => {
    try {
      await exportRowsToExcel(headers, rows, `${filenameBase}.xlsx`);
      setStatus('Excel exported ✓');
    } catch (e) {
      console.error('Excel export failed:', e);
      setStatus('Excel export failed');
    }
  };

  const handleCopyText = async () => {
    try {
      await copyRowsAsBorderedText(headers, rows);
      setStatus('Copied with borders ✓');
    } catch (e) {
      console.error('Copy text failed:', e);
      setStatus('Copy failed');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button
        onClick={handleDownloadImage}
        title="Download table as image"
        style={exportBtnStyle}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.15)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.07)'}
      >
        <Download size={14} />
      </button>
      <button
        onClick={handleCopyImage}
        title="Copy table as image"
        style={exportBtnStyle}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.15)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.07)'}
      >
        <ImageIcon size={14} />
      </button>
      <button
        onClick={handleExportExcel}
        title="Export to Excel"
        style={exportBtnStyle}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.15)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.07)'}
      >
        <FileSpreadsheet size={14} />
      </button>
      <button
        onClick={handleCopyText}
        title="Copy as text with borders"
        style={exportBtnStyle}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.15)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.07)'}
      >
        <ClipboardCopy size={14} />
      </button>
      {status && (
        <span style={{ fontSize: '0.68rem', color: '#38f9d7', whiteSpace: 'nowrap', marginLeft: 4 }}>
          {status}
        </span>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// COLUMN FILTER DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════
const FilterDropdown: React.FC<{
  column: string;
  uniqueValues: string[];
  selectedValues: Set<string>;
  anchorEl: HTMLElement | null;
  onApply: (selected: Set<string>) => void;
  onClose: () => void;
}> = ({ column, uniqueValues, selectedValues, anchorEl, onApply, onClose }) => {
  const [tempSelected, setTempSelected] = useState<Set<string>>(new Set(selectedValues));
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const dropdownWidth = 280;
    let left = rect.left + window.scrollX;
    if (left + dropdownWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - dropdownWidth - 8);
    }
    setPos({ top: rect.bottom + window.scrollY + 4, left });
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          anchorEl && !anchorEl.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorEl]);

  useEffect(() => {
    setTempSelected(new Set(selectedValues));
  }, [selectedValues]);

  const filteredValues = useMemo(() =>
    !search ? uniqueValues : uniqueValues.filter(v => v.toLowerCase().includes(search.toLowerCase())),
    [uniqueValues, search]
  );

  const toggle = (v: string) => {
    const s = new Set(tempSelected);
    s.has(v) ? s.delete(v) : s.add(v);
    setTempSelected(s);
  };

  const selectAllVisible = () => {
    const s = new Set(tempSelected);
    filteredValues.forEach(v => s.add(v));
    setTempSelected(s);
  };

  const clearVisible = () => {
    const s = new Set(tempSelected);
    filteredValues.forEach(v => s.delete(v));
    setTempSelected(s);
  };

  return createPortal(
    <div ref={ref} style={{
      position: 'absolute',
      top: pos.top,
      left: pos.left,
      background: 'rgba(8, 10, 22, 0.96)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(56,249,215,0.22)',
      borderRadius: 12,
      minWidth: 260,
      maxWidth: 320,
      zIndex: 99999,
      boxShadow: '0 0 0 1px rgba(56,249,215,0.06), 0 24px 48px rgba(0,0,0,0.7)',
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: '#38f9d7' }}>
          Filter: {column}
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 2, display: 'flex' }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search values..."
          autoFocus
          style={{ width: '100%', padding: '6px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: 'white', fontSize: '0.75rem', outline: 'none', boxSizing: 'border-box' as const }}
        />
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
        {filteredValues.map(val => (
          <div key={val} onClick={() => toggle(val)} style={{
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
            cursor: 'pointer', fontSize: '0.78rem',
            color: tempSelected.has(val) ? '#38f9d7' : 'rgba(255,255,255,0.65)',
            background: tempSelected.has(val) ? 'rgba(56,249,215,0.08)' : 'transparent',
          }}>
            <div style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0, border: `1px solid ${tempSelected.has(val) ? '#38f9d7' : 'rgba(255,255,255,0.25)'}`, background: tempSelected.has(val) ? '#38f9d7' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {tempSelected.has(val) && <Check size={9} strokeWidth={3} color="#0a0c15" />}
            </div>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val || '(blank)'}</span>
          </div>
        ))}
        {filteredValues.length === 0 && (
          <div style={{ padding: '12px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '0.73rem' }}>No values found</div>
        )}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 6 }}>
        <button onClick={selectAllVisible}
          disabled={filteredValues.length === 0}
          style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)', cursor: filteredValues.length === 0 ? 'not-allowed' : 'pointer', opacity: filteredValues.length === 0 ? 0.5 : 1 }}>
          {search.trim() ? `All (${filteredValues.length})` : 'All'}
        </button>
        <button onClick={clearVisible}
          disabled={filteredValues.length === 0}
          style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)', cursor: filteredValues.length === 0 ? 'not-allowed' : 'pointer', opacity: filteredValues.length === 0 ? 0.5 : 1 }}>
          Clear
        </button>
        <button onClick={() => { onApply(tempSelected); onClose(); }}
          style={{ marginLeft: 'auto', background: 'linear-gradient(135deg,#38f9d7,#60a5fa)', border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: '0.68rem', fontWeight: 700, color: '#05080f', cursor: 'pointer' }}>
          Apply
        </button>
      </div>
    </div>,
    document.body
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// DATA TABLE
// ═══════════════════════════════════════════════════════════════════════════
const DataTable: React.FC<{ data: DataRow[] }> = ({ data }) => {
  const [globalSearch, setGlobalSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(new Map());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [anchorEls, setAnchorEls] = useState<Map<string, HTMLElement>>(new Map());

  const tableRef = useRef<HTMLDivElement>(null);
  const exportTableRef = useRef<HTMLDivElement>(null);

  const headers = useMemo(() => (data.length ? Object.keys(data[0]) : []), [data]);

  const searchFilteredData = useMemo(() => {
    if (!globalSearch) return data;
    const q = globalSearch.toLowerCase();
    return data.filter(row => Object.values(row).some(v => v.toLowerCase().includes(q)));
  }, [data, globalSearch]);

  const finalFilteredData = useMemo(() => {
    let filtered = searchFilteredData;
    for (const [col, sel] of columnFilters.entries()) {
      if (sel.size === 0) continue;
      filtered = filtered.filter(row => sel.has(row[col] || ''));
    }
    return filtered;
  }, [searchFilteredData, columnFilters]);

  const columnUniqueValues = useMemo(() => {
    const map = new Map<string, string[]>();
    headers.forEach(targetCol => {
      let base = searchFilteredData;
      for (const [col, sel] of columnFilters.entries()) {
        if (col === targetCol || sel.size === 0) continue;
        base = base.filter(row => sel.has(row[col] || ''));
      }
      const vals = [...new Set(base.map(row => row[targetCol] || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
      map.set(targetCol, vals);
    });
    return map;
  }, [headers, searchFilteredData, columnFilters]);

  const handleColumnFilter = (col: string, sel: Set<string>) => {
    const f = new Map(columnFilters);
    sel.size === 0 ? f.delete(col) : f.set(col, sel);
    setColumnFilters(f);
  };

  const clearAll = () => { setColumnFilters(new Map()); setGlobalSearch(''); };

  const activeFilterCount = (globalSearch ? 1 : 0) + [...columnFilters.values()].filter(s => s.size > 0).length;

  const setHeaderRef = useCallback((h: string, el: HTMLElement | null) => {
    if (!el) return;
    setAnchorEls(prev => {
      if (prev.get(h) === el) return prev;
      const m = new Map(prev);
      m.set(h, el);
      return m;
    });
  }, []);

  const handleHeaderClick = useCallback((h: string) => {
    setOpenDropdown(prev => (prev === h ? null : h));
  }, []);

  const exportRows = useMemo(
    () => finalFilteredData.map(row => {
      const r: DataRow = {};
      headers.forEach(h => { r[h] = row[h] ?? ''; });
      return r;
    }),
    [finalFilteredData, headers]
  );

  const filenameBase = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Staff Roster ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }, []);

  if (!data.length) return (
    <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem' }}>
      No data available. Please refresh.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 300 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
          <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search all columns..."
            style={{ width: '100%', padding: '7px 12px 7px 30px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8, color: 'white', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' as const }}
          />
        </div>
        {Array.from(columnFilters.entries()).map(([col, sel]) => sel.size > 0 && (
          <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 20, padding: '3px 10px', fontSize: '0.68rem', color: '#60a5fa' }}>
            {col}: {sel.size}
            <button onClick={() => handleColumnFilter(col, new Set())} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#60a5fa', display: 'flex', padding: '0 0 0 2px' }}><X size={10} /></button>
          </div>
        ))}
        {activeFilterCount > 0 && (
          <button onClick={clearAll} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '5px 10px', fontSize: '0.68rem', color: '#f87171', cursor: 'pointer' }}>
            <X size={11} /> Clear {activeFilterCount}
          </button>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <ExportToolbar
            tableRef={exportTableRef}
            headers={headers}
            rows={exportRows}
            filenameBase={filenameBase}
          />
        </div>
      </div>

      <div ref={tableRef} style={{ overflow: 'auto', flex: 1, minHeight: 0, width: '100%' }}>
        <table style={{
          borderCollapse: 'collapse',
          width: '100%',
          minWidth: '100%',
          background: 'transparent',
          tableLayout: 'auto',
        }}>
          <thead>
            <tr>
              {headers.map((h) => {
                const isActive = (columnFilters.get(h)?.size ?? 0) > 0;
                const vals = columnUniqueValues.get(h) || [];
                return (
                  <th key={h} style={{
                    position: 'sticky', top: 0, zIndex: 20,
                    background: 'linear-gradient(135deg, #0f1b2e 0%, #16314a 50%, #1c4a5e 100%)',
                    borderBottom: '2px solid transparent',
                    borderImage: 'linear-gradient(90deg, #38f9d7, #60a5fa, #a78bfa) 1',
                    boxShadow: '0 6px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
                    padding: 0,
                    whiteSpace: 'nowrap',
                  }}>
                    <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg, rgba(255,255,255,0.08), transparent)', pointerEvents: 'none' }} />
                      {vals.length > 0 ? (
                        <button
                          ref={el => setHeaderRef(h, el)}
                          onClick={() => handleHeaderClick(h)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.13em',
                            textTransform: 'uppercase', cursor: 'pointer',
                            fontFamily: 'inherit',
                            color: isActive ? '#0a0c15' : 'rgba(255,255,255,0.92)',
                            background: isActive ? 'linear-gradient(135deg,#38f9d7,#60a5fa)' : 'rgba(255,255,255,0.045)',
                            border: `1px solid ${isActive ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
                            borderRadius: 8,
                            padding: '6px 14px',
                            position: 'relative', zIndex: 1,
                            transition: 'all 0.18s ease',
                            userSelect: 'none',
                            boxShadow: isActive ? '0 2px 12px rgba(56,249,215,0.35)' : 'none',
                          }}
                          onMouseEnter={e => {
                            if (!isActive) {
                              (e.currentTarget as HTMLElement).style.color = '#38f9d7';
                              (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.10)';
                              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(56,249,215,0.35)';
                            }
                          }}
                          onMouseLeave={e => {
                            if (!isActive) {
                              (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.92)';
                              (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.045)';
                              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
                            }
                          }}
                        >
                          {h}
                          <span style={{ fontSize: '0.6rem', opacity: 0.75, transform: openDropdown === h ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.92)', padding: '6px 14px', position: 'relative', zIndex: 1 }}>{h}</span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ background: 'transparent' }}>
            {finalFilteredData.map((row, ri) => (
              <tr key={ri}
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'transparent' }}
              >
                {headers.map((h, ci) => {
                  const val = row[h] ?? '';
                  const isAvg = h.toLowerCase().includes('average');
                  const num = parseFloat(val);
                  const isLow = isAvg && !isNaN(num) && num < 82;
                  const isHigh = isAvg && !isNaN(num) && num >= 82;
                  const isFirst = ci === 0;
                  return (
                    <td key={h} style={{
                      padding: '8px 16px', textAlign: 'center', whiteSpace: 'nowrap',
                      fontSize: '0.83rem', fontWeight: isFirst ? 600 : 400,
                      color: isLow ? '#ff6b6b' : isHigh ? '#4ade80' : isFirst ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.56)',
                      background: 'transparent',
                      borderLeft: isFirst ? '2px solid rgba(56,249,215,0.18)' : 'none',
                    }}>
                      {(isLow || isHigh) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: isLow ? '#ff6b6b' : '#4ade80', display: 'inline-block', flexShrink: 0 }} />
                          {val}
                        </span>
                      ) : (val || '—')}
                    </td>
                  );
                })}
              </tr>
            ))}
            {finalFilteredData.length === 0 && (
              <tr><td colSpan={headers.length} style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.2)', fontSize: '0.85rem', background: 'transparent' }}>No results match your filters</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '7px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,0.22)', background: 'transparent', flexShrink: 0 }}>
        <span>{finalFilteredData.length} of {data.length} records</span>
        {activeFilterCount > 0 && <button onClick={clearAll} style={{ background: 'none', border: 'none', color: 'rgba(56,249,215,0.6)', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>Clear all ×</button>}
      </div>

      {openDropdown && (
        <FilterDropdown
          column={openDropdown}
          uniqueValues={columnUniqueValues.get(openDropdown) || []}
          selectedValues={columnFilters.get(openDropdown) || new Set()}
          anchorEl={anchorEls.get(openDropdown) || null}
          onApply={sel => handleColumnFilter(openDropdown, sel)}
          onClose={() => setOpenDropdown(null)}
        />
      )}

      <div
        ref={exportTableRef}
        aria-hidden="true"
        style={{ position: 'absolute', left: -99999, top: 0, pointerEvents: 'none' }}
      >
        <table style={{
          borderCollapse: 'collapse',
          fontSize: 13,
          fontFamily: 'Inter, system-ui, sans-serif',
          background: '#0b1220',
        }}>
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} style={{
                  padding: '10px 14px',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  background: '#16314A',
                  color: '#38f9d7',
                  border: '1px solid #2d3d52',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {exportRows.map((row, ri) => (
              <tr key={ri}>
                {headers.map(h => {
                  const val = row[h] ?? '';
                  const isAvg = h.toLowerCase().includes('average');
                  const num = parseFloat(val);
                  const isLow = isAvg && !isNaN(num) && num < 82;
                  const isHigh = isAvg && !isNaN(num) && num >= 82;
                  const cellColor = isLow ? '#ff6b6b' : isHigh ? '#4ade80' : '#e2e8f0';
                  return (
                    <td key={h} style={{
                      padding: '7px 14px',
                      textAlign: 'center',
                      background: '#0b1220',
                      color: cellColor,
                      fontWeight: 400,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      border: '1px solid #2d3d52',
                    }}>{val || '—'}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// STARFIELD
// ═══════════════════════════════════════════════════════════════════════════
const Starfield: React.FC = () => {
  const stars = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 1.6 + 0.4, opacity: Math.random() * 0.45 + 0.08,
    dur: Math.random() * 4 + 2, delay: Math.random() * 6,
  })), []);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
      {stars.map(s => (
        <div key={s.id} style={{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, borderRadius: '50%', background: '#38f9d7', opacity: s.opacity, animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite` }} />
      ))}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════
const StaffRoster: React.FC = () => {
  const [data, setData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const SHEET_URL = () => `https://docs.google.com/spreadsheets/d/e/2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd/pub?gid=1860286382&output=csv&_=${Date.now()}`;

  const fetchWithXHR = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onreadystatechange = () => { if (xhr.readyState === 4) { xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error(`HTTP ${xhr.status}`)); } };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });

  const fetchData = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setFetchError(null);
    try {
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) { setData(cached); setLoading(false); return; }
      }
      const csv = await fetchWithXHR(SHEET_URL());
      const rows = parseCSV(csv);
      setData(rows); setCachedData(rows); setFetchError(null);
    } catch (err) {
      console.error(err);
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) { setData(cached); setFetchError('Showing cached data — could not fetch fresh data.'); }
        else setFetchError('Failed to fetch data. Check your internet connection.');
      } else { setFetchError('Refresh failed. Check your internet connection.'); }
    } finally { setLoading(false); setRefreshing(false); }
  };

  const handleRefresh = () => { memoryCache = null; fetchData(true); };
  useEffect(() => { fetchData(); }, []);

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100%', maxWidth: '100vw', overflow: 'hidden', fontFamily: 'system-ui,-apple-system,sans-serif', color: 'white', background: 'transparent', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <style>{`
        @keyframes twinkle { 0%,100%{opacity:0.15} 50%{opacity:0.55} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:200% center} 100%{background-position:-200% center} }
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:rgba(255,255,255,0.02)}
        ::-webkit-scrollbar-thumb{background:rgba(56,249,215,0.28);border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:rgba(56,249,215,0.5)}
        input::placeholder{color:rgba(255,255,255,0.2)!important}
        input:focus{border-color:rgba(56,249,215,0.4)!important;box-shadow:0 0 0 3px rgba(56,249,215,0.07)!important}
      `}</style>

      <Starfield />

      <div style={{ position: 'relative', zIndex: 10, padding: '20px 20px 0 20px', flexShrink: 0 }}>
        <header style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8, justifyContent: 'center' }}>
            <div style={{ flex: 1, height: 1, maxWidth: 100, background: 'linear-gradient(to right,transparent,rgba(56,249,215,0.35))' }} />
            <h1 style={{
              margin: 0, fontSize: 'clamp(1.1rem,3vw,1.75rem)', fontWeight: 800,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              background: 'linear-gradient(120deg,#38f9d7 0%,#60a5fa 45%,#a78bfa 100%)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              animation: 'shimmer 6s linear infinite',
            }}>Staff Roster</h1>
            <div style={{ flex: 1, height: 1, maxWidth: 100, background: 'linear-gradient(to left,transparent,rgba(167,139,250,0.35))' }} />
            <button onClick={handleRefresh} disabled={refreshing} title="Refresh"
              style={{ padding: '8px 9px', background: 'rgba(56,249,215,0.07)', border: '1px solid rgba(56,249,215,0.2)', borderRadius: 10, cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.5 : 1, display: 'flex', alignItems: 'center', transition: 'all 0.2s', flexShrink: 0 }}
              onMouseEnter={e => { if (!refreshing) (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.14)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(56,249,215,0.07)'; }}
            >
              <RefreshCw size={17} color="#38f9d7" style={{ animation: refreshing ? 'spin 0.85s linear infinite' : 'none' }} />
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginBottom: fetchError ? 12 : 0 }}>
            {['#38f9d7','#60a5fa','#a78bfa','#f472b6','#fb923c'].map((c,i) => (
              <div key={i} style={{ width: 20, height: 2.5, background: c, borderRadius: 999, opacity: 0.55 }} />
            ))}
          </div>
          {fetchError && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', padding: '6px 14px', borderRadius: 8, fontSize: '0.78rem', marginTop: 10 }}>
              ⚠️ {fetchError}
            </div>
          )}
        </header>
      </div>

      <div style={{
        position: 'relative', zIndex: 10,
        flex: 1, minHeight: 0,
        margin: '0 20px 20px 20px',
        borderRadius: 18,
        border: '1px solid rgba(56,249,215,0.15)',
        background: 'transparent',
        overflow: 'hidden',
        animation: 'fadeUp 0.4s ease',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {loading && !data.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 14, background: 'transparent' }}>
            <div style={{ width: 40, height: 40, border: '2px solid rgba(56,249,215,0.1)', borderTop: '2px solid #38f9d7', borderRadius: '50%', animation: 'spin 0.75s linear infinite' }} />
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.8rem', letterSpacing: '0.1em' }}>Loading data...</span>
          </div>
        ) : data.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, textAlign: 'center', padding: '40px', background: 'transparent' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
            <p style={{ color: 'rgba(255,255,255,0.35)', marginBottom: 20, fontSize: '0.88rem' }}>{fetchError ?? 'No data available.'}</p>
            <button onClick={handleRefresh} style={{ background: 'rgba(56,249,215,0.1)', color: '#38f9d7', border: '1px solid rgba(56,249,215,0.25)', padding: '9px 24px', borderRadius: 10, cursor: 'pointer', fontSize: '0.88rem' }}>Try Again</button>
          </div>
        ) : (
          <DataTable data={data} />
        )}
      </div>
    </div>
  );
};

export default StaffRoster;