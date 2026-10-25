import React, { useState, useEffect, useRef } from 'react';

interface DataRow {
  [key: string]: string;
}

// ─── RFC 4180 CSV parser + auto-merges split header rows ─────────────────────
const parseCSV = (text: string): DataRow[] => {
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
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  if (field.trim() || row.length > 0) {
    row.push(field.trim());
    if (row.some(v => v !== '')) rows.push(row);
  }

  if (rows.length < 2) return [];

  let headerRow = rows[0];
  let dataStart = 1;

  const maxCols = Math.max(...rows.map(r => r.length));

  if (headerRow.length < maxCols) {
    const overflow = rows[1];
    const merged: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const part1 = (headerRow[c] ?? '').trim();
      const part2 = (overflow[c] ?? '').trim();
      const overflowIsData =
        /^\d/.test(part2) ||
        (part2 !== '' && rows.slice(2, 5).some(r => r[c] === part2));
      if (part2 && !overflowIsData) {
        merged.push(part1 ? `${part1} ${part2}` : part2);
      } else {
        merged.push(part1);
      }
    }
    headerRow = merged;
    dataStart = 2;
  }

  const headers = headerRow
    .map(h => h.trim())
    .filter((h, idx, arr) => h !== '' || arr.slice(0, idx).every(prev => prev !== ''));

  return rows
    .slice(dataStart)
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const obj: DataRow = {};
      headers.forEach((h, idx) => {
        if (h) obj[h] = (r[idx] ?? '').trim();
      });
      return obj;
    });
};

// ─── In-memory cache (replaces localStorage — works in Claude.ai artifacts) ──
let memCache: { timestamp: number; data: DataRow[] } | null = null;
const CACHE_EXPIRY = 24 * 60 * 60 * 1000;

const getCachedData = (): DataRow[] | null => {
  if (!memCache) return null;
  if (Date.now() - memCache.timestamp < CACHE_EXPIRY) return memCache.data;
  memCache = null;
  return null;
};

const setCachedData = (data: DataRow[]) => {
  memCache = { timestamp: Date.now(), data };
};

