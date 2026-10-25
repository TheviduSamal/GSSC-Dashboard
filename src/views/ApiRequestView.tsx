import { useState } from 'react';
import { useDashboard } from '@/hooks/useDashboardData';
import { getAuth } from '@/lib/api';
import { API_ENDPOINT_OPTIONS } from '@/lib/constants';
import { Copy, Download, Send } from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';

export function ApiRequestView() {
  const { setStatus } = useDashboard();
  const [endpoint, setEndpoint] = useState(API_ENDPOINT_OPTIONS[0].value);
  const [method, setMethod] = useState('GET');
  const [query, setQuery] = useState('');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState('Choose an endpoint and click “Send request”.');
  const [meta, setMeta] = useState('No request sent yet.');
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    let url = endpoint;
    if (query.trim()) url += (url.includes('?') ? '&' : '?') + query.trim().replace(/^\?/, '');
    const opts: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (method === 'POST') {
      (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      try { opts.body = body.trim() || '{}'; JSON.parse(opts.body); } catch (e) {
        setOk(false); setMeta('Invalid JSON body'); setResponse((e as Error).message); setBusy(false); return;
      }
    }
    try {
      const headers = { ...(opts.headers as Record<string, string>) };
      if (getAuth()) headers.Authorization = 'Basic ' + getAuth();
      const start = performance.now();
      const res = await fetch(url, { ...opts, headers });
      const text = await res.text();
      const elapsed = Math.round(performance.now() - start);
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      setResponse(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
      setMeta(`${method} ${url} · HTTP ${res.status} ${res.statusText} · ${elapsed} ms · ${new Date().toLocaleString()}`);
      setOk(res.ok);
    } catch (e) {
      setResponse(JSON.stringify({ error: (e as Error).message }, null, 2));
      setMeta('Network error or route not found.');
      setOk(false);
    } finally {
      setBusy(false);
      setStatus('Request sent', ok ? 'ok' : 'err');
    }
  };

  const copy = () => { navigator.clipboard?.writeText(response).then(() => setStatus('Response copied', 'ok')); };
  const download = () => {
    const blob = new Blob([response], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'qat-api-response.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[#070b14]/80 px-4 py-3 backdrop-blur-xl lg:px-6">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-100">API Request</h1>
          <p className="text-xs text-[var(--muted)]">Inspect raw server responses from any API route.</p>
        </div>
        <div className="ml-auto">
          {ok !== null ? <StatusPill text={ok ? 'HTTP ok' : 'HTTP error'} kind={ok ? 'ok' : 'err'} /> : <StatusPill text="Ready" kind="info" />}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-4 py-4 lg:px-6">
        <div className="card mb-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className="input flex-1 text-xs" value={endpoint} onChange={(e) => { setEndpoint(e.target.value); setMethod('GET'); }}>
              {API_ENDPOINT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="input !w-24 text-xs" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>GET</option><option>POST</option><option>DELETE</option>
            </select>
            <input className="input flex-1 text-xs" placeholder="Query string e.g. id=abc" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-primary text-xs" onClick={send} disabled={busy}><Send size={14} /> Send</button>
          </div>
          {method === 'POST' && (
            <textarea
              className="input mt-3 w-full font-mono text-xs"
              rows={3}
              placeholder='{"project_name":"Project A","task_name":"Task A","target":100}'
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Response</span>
            <div className="flex gap-2">
              <button className="btn !py-1 text-xs" onClick={copy}><Copy size={14} /> Copy</button>
              <button className="btn !py-1 text-xs" onClick={download}><Download size={14} /> Download</button>
            </div>
          </div>
          <div className="mb-2 text-xs text-[var(--muted)]">{meta}</div>
          <pre className="max-h-[420px] overflow-auto rounded-lg border border-[var(--line)] bg-[#080e1b] p-4 font-mono text-xs leading-relaxed text-sky-200">{response}</pre>
        </div>
      </div>
    </div>
  );
}
