import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Updated with user/admin permission):
// SUPABASE_URL: https://dyeerksnenfyvgevqskp.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_CmOpnx0qPWRyhczXGRb2gQ_xVbZwFaz
// SUPABASE_JWKS_URL: https://dyeerksnenfyvgevqskp.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://dyeerksnenfyvgevqskp.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CmOpnx0qPWRyhczXGRb2gQ_xVbZwFaz';
const LOCKED_SUPABASE_JWKS_URL = 'https://dyeerksnenfyvgevqskp.supabase.co/auth/v1/.well-known/jwks.json';

export const FINAL_URL = LOCKED_SUPABASE_URL;
export const FINAL_KEY = LOCKED_SUPABASE_PUBLISHABLE_KEY;

// Direct Supabase fetch ensuring required publishable key headers
async function directSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has('apikey')) {
    headers.set('apikey', LOCKED_SUPABASE_PUBLISHABLE_KEY);
  }
  if (!headers.has('authorization')) {
    headers.set('authorization', `Bearer ${LOCKED_SUPABASE_PUBLISHABLE_KEY}`);
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

export const supabase = createClient(FINAL_URL, FINAL_KEY, {
  global: {
    fetch: directSupabaseFetch,
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
