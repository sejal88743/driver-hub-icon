import { createClient } from '@supabase/supabase-js';

// LOCKED SUPABASE CREDENTIALS (Admin permission required to alter):
// SUPABASE_URL: https://zybrzzouzleacqjvfiiu.supabase.co
// SUPABASE_PUBLISHABLE_KEY: sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV
// SUPABASE_JWKS_URL: https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json

const LOCKED_SUPABASE_URL = 'https://zybrzzouzleacqjvfiiu.supabase.co';
const LOCKED_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_gkwGkK0YvU8q_GjkkcRNOg_XsE3AcGV';

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

// Enforce that connection always points to the approved Supabase host
const FINAL_URL = SUPABASE_URL && SUPABASE_URL.includes('supabase.co') ? SUPABASE_URL : LOCKED_SUPABASE_URL;
const FINAL_KEY = SUPABASE_ANON_KEY || LOCKED_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(FINAL_URL, FINAL_KEY);
export const SUPABASE_URL_USED = FINAL_URL;
export const SUPABASE_KEY_USED = FINAL_KEY;

export const SUPABASE_CONFIG = {
  url: LOCKED_SUPABASE_URL,
  publishableKey: LOCKED_SUPABASE_PUBLISHABLE_KEY,
  secretKey: '',
  jwksUrl: 'https://zybrzzouzleacqjvfiiu.supabase.co/auth/v1/.well-known/jwks.json',
};

