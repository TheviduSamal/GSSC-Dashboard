import { useEffect, useState } from 'react';

/** A status pill driven by the dashboard context. */
export function StatusPill({ text, kind }: { text: string; kind: 'ok' | 'err' | 'info' }) {
  const colors: Record<string, string> = {
    ok: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
    err: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
    info: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  };
  const dot: Record<string, string> = {
    ok: 'bg-teal-400',
    err: 'bg-rose-400',
    info: 'bg-slate-400',
  };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${colors[kind]}`}>
      <span className={`h-2 w-2 rounded-full ${dot[kind]} ${kind === 'info' ? '' : 'pulse-dot'}`} />
      {text}
    </span>
  );
}

/** Hook that debounces a fast-changing value. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
