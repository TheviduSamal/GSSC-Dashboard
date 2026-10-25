import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Download, Image as ImageIcon, FileSpreadsheet, ClipboardCopy } from "lucide-react";
import * as XLSX from 'xlsx-js-style';
import JSZip from 'jszip';

interface DataRow {
  [key: string]: string;
}

interface TableBlock {
  title: string;
  headers: string[];
  rows: DataRow[];
}

const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

const FIRST_COL_MIN_WIDTH = 90;
const COL_MIN_WIDTH = 34;
const COL_PADDING = 24;

// ─── CSV → raw grid (RFC 4180) ────────────────────────────────────────────
const parseGrid = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const csv = text.replace(/\r\n/g, '\n').replace(/\r/g, '');

  while (i < csv.length) {
    const ch = csv[i];
    const next = csv[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        field += ch === '\n' ? ' ' : ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\n') {
        row.push(field.trim());
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.trim() !== '' || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
};

// ─── Grid → separate tables ───────────────────────────────────────────────
const buildTables = (grid: string[][]): TableBlock[] => {
  const norm = (v: string | undefined) => (v ?? '').trim();

  if (grid.length < 2) return [];

  const searchLimit = Math.min(grid.length, 10);
  let headerIdx = -1;

  headerSearch:
  for (let r = 0; r < searchLimit; r++) {
    const row = grid[r];
    const seen = new Set<string>();
    for (let c = 0; c < row.length; c++) {
      const v = norm(row[c]).toLowerCase();
      if (!v) continue;
      if (seen.has(v)) {
        headerIdx = r;
        break headerSearch;
      }
      seen.add(v);
    }
  }

  if (headerIdx === -1) {
    for (let r = 0; r < searchLimit; r++) {
      const vals = grid[r].map(norm).filter(v => v !== '');
      if (new Set(vals).size >= 3) {
        headerIdx = r;
        break;
      }
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headerRow = grid[headerIdx] ?? [];
  const titleRow = headerIdx > 0 ? grid[headerIdx - 1] : [];
  const dataRows = grid.slice(headerIdx + 1);
  const maxCols = Math.max(
    headerRow.length,
    titleRow.length,
    ...dataRows.map(r => r.length),
    0
  );

  let anchorCol = -1;
  let anchorLabel = '';
  for (let c = 0; c < maxCols; c++) {
    const v = norm(headerRow[c]);
    if (v) {
      anchorCol = c;
      anchorLabel = v.toLowerCase();
      break;
    }
  }

  const cuts: number[] = [];
  if (anchorCol !== -1) {
    for (let c = anchorCol; c < maxCols; c++) {
      if (norm(headerRow[c]).toLowerCase() === anchorLabel) cuts.push(c);
    }
  }
  if (cuts.length === 0) cuts.push(0);

  const ranges = cuts.map((s, i) => ({
    start: s,
    end: i + 1 < cuts.length ? cuts[i + 1] - 1 : maxCols - 1,
  }));

  ranges.forEach(range => {
    while (range.end > range.start) {
      const hasData =
        norm(headerRow[range.end]) !== '' ||
        dataRows.some(r => norm(r[range.end]) !== '');
      if (hasData) break;
      range.end--;
    }
  });

  const blocks: TableBlock[] = [];

  ranges.forEach((range, ri) => {
    const seen: Record<string, number> = {};
    const headers: string[] = [];
    const headerCols: number[] = [];
    for (let c = range.start; c <= range.end; c++) {
      let h = norm(headerRow[c]) || `Column ${c - range.start + 1}`;
      if (seen[h]) {
        seen[h] += 1;
        h = `${h} (${seen[h]})`;
      } else {
        seen[h] = 1;
      }
      headers.push(h);
      headerCols.push(c);
    }
    if (headers.length < 2) return;

    let title = '';
    for (let c = range.start; c <= range.end; c++) {
      const t = norm(titleRow[c]);
      if (t) {
        title = t;
        break;
      }
    }
    if (!title) {
      const leftLimit = ri > 0 ? ranges[ri - 1].end + 1 : 0;
      for (let c = range.start - 1; c >= leftLimit; c--) {
        const t = norm(titleRow[c]);
        if (t) {
          title = t;
          break;
        }
      }
    }
    if (!title) title = headers[0];

    const rows: DataRow[] = [];
    for (const r of dataRows) {
      const values = headerCols.map(c => norm(r[c]));
      if (!values.some(v => v !== '')) continue;
      const isHeaderStrip = values.every(
        (v, idx) => v.toLowerCase() === headers[idx].toLowerCase()
      );
      if (isHeaderStrip) continue;

      const obj: DataRow = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx];
      });
      rows.push(obj);
    }
    if (!rows.length) return;

    blocks.push({ title, headers, rows });
  });

  return blocks;
};

