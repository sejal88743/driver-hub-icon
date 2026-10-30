import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Updated with user/admin permission):
// SUPABASE_URL: https://qmnofkoxoijihgwgrefv.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_nxq5s4XWrgD6QdNOr4sPSQ_0rPdFlvK
// SUPABASE_JWKS_URL: https://qmnofkoxoijihgwgrefv.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://qmnofkoxoijihgwgrefv.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_nxq5s4XWrgD6QdNOr4sPSQ_0rPdFlvK';
const LOCKED_SUPABASE_JWKS_URL = 'https://qmnofkoxoijihgwgrefv.supabase.co/auth/v1/.well-known/jwks.json';

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

// Direct Supabase communication is primary and authoritative across all clients.
// Clear any stale proxy state from previous sessions.
if (typeof window !== 'undefined') {
  try {
    sessionStorage.removeItem('vt_use_supabase_proxy');
    localStorage.removeItem('vt_use_supabase_proxy');
  } catch {}
}

// Smart custom fetch that ensures direct Supabase connection remains rock-solid
// and strictly protects against receiving HTML ('<!doctype html>') as API JSON.
async function resilientSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr = typeof input === 'string' ? input : (input as Request).url;

  // Guarantee required Supabase headers
  const headers = new Headers(init?.headers);
  if (!headers.has('apikey')) {
    headers.set('apikey', LOCKED_SUPABASE_PUBLISHABLE_KEY);
  }
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${LOCKED_SUPABASE_PUBLISHABLE_KEY}`);
  }

  const reqInit: RequestInit = {
    ...init,
    headers,
  };

  // 1. Direct fetch to locked Supabase instance
  try {
    const resp = await fetch(input, reqInit);
    // If Supabase responded, return response directly
    return resp;
  } catch (directErr: any) {
    // Only attempt local proxy fallback if direct connection suffered a network/DNS error
    // AND the URL targets the locked Supabase endpoint
    if (urlStr.startsWith(LOCKED_SUPABASE_URL)) {
      try {
        const proxiedUrl = urlStr.replace(LOCKED_SUPABASE_URL, '/api/supabase-proxy');
        const proxyResp = await fetch(proxiedUrl, reqInit);
        
        // Guard against HTML SPA fallback: a valid Supabase REST response is NEVER text/html!
        const cType = proxyResp.headers.get('content-type') || '';
        if (cType.includes('text/html')) {
          console.warn('[Supabase] Local proxy returned HTML instead of JSON; discarding proxy response');
          throw directErr;
        }
        return proxyResp;
      } catch {
        // If proxy fails or returns HTML, bubble up the original direct error
        throw directErr;
      }
    }
    throw directErr;
  }
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