// ─── DataTable ────────────────────────────────────────────────────────────────
const DataTable: React.FC<{ data: DataRow[] }> = ({ data }) => {
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!data.length) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(255,255,255,0.4)', fontSize: '1rem' }}>
        No data available. Please refresh.
      </div>
    );
  }

  const headers = Object.keys(data[0]);

  const filtered = data.filter(row =>
    Object.values(row).some(v => v.toLowerCase().includes(search.toLowerCase()))
  );

  const headerColors = [
    '#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8C94',
    '#C7F464', '#FFB347', '#6C5CE7', '#00CEC9', '#FD79A8',
    '#FDCB6E', '#00B894', '#E84393', '#0984E3', '#D63031', '#F39C12',
  ];

  const isUrl = (value: string): boolean => {
    if (!value) return false;
    const lower = value.toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://');
  };

  const copyLink = async (link: string, rowIdx: number, colIdx: number) => {
    const key = `${rowIdx}-${colIdx}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const openLink = (link: string) => {
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
  };

  const iconBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    color: '#e2e8f0',
    width: '22px',
    height: '22px',
  };

  return (
    <div>
      {/* Search bar */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ position: 'relative', maxWidth: 280 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, opacity: 0.35 }}>
            🔍
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
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
      </div>

      {/* Scrollable table */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '75vh' }}
           className="ttt-scrollbar">
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%' }}>
          <thead>
            <tr>
              {headers.map((h, hi) => {
                const color = headerColors[hi % headerColors.length];
                return (
                  <th
                    key={h}
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 20,
                      background: `linear-gradient(160deg, rgba(12,15,26,0.98) 0%, rgba(20,24,44,0.98) 100%)`,
                      backdropFilter: 'blur(18px)',
                      WebkitBackdropFilter: 'blur(18px)',
                      padding: '14px 16px',
                      whiteSpace: 'nowrap',
                      borderBottom: `1px solid ${color}55`,
                      borderTop: `2.5px solid ${color}`,
                      borderLeft: `1px solid ${color}22`,
                      borderRight: `1px solid ${color}22`,
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: color,
                      textAlign: 'center',
                      boxShadow: `0 6px 24px rgba(0,0,0,0.5), inset 0 1px 0 ${color}25, 0 0 14px ${color}18`,
                      textShadow: `0 0 10px ${color}bb`,
                    }}
                  >
                    {h}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr
                key={ri}
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  background: ri % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(56,249,215,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ri % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'; }}
              >
                {headers.map((h, ci) => {
                  const val = row[h] ?? '';
                  const isAvg = h.toLowerCase().includes('average');
                  const numVal = parseFloat(val);
                  const isLow = isAvg && !isNaN(numVal) && numVal < 82;
                  const isHigh = isAvg && !isNaN(numVal) && numVal >= 82;
                  const isFirst = ci === 0;
                  const color = headerColors[ci % headerColors.length];
                  const isLink = isUrl(val);

                  return (
                    <td
                      key={h}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        fontSize: '0.8rem',
                        fontWeight: isFirst ? 600 : 400,
                        color: isLink
                          ? '#7dd3fc'
                          : isLow
                          ? '#ff8a8a'
                          : isHigh
                          ? '#6eec8e'
                          : isFirst
                          ? '#ffffff'
                          : '#e2e8f0',
                        background: isLow
                          ? 'rgba(255,107,107,0.08)'
                          : isHigh
                          ? 'rgba(74,222,128,0.06)'
                          : 'transparent',
                        borderLeft: isFirst ? `2px solid ${color}` : 'none',
                      }}
                    >
                      {isLink ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <span
                            title={val}
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '180px',
                              fontSize: '0.75rem',
                            }}
                          >
                            {val}
                          </span>
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                              onClick={e => { e.stopPropagation(); copyLink(val, ri, ci); }}
                              style={iconBtnStyle}
                              title="Copy link"
                              aria-label="Copy link"
                            >
                              {copiedKey === `${ri}-${ci}` ? '✓' : '⎘'}
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); openLink(val); }}
                              style={iconBtnStyle}
                              title="Open link"
                              aria-label="Open link"
                            >
                              ↗
                            </button>
                          </div>
                        </div>
                      ) : isLow ? (
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff8a8a', display: 'inline-block', flexShrink: 0 }} />
                          {val}
                        </span>
                      ) : isHigh ? (
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6eec8e', display: 'inline-block', flexShrink: 0 }} />
                          {val}
                        </span>
                      ) : (
                        val || '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={headers.length}
                  style={{ textAlign: 'center', padding: '32px', color: 'rgba(255,255,255,0.35)', fontSize: '0.85rem' }}
                >
                  No results for "{search}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        padding: '6px 12px',
        borderTop: '1px solid rgba(255,255,255,0.03)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.35)',
      }}>
        <span>{filtered.length} of {data.length} records</span>
        {search && (
          <button
            onClick={() => setSearch('')}
            style={{ background: 'none', border: 'none', color: '#4ECDC4', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}
          >
            Clear ×
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Animated particles canvas (replaces particles.js CDN) ───────────────────
const ParticlesCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    interface Particle {
      x: number; y: number;
      vx: number; vy: number;
      r: number; opacity: number;
    }

    const COUNT = 60;
    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 1.5,
      vy: (Math.random() - 0.5) * 1.5,
      r: Math.random() * 2 + 1,
      opacity: Math.random() * 0.4 + 0.1,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Lines
      for (let a = 0; a < COUNT; a++) {
        for (let b = a + 1; b < COUNT; b++) {
          const dx = particles[a].x - particles[b].x;
          const dy = particles[a].y - particles[b].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(34,230,230,${0.25 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            ctx.stroke();
          }
        }
      }

      // Dots
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,230,230,${p.opacity})`;
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      });

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
    />
  );
};