let memoryCache: { timestamp: number; data: TableBlock[] } | null = null;

const getCachedData = (): TableBlock[] | null => {
  if (!memoryCache) return null;
  if (Date.now() - memoryCache.timestamp < CACHE_EXPIRY) return memoryCache.data;
  memoryCache = null;
  return null;
};

const setCachedData = (data: TableBlock[]) => {
  memoryCache = { timestamp: Date.now(), data };
};

const ACCENTS = ['#38f9d7', '#a78bfa', '#60a5fa', '#fbbf24', '#f472b6'];

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

const tableToCanvas = (tableEl: HTMLTableElement, bgColor = '#0a0e17', scale = 2): HTMLCanvasElement => {
  const trs = Array.from(tableEl.querySelectorAll('tr'));
  if (trs.length === 0) throw new Error('Table has no rows');

  const grid = trs.map(tr => Array.from(tr.children) as HTMLElement[]);
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
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, w, h);
      }

      const text = (cell.innerText ?? cell.textContent ?? '').trim();

      const fontStyle = cs.fontStyle || 'normal';
      const fontWeight = cs.fontWeight || '400';
      const fontSizeStr = cs.fontSize || '13px';
      const fontFamily = cs.fontFamily || 'sans-serif';
      ctx.font = `${fontStyle} ${fontWeight} ${fontSizeStr} ${fontFamily}`;
      if ('letterSpacing' in ctx) (ctx as any).letterSpacing = cs.letterSpacing || '0px';
      ctx.fillStyle = cs.color || '#e7ecf5';

      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;

      const isRotated =
        cs.writingMode === 'vertical-rl' || cs.writingMode === 'vertical-lr';

      const fontSizeNum = parseFloat(fontSizeStr) || 13;
      const lineHeight = fontSizeNum * 1.3;

      if (text && isRotated) {
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(-Math.PI / 2);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const availSpan = Math.max(4, h - padT - padB);

        const lines = wrapCanvasText(ctx, text, availSpan);
        const totalLineH = (lines.length - 1) * lineHeight;
        let ty = -totalLineH / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(-h / 2, -w / 2, h, w);
        ctx.clip();
        lines.forEach(line => {
          ctx.fillText(line, 0, ty);
          ty += lineHeight;
        });
        ctx.restore();
        ctx.restore();
      } else if (text) {
        const align: CanvasTextAlign =
          cs.textAlign === 'center' ? 'center' : cs.textAlign === 'right' ? 'right' : 'left';
        ctx.textAlign = align;

        const availW = Math.max(4, w - padL - padR);
        let tx: number;
        if (align === 'center') tx = x + w / 2;
        else if (align === 'right') tx = x + w - padR;
        else tx = x + padL;

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

const tableToPngDataUrl = (tableEl: HTMLTableElement, bgColor: string) =>
  tableToCanvas(tableEl, bgColor).toDataURL('image/png');

const tableToPngBlob = (tableEl: HTMLTableElement, bgColor: string): Promise<Blob> =>
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

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL SHEET BUILDER (professional layout, rotated headers, freeze at Project)
// ─────────────────────────────────────────────────────────────────────────────
const buildSheetFromBlock = (
  block: TableBlock
): { ws: XLSX.WorkSheet; xSplit: number; ySplit: number } => {
  const headers = block.headers;
  const rows = block.rows;
  const NUM_COLS = headers.length;

  // Layout rows
  const R_TITLE  = 0;
  const R_SUB    = 1;
  const R_ACCENT = 2;
  const R_SPACER = 3;
  const R_HEAD   = 4;
  const R_DATA   = 5;
  const R_FOOT   = R_DATA + rows.length;

  const ws: any = {};

  const enc = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
  const put = (r: number, c: number, v: any, s: any, z?: string) => {
    const cell: any = { t: typeof v === 'number' ? 'n' : 's', v, s };
    if (z) cell.z = z;
    ws[enc(r, c)] = cell;
  };

  const thin = { style: 'thin', color: { rgb: 'CBD5E1' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const centerAlign = { horizontal: 'center', vertical: 'center', wrapText: true };
  const leftAlign = { horizontal: 'left', vertical: 'center', wrapText: false };

  // ── Banner palette ──
  const BANNER_BG = '0B1220';
  const SUB_BG = '1E293B';
  const ACCENT = '06B6D4';
  const HEADER_BG = '5B21B6';
  const HEADER_BOTTOM = '06B6D4';
  const ZEBRA = 'F8FAFC';

  // Title
  for (let c = 0; c < NUM_COLS; c++) {
    put(R_TITLE, c, c === 0 ? (block.title || 'SHEET').toUpperCase() : '', {
      font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: BANNER_BG } },
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    });
    put(
      R_SUB,
      c,
      c === 0
        ? `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}   ·   ${rows.length} rows   ·   ${NUM_COLS} columns`
        : '',
      {
        font: { name: 'Calibri', sz: 10, bold: false, color: { rgb: 'CBD5E1' } },
        fill: { patternType: 'solid', fgColor: { rgb: SUB_BG } },
        alignment: leftAlign,
      }
    );
    put(R_ACCENT, c, '', { fill: { patternType: 'solid', fgColor: { rgb: ACCENT } } });
    put(R_SPACER, c, '', { fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } } });
  }

  // Header row — rotated bottom-to-top
  const headerAlign = {
    horizontal: 'center',
    vertical: 'center',
    wrapText: true,
    textRotation: 90,
  };

  headers.forEach((h, c) => {
    put(R_HEAD, c, h.replace(/_/g, ' '), {
      font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: HEADER_BG } },
      alignment: headerAlign,
      border: {
        top: { style: 'thin', color: { rgb: HEADER_BG } },
        left: { style: 'thin', color: { rgb: HEADER_BG } },
        right: { style: 'thin', color: { rgb: HEADER_BG } },
        bottom: { style: 'medium', color: { rgb: HEADER_BOTTOM } },
      },
    });
  });

  // Data rows
  rows.forEach((row, ri) => {
    const r = R_DATA + ri;
    const isZebra = ri % 2 === 1;
    const baseBg = isZebra ? ZEBRA : 'FFFFFF';
    headers.forEach((h, c) => {
      const val = row[h] ?? '';
      const isFirst = c === 0;
      const numVal = parseFloat(val);
      const isNumeric = val !== '' && !isNaN(numVal);
      const scored = /average/i.test(h) && isNumeric;
      const isLow = scored && numVal < 82;
      const isHigh = scored && numVal >= 82;

      let textColor = '0F172A';
      let fill = baseBg;
      let bold = isFirst;
      if (isLow) { textColor = 'B91C1C'; fill = 'FEE2E2'; bold = true; }
      else if (isHigh) { textColor = '15803D'; fill = 'DCFCE7'; bold = true; }

      put(r, c, val, {
        font: { name: 'Calibri', sz: 10, bold, color: { rgb: textColor } },
        fill: { patternType: 'solid', fgColor: { rgb: fill } },
        alignment: isFirst ? leftAlign : centerAlign,
        border,
      });
    });
  });

  // Footer
  for (let c = 0; c < NUM_COLS; c++) {
    put(
      R_FOOT,
      c,
      c === 0 ? `Total: ${rows.length} record${rows.length === 1 ? '' : 's'}` : '',
      {
        font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: '64748B' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
        border,
      }
    );
  }

  // Merges
  ws['!merges'] = [
    { s: { r: R_TITLE,  c: 0 }, e: { r: R_TITLE,  c: NUM_COLS - 1 } },
    { s: { r: R_SUB,    c: 0 }, e: { r: R_SUB,    c: NUM_COLS - 1 } },
    { s: { r: R_ACCENT, c: 0 }, e: { r: R_ACCENT, c: NUM_COLS - 1 } },
    { s: { r: R_SPACER, c: 0 }, e: { r: R_SPACER, c: NUM_COLS - 1 } },
    { s: { r: R_FOOT,   c: 0 }, e: { r: R_FOOT,   c: NUM_COLS - 1 } },
  ];

  // ── Column widths (NARROW) ──
  // Rotated headers don't need extra width, so keep columns tight:
  // min 6 chars, max 14 chars, +1 for padding.
  ws['!cols'] = headers.map(h => {
    let maxLen = 0;
    rows.forEach(row => {
      const v = String(row[h] ?? '');
      if (v.length > maxLen) maxLen = v.length;
    });
    // Use only the body value length (headers are rotated so they don't
    // need horizontal room). Clamp to a tight range.
    return { wch: Math.min(Math.max(6, maxLen + 1), 14) };
  });

  // Row heights
  ws['!rows'] = [];
  ws['!rows'][R_TITLE]  = { hpt: 38 };
  ws['!rows'][R_SUB]    = { hpt: 22 };
  ws['!rows'][R_ACCENT] = { hpt: 5 };
  ws['!rows'][R_SPACER] = { hpt: 10 };
  ws['!rows'][R_HEAD]   = { hpt: 120 }; // tall for rotated header text
  for (let i = 0; i < rows.length; i++) ws['!rows'][R_DATA + i] = { hpt: 22 };
  ws['!rows'][R_FOOT]   = { hpt: 22 };

  // Range, autofilter, views
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: R_FOOT, c: NUM_COLS - 1 },
  });
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: R_HEAD, c: 0 },
      e: { r: R_HEAD + rows.length, c: NUM_COLS - 1 },
    }),
  };
  ws['!views'] = [{ showGridLines: false }];

  // ── Freeze panes: find "Project" column ──
  const normalizeHeader = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const projIdx = headers.findIndex(h => {
    const n = normalizeHeader(h);
    return n === 'project' || n === 'projectname';
  });
  const xSplit = projIdx >= 0 ? projIdx + 1 : Math.min(1, NUM_COLS);
  const ySplit = R_HEAD + 1;

  return { ws, xSplit, ySplit };
};

