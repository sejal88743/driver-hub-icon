import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Admin permission required to alter):
// SUPABASE_URL: https://zybrzzouzleacqjvfiiu.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV
// SUPABASE_JWKS_URL: https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV';
const LOCKED_SUPABASE_JWKS_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json';

const metaEnv = (typeof import.meta !== 'undefined' && (import.meta as any)?.env) || {};
const procEnv = (typeof process !== 'undefined' && process?.env) || {};

const SUPABASE_URL =
  metaEnv.VITE_SUPABASE_URL ||
  metaEnv.SUPABASE_URL ||
  procEnv.VITE_SUPABASE_URL ||
  procEnv.SUPABASE_URL ||
  LOCKED_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  metaEnv.VITE_SUPABASE_ANON_KEY ||
  metaEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  metaEnv.SUPABASE_PUBLISHABLE_KEY ||
  metaEnv.SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  procEnv.SUPABASE_PUBLISHABLE_KEY ||
  procEnv.SUPABASE_ANON_KEY ||
  LOCKED_SUPABASE_PUBLISHABLE_KEY;

export const FINAL_URL = LOCKED_SUPABASE_URL;
export const FINAL_KEY = LOCKED_SUPABASE_PUBLISHABLE_KEY;

// Proxy detection state
let useProxyFallback = false;
if (typeof window !== 'undefined') {
  try {
    if (sessionStorage.getItem('vt_use_supabase_proxy') === '1') {
      useProxyFallback = true;
    }
  } catch {}
}

// Fast reachability probe on client load
if (typeof window !== 'undefined') {
  // Probe within 2 seconds. If unreachable (e.g. timeout / ISP blocking Supabase direct IP), switch immediately to proxy.
  fetch(`${LOCKED_SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: LOCKED_SUPABASE_PUBLISHABLE_KEY },
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(2000) : undefined,
  })
    .then((r) => {
      if (r.ok || r.status === 200 || r.status === 404 || r.status === 401) {
        useProxyFallback = false;
        try { sessionStorage.removeItem('vt_use_supabase_proxy'); } catch {}
      }
    })
    .catch(() => {
      console.warn('[Supabase] Direct connection to zybrzzouzleacqjvfiiu.supabase.co unreachable; switching to server proxy /api/supabase-proxy');
      useProxyFallback = true;
      try { sessionStorage.setItem('vt_use_supabase_proxy', '1'); } catch {}
    });
}

function combineSignals(s1?: AbortSignal | null, s2?: AbortSignal | null): AbortSignal | undefined {
  if (!s1) return s2 || undefined;
  if (!s2) return s1 || undefined;
  if (typeof (AbortSignal as any).any === 'function') {
    return (AbortSignal as any).any([s1, s2]);
  }
  const ctrl = new AbortController();
  s1.addEventListener('abort', () => ctrl.abort(s1.reason), { once: true });
  s2.addEventListener('abort', () => ctrl.abort(s2.reason), { once: true });
  return ctrl.signal;
}

// Smart custom fetch that automatically routes via local /api/supabase-proxy if direct Supabase connection fails or times out
async function resilientSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : (input as Request).url;

  // If proxy fallback is already enabled, rewrite directly to /api/supabase-proxy
  if (useProxyFallback && urlStr.startsWith(LOCKED_SUPABASE_URL)) {
    const proxiedUrl = urlStr.replace(LOCKED_SUPABASE_URL, '/api/supabase-proxy');
    return fetch(proxiedUrl, init);
  }

  // If URL targets locked Supabase, attempt direct with a 3.5s timeout fallback
  if (urlStr.startsWith(LOCKED_SUPABASE_URL)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('Supabase direct connection timeout')), 3500);
    const signal = combineSignals(init?.signal, ctrl.signal);

    try {
      const resp = await fetch(input, { ...init, signal });
      clearTimeout(timer);
      return resp;
    } catch (err: any) {
      clearTimeout(timer);
      console.warn('[Supabase] Direct request failed or timed out (' + (err?.message || err) + '); routing via /api/supabase-proxy');
      useProxyFallback = true;
      try { sessionStorage.setItem('vt_use_supabase_proxy', '1'); } catch {}
      const proxiedUrl = urlStr.replace(LOCKED_SUPABASE_URL, '/api/supabase-proxy');
      return fetch(proxiedUrl, init);
    }
  }

  return fetch(input, init);
}

export const supabase = createClient(FINAL_URL, FINAL_KEY, {
  global: {
    fetch: resilientSupabaseFetch,
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const SUPABASE_URL_USED = FINAL_URL;
export const SUPABASE_KEY_USED = FINAL_KEY;

export const SUPABASE_CONFIG = {
  url: LOCKED_SUPABASE_URL,
  publishableKey: LOCKED_SUPABASE_PUBLISHABLE_KEY,
  jwksUrl: LOCKED_SUPABASE_JWKS_URL,
};