// ─── Refresh icon (replaces lucide-react dependency) ─────────────────────────
const RefreshIcon: React.FC<{ spinning: boolean }> = ({ spinning }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#38f9d7"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: 'block', animation: spinning ? 'spin 0.9s linear infinite' : 'none' }}
  >
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const REDoubtGroup: React.FC = () => {
  const [data, setData] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const SHEET_URL = () =>
    `https://docs.google.com/spreadsheets/d/e/2PACX-1vTcJSktGEdHycbjqLx-YD7-V1DUCH462h64XxaiuyKv9iK6n2FXgh6VAYvFEkS83DI76b2HJfppeuzd/pub?gid=1518065893&output=csv&_=${Date.now()}`;

  const fetchWithXHR = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          xhr.status === 200
            ? resolve(xhr.responseText)
            : reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });

  const processCsvData = (csvText: string) => {
    const rows = parseCSV(csvText);
    setData(rows);
    setFetchError(null);
    setCachedData(rows);
  };

  const fetchData = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setFetchError(null);

    try {
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) {
          setData(cached);
          setLoading(false);
          return;
        }
      }
      const csv = await fetchWithXHR(SHEET_URL());
      processCsvData(csv);
    } catch (err) {
      console.error(err);
      setFetchError('Failed to fetch data. Check your internet connection.');
      if (!isRefresh) {
        const cached = getCachedData();
        if (cached?.length) {
          setData(cached);
          setFetchError('Showing cached data — could not fetch fresh data.');
        }
      } else {
        setData([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    memCache = null;
    fetchData(true);
  };

  useEffect(() => {
    fetchData();
    // fetchData reference is stable (defined outside component) — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', fontFamily: 'sans-serif', color: 'white', background: 'transparent' }}>
      <style>{`
        .ttt-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .ttt-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        .ttt-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #38f9d7, #667eea); border-radius: 3px; }
        .ttt-scrollbar::-webkit-scrollbar-thumb:hover { background: #38f9d7; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes titleGlow {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        input::placeholder { color: rgba(255,255,255,0.25) !important; }
        input:focus { border-color: rgba(56,249,215,0.4) !important; }
      `}</style>

      <ParticlesCanvas />

      <div style={{ position: 'relative', zIndex: 10, padding: '20px' }}>
        {/* Header */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(56,249,215,0.4))', maxWidth: 100 }} />

            <h1 style={{
              margin: 0,
              fontSize: 'clamp(1rem, 3vw, 1.6rem)',
              fontWeight: 800,
              letterSpacing: '0.1em',
              background: 'linear-gradient(135deg, #38f9d7 0%, #60a5fa 35%, #a78bfa 65%, #38f9d7 100%)',
              backgroundSize: '200% 200%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textTransform: 'uppercase',
              animation: 'titleGlow 3s ease-in-out infinite',
            }}>
              Plano Doubt Group
            </h1>

            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(167,139,250,0.4))', maxWidth: 100 }} />

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh data"
              aria-label="Refresh data"
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
              <RefreshIcon spinning={refreshing} />
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginBottom: fetchError ? 10 : 0 }}>
            {['#FF6B6B', '#4ECDC4', '#FFE66D', '#A8E6CF', '#FF8C94'].map((c, i) => (
              <div key={i} style={{ width: 20, height: 2, background: c, borderRadius: 9999, opacity: 0.7 }} />
            ))}
          </div>

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
              marginTop: 8,
            }}>
              ⚠️ {fetchError}
            </div>
          )}
        </header>

        {/* Table card */}
        <div style={{
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.01)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          margin: '0 auto',
          maxWidth: '100%',
          animation: 'fadeIn 0.3s ease',
        }}>
          {loading && !data.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 30px', gap: 12 }}>
              <div style={{
                width: 36, height: 36,
                border: '2px solid rgba(56,249,215,0.15)',
                borderTop: '2px solid #38f9d7',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem', letterSpacing: '0.1em' }}>Loading data...</span>
            </div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 30px' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
              <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 16, fontSize: '0.85rem' }}>{fetchError ?? 'No data available.'}</p>
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
                Try Again
              </button>
            </div>
          ) : (
            <DataTable data={data} />
          )}
        </div>
      </div>
    </div>
  );
};

export default REDoubtGroup;