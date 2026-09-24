import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Admin permission required to alter):
// SUPABASE_URL: https://zybrzzouzleacqjvfiiu.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV
// SUPABASE_SECRET_KEY: sb_secret_CB00c8sgEOlaKcf5I2h35Q_TOAg9W7S
// SUPABASE_JWKS_URL: https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV';
const LOCKED_SUPABASE_SECRET_KEY = 'sb_secret_CB00c8sgEOlaKcf5I2h35Q_TOAg9W7S';
const LOCKED_SUPABASE_JWKS_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  LOCKED_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  LOCKED_SUPABASE_PUBLISHABLE_KEY;

// Enforce that connection always points to the approved Supabase host (zybrzzouzleacqjvfiiu)
// This prevents Lovable or static host auto-injected foreign Supabase projects from breaking the app
const isApprovedHost = typeof SUPABASE_URL === 'string' && SUPABASE_URL.includes('zybrzzouzleacqjvfiiu.supabase.co');
const FINAL_URL = isApprovedHost ? SUPABASE_URL : LOCKED_SUPABASE_URL;
const FINAL_KEY = (isApprovedHost && SUPABASE_ANON_KEY) ? SUPABASE_ANON_KEY : LOCKED_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(FINAL_URL, FINAL_KEY);
export const SUPABASE_URL_USED = FINAL_URL;
export const SUPABASE_KEY_USED = FINAL_KEY;

export const SUPABASE_CONFIG = {
  url: LOCKED_SUPABASE_URL,
  publishableKey: LOCKED_SUPABASE_PUBLISHABLE_KEY,
  secretKey: LOCKED_SUPABASE_SECRET_KEY,
  jwksUrl: LOCKED_SUPABASE_JWKS_URL,
};

