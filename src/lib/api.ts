// ── API helper + auth (ported from src/index.html) ──────────────────

export function getAuth(): string {
  return sessionStorage.getItem('qat_auth') || '';
}

export function setAuth(user: string, pass: string): void {
  sessionStorage.setItem('qat_auth', btoa(user + ':' + pass));
}

export function clearAuth(): void {
  sessionStorage.removeItem('qat_auth');
}

export async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers as Record<string, string> | undefined) };
  if (getAuth()) headers.Authorization = 'Basic ' + getAuth();
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { ...opts, headers });
  let d: any;
  try {
    d = await r.json();
  } catch {
    d = { error: 'Invalid response (HTTP ' + r.status + ')' };
  }
  if (!r.ok) throw Error(d.error || 'HTTP ' + r.status);
  return d;
}