// Excel sheet names must be ≤31 chars, cannot contain: : \ / ? * [ ]
const sanitizeSheetName = (name: string, fallback: string): string => {
  const cleaned = String(name ?? '')
    .replace(/[:\\/?*\[\]]/g, '')
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
};

const exportTablesToExcel = async (tables: TableBlock[], filename: string) => {
  if (!tables.length) return;
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const sheetMeta: Array<{ index: number; xSplit: number; ySplit: number }> = [];

  tables.forEach((block, idx) => {
    const base = sanitizeSheetName(block.title, `Sheet ${idx + 1}`);
    let sheetName = base;
    let n = 2;
    while (usedNames.has(sheetName)) {
      const suffix = ` (${n})`;
      sheetName = base.slice(0, 31 - suffix.length) + suffix;
      n++;
    }
    usedNames.add(sheetName);

    const { ws, xSplit, ySplit } = buildSheetFromBlock(block);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    sheetMeta.push({ index: wb.SheetNames.length, xSplit, ySplit });
  });

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const zip = await JSZip.loadAsync(out);

  for (const { index, xSplit, ySplit } of sheetMeta) {
    const path = `xl/worksheets/sheet${index}.xml`;
    const file = zip.file(path);
    if (!file) continue;

    const xml = await file.async('string');
    const topLeftCell = XLSX.utils.encode_cell({ r: ySplit, c: xSplit });
    const paneXml =
      `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/>` +
      `<selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>`;
    const newViews = `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${paneXml}</sheetView></sheetViews>`;

    let newXml: string;
    if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
      newXml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, newViews);
    } else if (/<dimension[^>]*\/>/.test(xml)) {
      newXml = xml.replace(/(<dimension[^>]*\/>)/, `$1${newViews}`);
    } else {
      newXml = xml.replace(/(<worksheet[^>]*>)/, `$1${newViews}`);
    }
    zip.file(path, newXml);
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

const escapeHtml = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const copyRowsAsBorderedTable = async (headers: string[], rows: DataRow[]) => {
  const headerStyle =
    'border:1px solid #999999;padding:6px 4px;text-align:center;' +
    'background:#1F4E78;color:#ffffff;font-weight:700;font-family:Arial,sans-serif;font-size:12px;' +
    'writing-mode:vertical-rl;transform:rotate(180deg);' +
    'height:120px;vertical-align:middle;';
  const cellStyle =
    'border:1px solid #999999;padding:6px 12px;text-align:center;' +
    'font-family:Arial,sans-serif;font-size:13px;color:#111111;';

  const theadHtml = `<tr>${headers.map(h => `<th style="${headerStyle}">${escapeHtml(h)}</th>`).join('')}</tr>`;
  const tbodyHtml = rows
    .map(
      r =>
        `<tr>${headers.map(h => `<td style="${cellStyle}">${escapeHtml(r[h] ?? '')}</td>`).join('')}</tr>`
    )
    .join('');

  const html =
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
    `<thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>`;

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

const ExportToolbar: React.FC<{
  tableRef: React.RefObject<HTMLTableElement>;
  headers: string[];
  rows: DataRow[];
  allTables: TableBlock[];
  filenameBase: string;
  accent: string;
}> = ({ tableRef, headers, rows, allTables, filenameBase, accent }) => {
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!status) return;
    const id = setTimeout(() => setStatus(''), 1800);
    return () => clearTimeout(id);
  }, [status]);

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 6,
    cursor: 'pointer',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${accent}40`,
    color: accent,
    transition: 'background 0.15s',
    flexShrink: 0,
  };

  const handleDownloadImage = () => {
    if (!tableRef.current) return;
    try {
      const dataUrl = tableToPngDataUrl(tableRef.current, '#0a0e17');
      downloadDataUrl(dataUrl, `${filenameBase}.png`);
      setStatus('Image downloaded ✓');
    } catch (e) {
      console.error('Download image failed:', e);
      setStatus('Download failed');
    }
  };

  const handleCopyImage = async () => {
    if (!tableRef.current) return;
    try {
      const blob = await tableToPngBlob(tableRef.current, '#0a0e17');
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        setStatus('Clipboard images unsupported — use download');
        return;
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      setStatus('Image copied ✓');
    } catch (e) {
      console.error('Copy image failed:', e);
      setStatus('Copy image failed');
    }
  };

  const handleExportExcel = async () => {
    try {
      setStatus('Building Excel…');
      await exportTablesToExcel(allTables, `${filenameBase}.xlsx`);
      setStatus(`Excel exported (${allTables.length} sheets) ✓`);
    } catch (e) {
      console.error('Excel export failed:', e);
      setStatus('Excel export failed');
    }
  };

  const handleCopyText = async () => {
    try {
      await copyRowsAsBorderedTable(headers, rows);
      setStatus('Copied as table ✓');
    } catch (e) {
      console.error('Copy text failed:', e);
      setStatus('Copy failed');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={handleDownloadImage} title="Download table as image" style={btnStyle}>
        <Download size={14} />
      </button>
      <button onClick={handleCopyImage} title="Copy table as image" style={btnStyle}>
        <ImageIcon size={14} />
      </button>
      <button onClick={handleExportExcel} title="Export all tables to Excel (one sheet per table)" style={btnStyle}>
        <FileSpreadsheet size={14} />
      </button>
      <button onClick={handleCopyText} title="Copy as table with borders" style={btnStyle}>
        <ClipboardCopy size={14} />
      </button>
      {status && (
        <span style={{ fontSize: '0.7rem', color: accent, whiteSpace: 'nowrap' }}>
          {status}
        </span>
      )}
    </div>
  );
};

const DataTable: React.FC<{
  table: TableBlock;
  accent: string;
  allTables: TableBlock[];
  exportBaseName: string;
}> = ({ table, accent, allTables, exportBaseName }) => {
  const [search, setSearch] = useState('');
  const tableRef = useRef<HTMLTableElement>(null);

  const { headers, rows } = table;

  const filtered = rows.filter(row =>
    Object.values(row).some(v => v.toLowerCase().includes(search.toLowerCase()))
  );

  const estimatedWidth =
    (FIRST_COL_MIN_WIDTH + COL_PADDING) +
    Math.max(headers.length - 1, 0) * (COL_MIN_WIDTH + COL_PADDING);

  const titleCase = (s: string) =>
    s
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  const filenameBase =
    titleCase(exportBaseName) ||
    titleCase(table.title) ||
    'Denominator Sheet';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 'fit-content', maxWidth: '100%', minWidth: Math.min(estimatedWidth, 220) }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: 280, flex: '1 1 200px' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, opacity: 0.35 }}>🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${table.title}`}
            style={{
              width: '100%',
              padding: '6px 10px 6px 28px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: 'white',
              fontSize: '0.8rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <ExportToolbar
            tableRef={tableRef}
            headers={headers}
            rows={filtered}
            allTables={allTables}
            filenameBase={filenameBase}
            accent={accent}
          />
        </div>
      </div>

      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, width: 'fit-content', maxWidth: '100%' }} className="ttt-scrollbar">
        <table ref={tableRef} style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content' }}>
          <thead>
            <tr>
              {headers.map((h, hi) => {
                const isFirst = hi === 0;
                return (
                  <th
                    key={h}
                    title={h}
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: isFirst ? 0 : undefined,
                      zIndex: isFirst ? 30 : 20,
                      background: '#0d1320',
                      padding: '10px 5px',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      lineHeight: 1.1,
                      letterSpacing: '0.02em',
                      color: '#e7ecf5',
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap',
                      height: 132,
                      minWidth: 34,
                      borderBottom: `2px solid ${accent}`,
                      borderRight: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    {h.replace(/_/g, ' ')}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => {
              const zebra = ri % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
              return (
                <tr
                  key={ri}
                  style={{ background: zebra, transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(56,249,215,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = zebra)}
                >
                  {headers.map((h, ci) => {
                    const val = row[h] ?? '';
                    const isFirst = ci === 0;
                    const numVal = parseFloat(val);
                    const isNumeric = val !== '' && !isNaN(numVal);
                    const scored = /average/i.test(h) && isNumeric;
                    const isLow = scored && numVal < 82;
                    const isHigh = scored && numVal >= 82;

                    return (
                      <td
                        key={h}
                        style={{
                          padding: '7px 12px',
                          textAlign: isFirst ? 'left' : 'center',
                          whiteSpace: 'nowrap',
                          fontSize: '0.8rem',
                          fontWeight: isFirst ? 600 : 400,
                          fontVariantNumeric: 'tabular-nums',
                          position: isFirst ? 'sticky' : undefined,
                          left: isFirst ? 0 : undefined,
                          zIndex: isFirst ? 10 : undefined,
                          color: isLow ? '#ff8a8a' : isHigh ? '#6eec8e' : isFirst ? '#ffffff' : '#dbe3ef',
                          background: isFirst
                            ? '#0d1320'
                            : isLow
                            ? 'rgba(255,107,107,0.08)'
                            : isHigh
                            ? 'rgba(74,222,128,0.06)'
                            : 'transparent',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          borderRight: '1px solid rgba(255,255,255,0.03)',
                        }}
                      >
                        {val || <span style={{ opacity: 0.25 }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={headers.length} style={{ textAlign: 'center', padding: 32, color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}>
                  Nothing matches "{search}". Try a shorter term.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{
        padding: '6px 12px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.35)',
        flexShrink: 0,
      }}>
        <span>{filtered.length} of {rows.length} rows · {headers.length} columns</span>
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', color: accent, cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}
          >
            Clear search
          </button>
        )}
      </div>
    </div>
  );
};

const DenominatorSheet: React.FC = () => {
  const [tables, setTables] = useState<TableBlock[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const SHEET_URL = () =>
    `https://docs.google.com/spreadsheets/d/e/2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd/pub?gid=822634964&output=csv&_=${Date.now()}`;

  const fetchWithXHR = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status === 200) resolve(xhr.responseText);
          else reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });

  const processCsvData = (csvText: string) => {
    const blocks = buildTables(parseGrid(csvText));
    setTables(blocks);
    setActive(prev => (prev < blocks.length ? prev : 0));
    setFetchError(null);
    setCachedData(blocks);
  };

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);

    try {
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) {
          setTables(cached);
          setLoading(false);
          return;
        }
      }
      const csv = await fetchWithXHR(SHEET_URL());
      processCsvData(csv);
    } catch (err) {
      console.error(err);
      setFetchError('Could not reach the sheet. Check the connection and refresh.');
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) {
          setTables(cached);
          setFetchError('Showing the last saved copy — the sheet could not be reached.');
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    memoryCache = null;
    fetchData(true);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const existing = document.getElementById('particles-js-script');
    const initParticles = () => {
      // @ts-ignore
      if (window.particlesJS) {
        // @ts-ignore
        window.particlesJS('particles-js', {
          particles: {
            number: { value: 60, density: { enable: true, value_area: 800 } },
            color: { value: '#22e6e6' },
            shape: { type: 'circle' },
            opacity: { value: 0.4, random: true },
            size: { value: 2.5, random: true },
            line_linked: { enable: true, distance: 150, color: '#22e6e6', opacity: 0.3, width: 1 },
            move: { enable: true, speed: 1.5 },
          },
          interactivity: {
            events: {
              onhover: { enable: true, mode: 'repulse' },
              onclick: { enable: true, mode: 'push' },
            },
            modes: { repulse: { distance: 80 }, push: { particles_nb: 3 } },
          },
          retina_detect: true,
        });
      }
    };

    if (existing) {
      initParticles();
      return;
    }

    const script = document.createElement('script');
    script.id = 'particles-js-script';
    script.src = 'https://cdn.jsdelivr.net/npm/particles.js@2.0.0/particles.min.js';
    script.async = true;
    script.onload = initParticles;
    document.body.appendChild(script);
  }, []);

  const current = tables[active];
  const accent = ACCENTS[active % ACCENTS.length];

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100%', overflow: 'hidden', fontFamily: 'sans-serif', color: 'white', background: 'transparent', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <style>{`
        * { box-sizing: border-box; }
        .ttt-scrollbar::-webkit-scrollbar { width: 7px; height: 7px; }
        .ttt-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        .ttt-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(to bottom, #38f9d7, #667eea);
          border-radius: 3px;
        }
        .ttt-scrollbar::-webkit-scrollbar-thumb:hover { background: #38f9d7; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes titleGlow {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(56,249,215,0.25)); }
          50% { filter: drop-shadow(0 0 18px rgba(167,139,250,0.45)); }
        }
        @keyframes titleShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        input::placeholder { color: rgba(255,255,255,0.25) !important; }
        input:focus { border-color: rgba(56,249,215,0.4) !important; box-shadow: 0 0 0 2px rgba(56,249,215,0.08); }
        button:focus-visible { outline: 2px solid #38f9d7; outline-offset: 2px; }
      `}</style>

      <div id="particles-js" style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 10, padding: '16px 20px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <header style={{ flexShrink: 0, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(56,249,215,0.4))', maxWidth: 100 }} />

            <h1 style={{
              margin: 0,
              fontSize: 'clamp(1rem, 3vw, 1.6rem)',
              fontWeight: 800,
              letterSpacing: '0.1em',
              backgroundImage: 'linear-gradient(135deg, #38f9d7 0%, #60a5fa 35%, #a78bfa 65%, #38f9d7 100%)',
              backgroundSize: '200% 200%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textTransform: 'uppercase',
              animation: 'titleGlow 3s ease-in-out infinite, titleShift 6s ease-in-out infinite',
              whiteSpace: 'nowrap',
            }}>
              Denominator Sheet
            </h1>

            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(167,139,250,0.4))', maxWidth: 100 }} />

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh data"
              style={{
                padding: '6px 8px',
                background: 'rgba(56,249,215,0.08)',
                border: '1px solid rgba(56,249,215,0.25)',
                borderRadius: 8,
                cursor: refreshing ? 'not-allowed' : 'pointer',
                opacity: refreshing ? 0.5 : 1,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <RefreshCw
                size={16}
                color="#38f9d7"
                style={{ display: 'block', animation: refreshing ? 'spin 0.9s linear infinite' : 'none' }}
              />
            </button>
          </div>

          {tables.length > 0 && (
            <div
              role="tablist"
              style={{
                display: 'flex',
                gap: 4,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                overflowX: 'auto',
              }}
              className="ttt-scrollbar"
            >
              {tables.map((t, i) => {
                const isActive = i === active;
                const c = ACCENTS[i % ACCENTS.length];
                return (
                  <button
                    key={t.title + i}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActive(i)}
                    style={{
                      padding: '9px 16px',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: isActive ? 700 : 500,
                      whiteSpace: 'nowrap',
                      color: isActive ? c : 'rgba(255,255,255,0.55)',
                      background: isActive ? `${c}14` : 'transparent',
                      border: 'none',
                      borderBottom: `2px solid ${isActive ? c : 'transparent'}`,
                      borderRadius: '8px 8px 0 0',
                      marginBottom: -1,
                    }}
                  >
                    {t.title}
                    <span style={{ marginLeft: 8, opacity: 0.6, fontWeight: 500 }}>{t.rows.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {fetchError && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              padding: '5px 12px',
              borderRadius: 6,
              fontSize: '0.75rem',
              marginTop: 10,
            }}>
              ⚠️ {fetchError}
            </div>
          )}
        </header>

        <div
          style={{
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(10,14,23,0.55)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            overflow: 'hidden',
            width: current ? 'fit-content' : '100%',
            maxWidth: '100%',
            alignSelf: 'center',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading && !tables.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 }}>
              <div style={{
                width: 36, height: 36,
                border: '2px solid rgba(56,249,215,0.15)',
                borderTop: '2px solid #38f9d7',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>Loading the sheet…</span>
            </div>
          ) : !current ? (
            <div style={{ textAlign: 'center', padding: '60px 30px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
              <p style={{ color: 'rgba(255,255,255,0.45)', marginBottom: 16, fontSize: '0.85rem' }}>
                {fetchError ?? 'No tables found in the published sheet.'}
              </p>
              <button
                onClick={handleRefresh}
                style={{
                  background: 'rgba(56,249,215,0.12)',
                  color: '#38f9d7',
                  border: '1px solid rgba(56,249,215,0.3)',
                  padding: '7px 20px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Load again
              </button>
            </div>
          ) : (
            <DataTable
              key={active}
              table={current}
              accent={accent}
              allTables={tables}
              exportBaseName="Denominator Sheet"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default DenominatorSheet;